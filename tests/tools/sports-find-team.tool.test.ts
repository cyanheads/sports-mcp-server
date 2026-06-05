/**
 * @fileoverview Tests for sports_find_team tool.
 * @module tests/tools/sports-find-team.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedTeam } from '@/services/types.js';

vi.mock('@/services/espn/espn-service.js', () => ({
  getEspnService: vi.fn(),
}));
vi.mock('@/services/mlb/mlb-service.js', () => ({
  getMlbService: vi.fn(),
}));
vi.mock('@/services/thesportsdb/thesportsdb-service.js', () => ({
  getTheSportsDbService: vi.fn(),
}));

import { sportsFindTeam } from '@/mcp-server/tools/definitions/sports-find-team.tool.js';
import { getEspnService } from '@/services/espn/espn-service.js';
import { getMlbService } from '@/services/mlb/mlb-service.js';
import { getTheSportsDbService } from '@/services/thesportsdb/thesportsdb-service.js';

function makeTeam(overrides: Partial<NormalizedTeam> = {}): NormalizedTeam {
  return {
    id: 'tsdb:133604',
    espnId: '359',
    mlbId: null,
    tsdbId: '133604',
    name: 'Arsenal',
    abbreviation: 'ARS',
    location: 'London',
    displayName: 'Arsenal',
    league: 'English Premier League',
    logoUrl: 'https://example.com/arsenal.png',
    venueId: '1',
    venueName: 'Emirates Stadium',
    source: 'thesportsdb',
    ...overrides,
  };
}

describe('sportsFindTeam', () => {
  const mockEspnSvc = { getTeams: vi.fn() };
  const mockMlbSvc = { getTeams: vi.fn() };
  const mockTsdbSvc = { searchTeams: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEspnService).mockReturnValue(mockEspnSvc as ReturnType<typeof getEspnService>);
    vi.mocked(getMlbService).mockReturnValue(mockMlbSvc as ReturnType<typeof getMlbService>);
    vi.mocked(getTheSportsDbService).mockReturnValue(
      mockTsdbSvc as ReturnType<typeof getTheSportsDbService>,
    );
  });

  it('returns matching teams from TheSportsDB', async () => {
    const team = makeTeam();
    mockTsdbSvc.searchTeams.mockResolvedValue([team]);
    mockMlbSvc.getTeams.mockResolvedValue([]);

    const ctx = createMockContext({ errors: sportsFindTeam.errors });
    const input = sportsFindTeam.input.parse({ query: 'Arsenal' });
    const result = await sportsFindTeam.handler(input, ctx);

    expect(result.teams).toHaveLength(1);
    expect(result.teams[0].name).toBe('Arsenal');
    expect(result.totalFound).toBe(1);
    expect(result.query).toBe('Arsenal');
  });

  it('throws no_match when nothing found across all sources', async () => {
    mockTsdbSvc.searchTeams.mockResolvedValue([]);
    mockMlbSvc.getTeams.mockResolvedValue([]);

    const ctx = createMockContext({ errors: sportsFindTeam.errors });
    const input = sportsFindTeam.input.parse({ query: 'NONEXISTENT_TEAM_XYZ' });

    await expect(sportsFindTeam.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'no_match' },
    });
  });

  it('deduplicates teams with same displayName', async () => {
    const team1 = makeTeam({ id: 'tsdb:133604', source: 'thesportsdb' });
    const team2 = makeTeam({ id: 'espn:359', source: 'espn' as const });
    mockTsdbSvc.searchTeams.mockResolvedValue([team1, team2]);
    mockMlbSvc.getTeams.mockResolvedValue([]);

    const ctx = createMockContext({ errors: sportsFindTeam.errors });
    const input = sportsFindTeam.input.parse({ query: 'Arsenal' });
    const result = await sportsFindTeam.handler(input, ctx);

    expect(result.teams).toHaveLength(1);
  });

  it('adds ESPN results when league is specified', async () => {
    // TSDB returns nothing (empty when league filter rejects all results)
    mockTsdbSvc.searchTeams.mockResolvedValue([]);
    // ESPN path returns the matched team
    const espnTeam = makeTeam({ id: 'espn:359', espnId: '359', source: 'espn' as const });
    mockEspnSvc.getTeams.mockResolvedValue([espnTeam]);

    const ctx = createMockContext({ errors: sportsFindTeam.errors });
    const input = sportsFindTeam.input.parse({ query: 'Arsenal', league: 'epl' });
    const result = await sportsFindTeam.handler(input, ctx);

    expect(result.teams).toHaveLength(1);
    expect(result.teams[0].espnId).toBe('359');
    expect(mockEspnSvc.getTeams).toHaveBeenCalledWith('soccer', 'eng.1', ctx);
  });

  it('formats output completely', () => {
    const result = {
      teams: [
        {
          id: 'tsdb:133604',
          espnId: '359',
          mlbId: null,
          tsdbId: '133604',
          name: 'Arsenal',
          abbreviation: 'ARS',
          location: 'London',
          displayName: 'Arsenal',
          league: 'English Premier League',
          logoUrl: 'https://example.com/logo.png',
          venueName: 'Emirates Stadium',
          source: 'thesportsdb' as const,
        },
      ],
      query: 'Arsenal',
      totalFound: 1,
    };
    const blocks = sportsFindTeam.format!(result);
    expect(blocks[0].type).toBe('text');
    const text = blocks[0].text;
    expect(text).toContain('Arsenal');
    expect(text).toContain('tsdb:133604');
    expect(text).toContain('thesportsdb');
    expect(text).toContain('Emirates Stadium');
  });
});
