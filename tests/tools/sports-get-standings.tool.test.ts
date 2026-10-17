/**
 * @fileoverview Tests for sports_get_standings tool.
 * @module tests/tools/sports-get-standings.tool.test
 */

import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedStanding } from '@/services/types.js';

vi.mock('@/services/espn/espn-service.js', () => ({
  getEspnService: vi.fn(),
}));
vi.mock('@/services/mlb/mlb-service.js', () => ({
  getMlbService: vi.fn(),
}));

import { sportsGetStandings } from '@/mcp-server/tools/definitions/sports-get-standings.tool.js';
import { getEspnService } from '@/services/espn/espn-service.js';
import { getMlbService } from '@/services/mlb/mlb-service.js';

function makeStanding(overrides: Partial<NormalizedStanding> = {}): NormalizedStanding {
  return {
    rank: 1,
    group: null,
    overtimeLosses: null,
    team: { id: 'espn:3', name: 'Kansas City Chiefs', abbreviation: 'KC' },
    wins: 14,
    losses: 3,
    ties: null,
    points: null,
    winningPercentage: '.824',
    divisionRank: '1',
    streak: 'W3',
    gamesBehind: '-',
    source: 'espn',
    ...overrides,
  };
}

describe('sportsGetStandings', () => {
  const mockEspnSvc = { getStandings: vi.fn() };
  const mockMlbSvc = { getStandings: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEspnService).mockReturnValue(mockEspnSvc as ReturnType<typeof getEspnService>);
    vi.mocked(getMlbService).mockReturnValue(mockMlbSvc as ReturnType<typeof getMlbService>);
  });

  it('returns ESPN standings for NFL', async () => {
    const standing = makeStanding();
    mockEspnSvc.getStandings.mockResolvedValue([standing]);

    const ctx = createMockContext({ errors: sportsGetStandings.errors });
    const input = sportsGetStandings.input.parse({ league: 'nfl' });
    const result = await sportsGetStandings.handler(input, ctx);

    expect(result.standings).toHaveLength(1);
    expect(result.standings[0].team.abbreviation).toBe('KC');
    expect(result.source).toBe('espn');
    expect(mockEspnSvc.getStandings).toHaveBeenCalledWith('football', 'nfl', null, ctx);
  });
  it('preserves unknown rank on both callable surfaces', async () => {
    mockEspnSvc.getStandings.mockResolvedValue([makeStanding({ rank: null, group: 'Group' })]);
    const result = await runToolContract(sportsGetStandings, { league: 'nfl' });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ standings: [{ rank: null, group: 'Group' }] });
    expect(JSON.stringify(result.content)).toContain('Unknown.');
  });
  it('pages ordered standings without losing mid-group identity or rank', async () => {
    const standings = Array.from({ length: 205 }, (_, i) =>
      makeStanding({
        rank: (i % 103) + 1,
        group: i < 103 ? 'A' : 'B',
        team: { id: `espn:${i}`, name: `Team ${i}`, abbreviation: `T${i}` },
      }),
    );
    mockEspnSvc.getStandings.mockResolvedValue(standings);
    const combined: NormalizedStanding[] = [];
    for (const offset of [0, 100, 200, 205]) {
      const result = await runToolContract(sportsGetStandings, {
        league: 'ncaab',
        season: '2026',
        offset,
      });
      expect(result.isError).not.toBe(true);
      const rows = result.structuredContent.standings as NormalizedStanding[];
      expect(result.structuredContent).toMatchObject({
        availableStandings: 205,
        totalReturned: Math.min(100, 205 - offset),
        effectiveLimit: 100,
        offset,
        truncated: offset < 200,
      });
      expect(JSON.stringify(result.content)).toContain('availableStandings');
      if (offset < 200) expect(result.structuredContent.nextOffset).toBe(offset + 100);
      else expect(result.structuredContent).not.toHaveProperty('nextOffset');
      if (offset === 100) expect(rows[0]).toMatchObject({ rank: 101, group: 'A' });
      if (offset === 205) expect(JSON.stringify(result.content)).toContain('past');
      combined.push(...rows);
    }
    expect(combined).toEqual(standings);
    const capped = await runToolContract(sportsGetStandings, { league: 'ncaab', limit: 999 });
    expect(capped.structuredContent).toMatchObject({ effectiveLimit: 200, totalReturned: 200 });
    expect(JSON.stringify(capped.content)).toContain('clamped');
  });
  it.each([{ limit: 0 }, { offset: -1 }, { limit: 1.5 }])(
    'rejects invalid paging %j',
    async (paging) => {
      expect(
        (await runToolContract(sportsGetStandings, { league: 'nfl', ...paging })).isError,
      ).toBe(true);
      expect(mockEspnSvc.getStandings).not.toHaveBeenCalled();
    },
  );
  it('delivers ranking groups and zero NHL overtime losses through both surfaces', async () => {
    mockEspnSvc.getStandings.mockResolvedValue([
      makeStanding({ group: 'Eastern Conference', overtimeLosses: 0, points: 0, ties: 0 }),
    ]);
    const result = await runToolContract(sportsGetStandings, { league: 'nhl', season: '2026' });
    expect(result.structuredContent).toMatchObject({
      season: '2026',
      standings: [{ group: 'Eastern Conference', overtimeLosses: 0, points: 0, ties: 0 }],
    });
    const text = result.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n');
    expect(text.split('\n')).toContain(
      '1. **KC** (Kansas City Chiefs) [espn:3] — 14W 3L 0T 0OTL 0pts | group:Eastern Conference pct:.824 | streak:W3 | GB:- | divRank:1',
    );
  });
  it('delivers explicit unverifiable season errors and recovery through both surfaces', async () => {
    mockEspnSvc.getStandings.mockResolvedValue([]);
    const result = await runToolContract(sportsGetStandings, { league: 'nfl', season: '1899' });
    expect(result.structuredContent).toMatchObject({
      error: {
        data: { reason: 'season_not_found', recovery: { hint: expect.stringContaining('omit') } },
      },
    });
    expect(JSON.stringify(result.content)).toContain('Recovery:');
  });
  it.each(['20', '20260', 'abcd'])(
    'rejects invalid season %s before acquisition',
    async (season) => {
      const result = await runToolContract(sportsGetStandings, { league: 'nfl', season });
      expect(result.isError).toBe(true);
      expect(mockEspnSvc.getStandings).not.toHaveBeenCalled();
    },
  );

  it('routes MLB to mlb service', async () => {
    const standing = makeStanding({ source: 'mlbstats' });
    mockMlbSvc.getStandings.mockResolvedValue([standing]);

    const ctx = createMockContext({ errors: sportsGetStandings.errors });
    const input = sportsGetStandings.input.parse({ league: 'mlb', season: '2025' });
    const result = await sportsGetStandings.handler(input, ctx);

    expect(result.source).toBe('mlbstats');
    expect(result.season).toBe('2025');
    expect(mockMlbSvc.getStandings).toHaveBeenCalledWith('2025', ctx);
  });

  it('throws season_not_found when an explicit season returns no standings', async () => {
    mockEspnSvc.getStandings.mockResolvedValue([]);

    const ctx = createMockContext({ errors: sportsGetStandings.errors });
    const input = sportsGetStandings.input.parse({ league: 'nfl', season: '1800' });

    await expect(sportsGetStandings.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'season_not_found', recovery: { hint: expect.any(String) } },
    });
  });

  it('emits the off-season notice via ctx.enrich (no season param)', async () => {
    mockEspnSvc.getStandings.mockResolvedValue([]);

    const ctx = createMockContext({ errors: sportsGetStandings.errors });
    const enrichSpy = vi.spyOn(ctx.enrich, 'notice');
    const input = sportsGetStandings.input.parse({ league: 'epl' });
    const result = await sportsGetStandings.handler(input, ctx);

    expect(result.standings).toHaveLength(0);
    expect(enrichSpy).toHaveBeenCalledWith(expect.stringMatching(/off-season/i));
  });

  it('delivers the off-season notice through the enrichment trailer in content[]', async () => {
    mockEspnSvc.getStandings.mockResolvedValue([]);

    const { runToolContract } = await import('@cyanheads/mcp-ts-core/testing');
    const result = await runToolContract(sportsGetStandings, { league: 'epl' });

    expect(result.isError ?? false).toBe(false);
    const text = result.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    expect(text).toContain('Season not currently active');
    expect(result.structuredContent).toMatchObject({
      notice: expect.stringMatching(/off-season/i),
    });
  });

  it('formats output completely (includes team name, wins, losses, rank)', () => {
    const result = {
      standings: [makeStanding()],
      league: 'nfl',
      season: '2025',
      source: 'espn' as const,
    };
    const blocks = sportsGetStandings.format!(result);
    expect(blocks[0].type).toBe('text');
    const text = blocks[0].text;
    expect(text).toContain('KC');
    expect(text).toContain('Kansas City Chiefs');
    expect(text).toContain('14W');
    expect(text).toContain('1.');
    expect(text).toContain('espn:3');
  });
});
