/**
 * @fileoverview Unit tests for MLB StatsAPI schedule acquisition and normalization.
 * @module tests/services/mlb-service.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('fetch', vi.fn());

import { MlbService } from '@/services/mlb/mlb-service.js';

describe('MlbService', () => {
  const ctx = createMockContext();
  const svc = new MlbService();
  it('hydrates historical division names without a separate lookup', async () => {
    vi.mocked(fetch)
      .mockReset()
      .mockImplementation(async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/standings')) {
          return Response.json({
            records: [
              {
                division: { name: 'American League West', season: '1993' },
                teamRecords: [
                  {
                    team: { id: 117, name: 'Houston Astros' },
                    divisionRank: '1',
                    wins: 0,
                    losses: 0,
                  },
                ],
              },
            ],
          });
        }
        return Response.json({ teams: [{ id: 117, abbreviation: 'HOU' }] });
      });
    await expect(svc.getStandings('1993', ctx)).resolves.toMatchObject([
      {
        group: 'American League West',
        overtimeLosses: null,
        wins: 0,
        losses: 0,
        team: { abbreviation: 'HOU' },
      },
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    const urls = vi.mocked(fetch).mock.calls.map(([input]) => new URL(String(input)));
    expect(
      urls.find((url) => url.pathname.endsWith('/standings'))?.searchParams.get('hydrate'),
    ).toBe('division,league');
    expect(urls.every((url) => url.searchParams.get('season') === '1993')).toBe(true);
  });
  it('preserves empty standings', async () => {
    vi.mocked(fetch)
      .mockReset()
      .mockImplementation(async () => Response.json({}));
    await expect(svc.getStandings('2025', ctx)).resolves.toEqual([]);
  });

  it('preserves both bounds in a range schedule request', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ dates: [] }));

    const games = await svc.getScheduleRange('2026-07-04', '2026-07-05', ctx);

    expect(games).toEqual([]);
    expect(fetch).toHaveBeenCalledWith(
      'https://statsapi.mlb.com/api/v1/schedule?sportId=1&hydrate=team,linescore,decisions&startDate=2026-07-04&endDate=2026-07-05',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('retries failed range requests through the shared fetch path', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockReset()
      .mockImplementation(async () => new Response('unavailable', { status: 503 }));

    try {
      const rejection = expect(
        svc.getScheduleRange('2026-07-04', '2026-07-05', ctx),
      ).rejects.toThrow('failed after 4 attempts');
      await vi.runAllTimersAsync();
      await rejection;
      expect(fetch).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
});
