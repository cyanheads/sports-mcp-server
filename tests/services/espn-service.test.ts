/**
 * @fileoverview Unit tests for EspnService internals — focuses on normalizeEvents
 * covering score formats that differ between the scoreboard and schedule endpoints.
 * @module tests/services/espn-service.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it, vi } from 'vitest';

// We test normalizeEvents indirectly via getScoreboard and getTeamSchedule by
// mocking fetch so we don't hit the network.

vi.stubGlobal('fetch', vi.fn());

import { EspnService } from '@/services/espn/espn-service.js';

function stubFetch(body: unknown): void {
  const mockFetch = vi.mocked(fetch);
  mockFetch.mockResolvedValueOnce({
    ok: true,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response);
}

/** Build a minimal ESPN event stub. score can be a string (scoreboard) or an object (schedule). */
function makeEvent(
  opts: {
    id?: string;
    homeScore?: string | { displayValue: string; value: number };
    awayScore?: string | { displayValue: string; value: number };
    state?: string;
    statusAtEvent?: boolean; // true = put status on e.status (scoreboard); false = on comp.status
  } = {},
) {
  const {
    id = '999',
    homeScore = '3',
    awayScore = '1',
    state = 'post',
    statusAtEvent = true,
  } = opts;

  const statusObj = {
    period: 2,
    displayClock: "90'+10'",
    type: { state, name: 'STATUS_FULL_TIME' },
  };

  const competition = {
    date: '2026-05-18T19:00Z',
    venue: { fullName: 'Emirates Stadium' },
    competitors: [
      {
        homeAway: 'home',
        team: { id: '10', displayName: 'Home FC', abbreviation: 'HFC' },
        score: homeScore,
      },
      {
        homeAway: 'away',
        team: { id: '20', displayName: 'Away FC', abbreviation: 'AFC' },
        score: awayScore,
      },
    ],
    // Schedule endpoint puts status here; scoreboard endpoint puts it on the event
    ...(statusAtEvent ? {} : { status: statusObj }),
  };

  return {
    id,
    shortName: 'AFC @ HFC',
    // Scoreboard puts status here; schedule endpoint leaves it null
    status: statusAtEvent ? statusObj : null,
    competitions: [competition],
    date: '2026-05-18T19:00Z',
  };
}

describe('EspnService.normalizeEvents', () => {
  const ctx = createMockContext();
  const svc = new EspnService();

  it('parses plain string scores (scoreboard format)', async () => {
    stubFetch({ events: [makeEvent({ homeScore: '3', awayScore: '1' })] });
    const games = await svc.getScoreboard('soccer', 'eng.1', '2026-05-18', ctx);

    expect(games).toHaveLength(1);
    expect(games[0].homeTeam.score).toBe('3');
    expect(games[0].awayTeam.score).toBe('1');
    expect(games[0].status).toBe('final');
  });

  it('parses object scores using displayValue (schedule format)', async () => {
    const objScore = { displayValue: '2', value: 2.0, winner: false };
    stubFetch({
      events: [
        makeEvent({
          homeScore: objScore,
          awayScore: { displayValue: '1', value: 1.0, winner: true },
          statusAtEvent: false, // status on comp, like schedule endpoint
        }),
      ],
    });
    const games = await svc.getTeamSchedule('soccer', 'eng.1', '359', null, ctx);

    expect(games).toHaveLength(1);
    expect(games[0].homeTeam.score).toBe('2');
    expect(games[0].awayTeam.score).toBe('1');
    // Status should be resolved from comp.status when e.status is null
    expect(games[0].status).toBe('final');
  });

  it('does not produce [object Object] score strings', async () => {
    const objScore = { displayValue: '5', value: 5.0 };
    stubFetch({ events: [makeEvent({ homeScore: objScore, statusAtEvent: false })] });
    const games = await svc.getTeamSchedule('soccer', 'eng.1', '359', null, ctx);

    expect(games[0].homeTeam.score).not.toContain('[object');
  });

  it('uses status from e.status when present (scoreboard)', async () => {
    stubFetch({ events: [makeEvent({ state: 'in', statusAtEvent: true })] });
    const games = await svc.getScoreboard('soccer', 'eng.1', null, ctx);

    expect(games[0].status).toBe('in-progress');
  });

  it('falls back to comp.status when e.status is null (schedule)', async () => {
    stubFetch({
      events: [makeEvent({ state: 'pre', statusAtEvent: false })],
    });
    const games = await svc.getTeamSchedule('soccer', 'eng.1', '359', null, ctx);

    // statusAtEvent: false → status on comp, state: 'pre' → scheduled
    expect(games[0].status).toBe('scheduled');
  });

  it('preserves both bounds in a range scoreboard request', async () => {
    stubFetch({ events: [makeEvent()] });

    await svc.getScoreboardRange('football', 'nfl', '2026-09-01', '2026-09-30', ctx);

    expect(fetch).toHaveBeenCalledWith(
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20260901-20260930',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('retries failed range requests through the shared fetch path', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockReset()
      .mockResolvedValue({ ok: false, status: 503 } as Response);

    try {
      const rejection = expect(
        svc.getScoreboardRange('football', 'nfl', '2026-09-01', '2026-09-30', ctx),
      ).rejects.toThrow('failed after 4 attempts');
      await vi.runAllTimersAsync();
      await rejection;
      expect(fetch).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
});
