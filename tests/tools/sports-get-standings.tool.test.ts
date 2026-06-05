/**
 * @fileoverview Tests for sports_get_standings tool.
 * @module tests/tools/sports-get-standings.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
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

  it('throws season_not_found when standings array is empty', async () => {
    mockEspnSvc.getStandings.mockResolvedValue([]);

    const ctx = createMockContext({ errors: sportsGetStandings.errors });
    const input = sportsGetStandings.input.parse({ league: 'nfl', season: '1800' });

    await expect(sportsGetStandings.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'season_not_found' },
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
