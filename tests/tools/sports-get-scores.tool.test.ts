/**
 * @fileoverview Tests for sports_get_scores tool.
 * @module tests/tools/sports-get-scores.tool.test
 */

import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedGame } from '@/services/types.js';

// Mock service modules — must be hoisted before any dynamic imports of the tool.
vi.mock('@/services/espn/espn-service.js', () => ({
  getEspnService: vi.fn(),
}));
vi.mock('@/services/mlb/mlb-service.js', () => ({
  getMlbService: vi.fn(),
}));

import { sportsGetScores } from '@/mcp-server/tools/definitions/sports-get-scores.tool.js';
import { getEspnService } from '@/services/espn/espn-service.js';
import { getMlbService } from '@/services/mlb/mlb-service.js';

/** Minimal valid NormalizedGame fixture. */
function makeGame(overrides: Partial<NormalizedGame> = {}): NormalizedGame {
  return {
    id: 'espn:12345',
    shortName: 'SEA @ NYY',
    homeTeam: { id: 'espn:10', name: 'New York Yankees', abbreviation: 'NYY', score: '3' },
    awayTeam: { id: 'espn:26', name: 'Seattle Mariners', abbreviation: 'SEA', score: '2' },
    status: 'final',
    period: null,
    clock: null,
    startTimeUtc: '2026-06-04T18:00:00Z',
    venue: 'Yankee Stadium',
    source: 'espn',
    ...overrides,
  };
}

describe('sportsGetScores', () => {
  const mockEspnSvc = { getScoreboard: vi.fn() };
  const mockMlbSvc = { getSchedule: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEspnService).mockReturnValue(mockEspnSvc as ReturnType<typeof getEspnService>);
    vi.mocked(getMlbService).mockReturnValue(mockMlbSvc as ReturnType<typeof getMlbService>);
  });

  it('returns games for an ESPN league (nfl)', async () => {
    const game = makeGame({ source: 'espn' });
    mockEspnSvc.getScoreboard.mockResolvedValue([game]);

    const ctx = createMockContext({ errors: sportsGetScores.errors });
    const input = sportsGetScores.input.parse({ league: 'nfl', date: '2026-06-04' });
    const result = await sportsGetScores.handler(input, ctx);

    expect(result.games).toHaveLength(1);
    expect(result.games[0].id).toBe('espn:12345');
    expect(result.league).toBe('nfl');
    expect(result.date).toBe('2026-06-04');
    expect(mockEspnSvc.getScoreboard).toHaveBeenCalledWith('football', 'nfl', '2026-06-04', ctx);
  });
  it('pages the filtered ordered slate and distinguishes exhausted pages', async () => {
    const games = Array.from({ length: 205 }, (_, i) =>
      makeGame({
        id: `espn:${String(i < 100 ? 200 + i : i - 100).padStart(3, '0')}`,
        startTimeUtc: i < 100 ? '2026-06-04T18:00:00Z' : '2026-06-04T19:00:00Z',
      }),
    );
    const source = [...games].reverse();
    mockEspnSvc.getScoreboard.mockResolvedValue(source);
    const before = structuredClone(source);
    const ids: string[] = [];
    for (const offset of [0, 100, 200, 205]) {
      const result = await runToolContract(sportsGetScores, {
        league: 'nfl',
        date: '2026-06-04',
        team_name: 'SEA',
        offset,
      });
      const rows = result.structuredContent.games as NormalizedGame[];
      expect(result.structuredContent).toMatchObject({
        availableGames: 205,
        totalReturned: Math.min(100, 205 - offset),
        offset,
        effectiveLimit: 100,
        truncated: offset < 200,
      });
      expect(JSON.stringify(result.content)).toContain('availableGames');
      if (offset < 200) expect(result.structuredContent.nextOffset).toBe(offset + 100);
      else expect(result.structuredContent).not.toHaveProperty('nextOffset');
      if (offset === 205) {
        expect(rows).toEqual([]);
        expect(result.structuredContent).not.toHaveProperty('emptyReason');
        expect(JSON.stringify(result.content)).toContain('past');
      }
      ids.push(...rows.map((g) => g.id));
    }
    expect(ids).toEqual(games.map((g) => g.id));
    const capped = await runToolContract(sportsGetScores, { league: 'nfl', limit: 999 });
    expect(capped.structuredContent).toMatchObject({ effectiveLimit: 200, totalReturned: 200 });
    expect(JSON.stringify(capped.content)).toContain('clamped');
    expect(source).toEqual(before);
  });

  it.each([{ limit: 0 }, { offset: -1 }, { limit: 1.5 }])(
    'rejects invalid paging %j',
    async (paging) => {
      expect((await runToolContract(sportsGetScores, { league: 'nfl', ...paging })).isError).toBe(
        true,
      );
      expect(mockEspnSvc.getScoreboard).not.toHaveBeenCalled();
    },
  );

  it('routes MLB to mlb service', async () => {
    const game = makeGame({ id: 'mlb:99', source: 'mlbstats' });
    mockMlbSvc.getSchedule.mockResolvedValue([game]);

    const ctx = createMockContext({ errors: sportsGetScores.errors });
    const input = sportsGetScores.input.parse({ league: 'mlb', date: '2026-06-04' });
    const result = await sportsGetScores.handler(input, ctx);

    expect(result.games[0].source).toBe('mlbstats');
    expect(mockMlbSvc.getSchedule).toHaveBeenCalled();
    expect(mockEspnSvc.getScoreboard).not.toHaveBeenCalled();
  });

  it('filters by team_name', async () => {
    const seaGame = makeGame({ shortName: 'SEA @ NYY' });
    const bosGame = makeGame({
      id: 'espn:99',
      shortName: 'BOS @ HOU',
      homeTeam: { id: 'espn:18', name: 'Houston Astros', abbreviation: 'HOU', score: '1' },
      awayTeam: { id: 'espn:3', name: 'Boston Red Sox', abbreviation: 'BOS', score: '4' },
    });
    mockEspnSvc.getScoreboard.mockResolvedValue([seaGame, bosGame]);

    const ctx = createMockContext({ errors: sportsGetScores.errors });
    const input = sportsGetScores.input.parse({ league: 'nfl', team_name: 'Mariners' });
    const result = await sportsGetScores.handler(input, ctx);

    expect(result.games).toHaveLength(1);
    expect(result.games[0].awayTeam.name).toBe('Seattle Mariners');
  });

  it('returns reason when no games found', async () => {
    mockEspnSvc.getScoreboard.mockResolvedValue([]);

    const ctx = createMockContext({ errors: sportsGetScores.errors });
    const input = sportsGetScores.input.parse({ league: 'nfl', date: '2026-01-01' });
    const result = await sportsGetScores.handler(input, ctx);

    expect(result.games).toHaveLength(0);
    expect(result.reason).toMatch(/no games/i);
  });

  it('formats output completely', () => {
    const game = makeGame();
    const result = {
      games: [game],
      date: '2026-06-04',
      league: 'nfl',
    };
    const blocks = sportsGetScores.format!(result);
    expect(blocks[0].type).toBe('text');
    const text = blocks[0].text;
    expect(text).toContain('espn:12345');
    expect(text).toContain('NYY');
    expect(text).toContain('SEA');
    expect(text).toContain('final');
    expect(text).toContain('espn');
  });
});
