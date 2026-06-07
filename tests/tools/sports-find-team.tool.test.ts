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

  it('throws no_match with recovery hint when nothing found across all sources', async () => {
    mockTsdbSvc.searchTeams.mockResolvedValue([]);
    mockMlbSvc.getTeams.mockResolvedValue([]);

    const ctx = createMockContext({ errors: sportsFindTeam.errors });
    const input = sportsFindTeam.input.parse({ query: 'NONEXISTENT_TEAM_XYZ' });

    await expect(sportsFindTeam.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'no_match', recovery: { hint: expect.any(String) } },
    });
  });

  it('deduplicates teams with same displayName and merges cross-reference IDs', async () => {
    const tsdbTeam = makeTeam({ id: 'tsdb:133604', espnId: null, source: 'thesportsdb' });
    const espnTeam = makeTeam({
      id: 'espn:359',
      espnId: '359',
      tsdbId: null,
      source: 'espn' as const,
    });
    mockTsdbSvc.searchTeams.mockResolvedValue([tsdbTeam, espnTeam]);
    mockMlbSvc.getTeams.mockResolvedValue([]);

    const ctx = createMockContext({ errors: sportsFindTeam.errors });
    const input = sportsFindTeam.input.parse({ query: 'Arsenal' });
    const result = await sportsFindTeam.handler(input, ctx);

    // Only one record returned after dedup
    expect(result.teams).toHaveLength(1);
    // espnId merged from ESPN record; tsdbId retained from TSDB record
    expect(result.teams[0].espnId).toBe('359');
    expect(result.teams[0].tsdbId).toBe('133604');
  });

  it('fetches MLB service when league=mlb is specified, merging mlbId into result', async () => {
    const tsdbTeam = makeTeam({
      id: 'tsdb:135262',
      espnId: null,
      mlbId: null,
      tsdbId: '135262',
      league: 'MLB',
      name: 'Mariners',
      displayName: 'Seattle Mariners',
      source: 'thesportsdb',
    });
    const espnTeam = makeTeam({
      id: 'espn:12',
      espnId: '12',
      mlbId: null,
      tsdbId: null,
      name: 'Mariners',
      displayName: 'Seattle Mariners',
      source: 'espn' as const,
    });
    const mlbTeam = makeTeam({
      id: 'mlb:136',
      espnId: null,
      mlbId: 136,
      tsdbId: null,
      name: 'Mariners',
      displayName: 'Seattle Mariners',
      source: 'mlbstats' as const,
    });
    mockTsdbSvc.searchTeams.mockResolvedValue([tsdbTeam]);
    mockEspnSvc.getTeams.mockResolvedValue([espnTeam]);
    mockMlbSvc.getTeams.mockResolvedValue([mlbTeam]);

    const ctx = createMockContext({ errors: sportsFindTeam.errors });
    const input = sportsFindTeam.input.parse({ query: 'Mariners', league: 'mlb' });
    const result = await sportsFindTeam.handler(input, ctx);

    expect(result.teams).toHaveLength(1);
    expect(result.teams[0].espnId).toBe('12');
    expect(result.teams[0].mlbId).toBe(136);
    expect(result.teams[0].tsdbId).toBe('135262');
  });

  it('merges ESPN espnId into TSDB record when both sources return the same team', async () => {
    // TSDB finds team but with no espnId; ESPN finds same team with espnId populated.
    // TSDB league field must contain 'epl' so it passes the league filter.
    const tsdbTeam = makeTeam({
      id: 'tsdb:133604',
      espnId: null,
      tsdbId: '133604',
      league: 'epl English Premier League',
      source: 'thesportsdb',
    });
    const espnTeam = makeTeam({
      id: 'espn:359',
      espnId: '359',
      tsdbId: null,
      source: 'espn' as const,
    });
    mockTsdbSvc.searchTeams.mockResolvedValue([tsdbTeam]);
    mockEspnSvc.getTeams.mockResolvedValue([espnTeam]);

    const ctx = createMockContext({ errors: sportsFindTeam.errors });
    const input = sportsFindTeam.input.parse({ query: 'arsenal', league: 'epl' });
    const result = await sportsFindTeam.handler(input, ctx);

    expect(result.teams).toHaveLength(1);
    expect(result.teams[0].espnId).toBe('359');
    expect(result.teams[0].tsdbId).toBe('133604');
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
