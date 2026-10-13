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
  mockFetch.mockImplementation(async () => Response.json(body));
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

  it('retrieves every day of a range without sending the rejected paired query', async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      Response.json({
        events: [makeEvent({ id: new URL(String(input)).searchParams.get('dates')! })],
      }),
    );
    vi.mocked(fetch).mockClear();
    const games = await svc.getScoreboardRange('football', 'nfl', '2026-09-01', '2026-09-02', ctx);
    expect(games.map(({ id, providerDate }) => ({ id, providerDate }))).toEqual([
      { id: 'espn:20260901', providerDate: '2026-09-01' },
      { id: 'espn:20260902', providerDate: '2026-09-02' },
    ]);

    expect(fetch).toHaveBeenCalledWith(
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20260901',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetch).toHaveBeenCalledWith(
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20260902',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries failed range requests through the shared fetch path', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockReset()
      .mockImplementation(async () => new Response('unavailable', { status: 503 }));

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

describe('EspnService team metadata and active rosters', () => {
  const svc = new EspnService();
  it.each(['nba', 'eng.1'])('normalizes flat %s athletes using their positions', async (league) => {
    stubFetch({ athletes: [{ fullName: 'Player', position: { abbreviation: 'G' } }] });
    await expect(
      svc.getTeamRoster('basketball', league, '1', createMockContext()),
    ).resolves.toEqual([{ name: 'Player', position: 'G', jersey: null }]);
  });
  it('excludes inactive NFL groups and keeps athlete positions in active groups', async () => {
    stubFetch({
      athletes: ['offense', 'defense', 'injuredReserveOrOut', 'suspended', 'practiceSquad'].map(
        (position) => ({
          position,
          items: [{ fullName: position, position: { abbreviation: 'QB' }, jersey: '7' }],
        }),
      ),
    });
    await expect(svc.getTeamRoster('football', 'nfl', '26', createMockContext())).resolves.toEqual([
      { name: 'offense', position: 'QB', jersey: '7' },
      { name: 'defense', position: 'QB', jersey: '7' },
    ]);
  });
  it('retains grouped NHL athletes', async () => {
    stubFetch({
      athletes: [
        {
          position: 'goalies',
          items: [{ displayName: 'Goalie', position: { abbreviation: 'G' }, jersey: '0' }],
        },
      ],
    });
    await expect(svc.getTeamRoster('hockey', 'nhl', '1', createMockContext())).resolves.toEqual([
      { name: 'Goalie', position: 'G', jersey: '0' },
    ]);
  });
  it('retains franchise venue metadata', async () => {
    stubFetch({ team: { id: '26', franchise: { venue: { id: 3673, fullName: 'Lumen Field' } } } });
    await expect(
      svc.getTeamDetail('football', 'nfl', '26', createMockContext()),
    ).resolves.toMatchObject({ venueId: '3673', venueName: 'Lumen Field' });
  });
  it('preserves missing team and empty roster behavior', async () => {
    stubFetch({});
    await expect(
      svc.getTeamDetail('football', 'nfl', '26', createMockContext()),
    ).resolves.toBeNull();
    await expect(svc.getTeamRoster('football', 'nfl', '26', createMockContext())).resolves.toEqual(
      [],
    );
  });
});

describe('EspnService standings', () => {
  const svc = new EspnService();
  const entry = {
    team: { id: '1', displayName: 'Team', abbreviation: 'T' },
    stats: [
      { name: 'wins', type: 'wins', value: 5 },
      { name: 'losses', type: 'losses', value: 1 },
    ],
  };
  it('uses the provider default type and traverses nested ranking groups', async () => {
    vi.mocked(fetch).mockClear();
    stubFetch({
      season: { year: 2026 },
      children: [
        { name: 'Conference', children: [{ name: 'Division', standings: { entries: [entry] } }] },
      ],
    });
    await expect(
      svc.getStandings('football', 'college-football', '2026', createMockContext()),
    ).resolves.toMatchObject([{ group: 'Division', wins: 5 }]);
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.has('type')).toBe(false);
  });
  it.each([
    {},
    { season: { year: 2025 } },
    { children: [{ standings: { season: 2025, entries: [entry] } }] },
  ])('refuses unverified or mismatched explicit seasons %j', async (metadata) => {
    stubFetch({ children: [{ standings: { entries: [entry] } }], ...metadata });
    await expect(svc.getStandings('football', 'nfl', '1899', createMockContext())).resolves.toEqual(
      [],
    );
  });
  it('accepts a season verified only at group standings metadata', async () => {
    stubFetch({ children: [{ standings: { season: 2025, entries: [entry] } }] });
    await expect(
      svc.getStandings('football', 'nfl', '2025', createMockContext()),
    ).resolves.toHaveLength(1);
  });
  it('rejects conflicting nested seasons and an unverified sibling table', async () => {
    for (const sibling of [
      { standings: { season: 2025, entries: [entry] } },
      { standings: { entries: [entry] } },
    ]) {
      stubFetch({
        children: [{ children: [{ standings: { season: 2026, entries: [entry] } }, sibling] }],
      });
      await expect(
        svc.getStandings('football', 'college-football', '2026', createMockContext()),
      ).resolves.toEqual([]);
    }
    stubFetch({
      season: { year: 2025 },
      children: [{ standings: { season: 2026, entries: [entry] } }],
    });
    await expect(svc.getStandings('football', 'nfl', '2026', createMockContext())).resolves.toEqual(
      [],
    );
  });
  it('keeps overall stats, zero ties, group and NHL overtime losses', async () => {
    stubFetch({
      children: [
        {
          name: 'Eastern Conference',
          standings: {
            entries: [
              {
                ...entry,
                stats: [
                  ...entry.stats,
                  { name: 'wins', type: 'homerecord_wins', value: 2 },
                  { name: 'losses', type: 'awayrecord_losses', value: 0 },
                  { name: 'ties', type: 'ties', value: 0 },
                  { name: 'otLosses', value: 7 },
                  { name: 'points', value: 17 },
                ],
              },
            ],
          },
        },
      ],
    });
    await expect(
      svc.getStandings('hockey', 'nhl', null, createMockContext()),
    ).resolves.toMatchObject([
      { group: 'Eastern Conference', wins: 5, losses: 1, ties: 0, overtimeLosses: 7, points: 17 },
    ]);
  });
  it('uses the explicit overall record when college scalar losses are omitted', async () => {
    stubFetch({
      children: [
        {
          name: 'American Conference',
          standings: {
            entries: [
              {
                ...entry,
                stats: [
                  { name: 'wins', type: 'wins', value: 5 },
                  { name: 'overall', type: 'total', summary: '5-1', displayValue: '5-1' },
                  { name: 'Home', type: 'homerecord', summary: '3-0' },
                  { name: 'wins', type: 'homerecord_wins', value: 3 },
                ],
              },
            ],
          },
        },
      ],
    });
    await expect(
      svc.getStandings('football', 'college-football', null, createMockContext()),
    ).resolves.toMatchObject([{ wins: 5, losses: 1 }]);
  });
  it('omits NBA scoring points and keeps soccer zero points', async () => {
    stubFetch({
      children: [{ standings: { entries: [{ ...entry, stats: [{ name: 'points', value: 0 }] }] } }],
    });
    await expect(
      svc.getStandings('basketball', 'nba', null, createMockContext()),
    ).resolves.toMatchObject([{ points: null, overtimeLosses: null, group: null }]);
    await expect(
      svc.getStandings('soccer', 'eng.1', null, createMockContext()),
    ).resolves.toMatchObject([{ points: 0 }]);
  });
  it('preserves empty current standings', async () => {
    stubFetch({ children: [] });
    await expect(svc.getStandings('soccer', 'eng.1', null, createMockContext())).resolves.toEqual(
      [],
    );
  });
  it('normalizes available direct groups', async () => {
    stubFetch({ children: [{ standings: { entries: [entry] } }] });
    await expect(
      svc.getStandings('football', 'nfl', null, createMockContext()),
    ).resolves.toMatchObject([{ wins: 5, losses: 1 }]);
  });
});
