/**
 * @fileoverview Tests for sports_find_team tool.
 * @module tests/tools/sports-find-team.tool.test
 */

import { JsonRpcErrorCode, McpError, serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedTeam } from '@/services/types.js';

const config = vi.hoisted(() => ({ theSportsDbApiKey: '123' }));
vi.mock('@/config/server-config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/server-config.js')>()),
  getServerConfig: () => config,
}));

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
    config.theSportsDbApiKey = '123';
    vi.clearAllMocks();
    vi.mocked(getEspnService).mockReturnValue(mockEspnSvc as ReturnType<typeof getEspnService>);
    vi.mocked(getMlbService).mockReturnValue(mockMlbSvc as ReturnType<typeof getMlbService>);
    vi.mocked(getTheSportsDbService).mockReturnValue(
      mockTsdbSvc as ReturnType<typeof getTheSportsDbService>,
    );
  });
  it.each(['123', 'custom-key', '3'])(
    'qualifies only successful free-key TSDB contributions (%s)',
    async (key) => {
      config.theSportsDbApiKey = key;
      mockTsdbSvc.searchTeams.mockResolvedValue([makeTeam()]);
      mockEspnSvc.getTeams.mockResolvedValue([]);
      const result = await runToolContract(sportsFindTeam, { query: 'Arsenal', league: 'epl' });
      expect(result.structuredContent).toMatchObject({ totalFound: 1 });
      if (key === '123') {
        expect(result.structuredContent).toMatchObject({
          notice: expect.stringContaining('TheSportsDB'),
        });
        expect(JSON.stringify(result.content)).toContain('may be incomplete');
      } else expect(result.structuredContent).not.toHaveProperty('notice');
    },
  );
  it('does not describe ESPN-only contributions as capped', async () => {
    mockTsdbSvc.searchTeams.mockResolvedValue([makeTeam({ league: 'unrelated' })]);
    mockEspnSvc.getTeams.mockResolvedValue([makeTeam({ source: 'espn' })]);
    const result = await runToolContract(sportsFindTeam, { query: 'Arsenal', league: 'epl' });
    expect(result.structuredContent).not.toHaveProperty('notice');
  });

  it.each(['', '   '])('rejects blank query %j', (query) => {
    expect(sportsFindTeam.input.safeParse({ query }).success).toBe(false);
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

  it.each(['espn', 'mlb-scoped', 'mlb-unscoped'])(
    'merges same-ID metadata before name dedup: %s',
    async (path) => {
      const retained = makeTeam({
        league: 'MLB',
        espnId: path === 'espn' ? '359' : null,
        mlbId: path === 'espn' ? null : 136,
        logoUrl: null,
        venueName: null,
      });
      const candidate = makeTeam({
        id: path === 'espn' ? 'espn:359' : 'mlb:136',
        espnId: path === 'espn' ? '359' : null,
        tsdbId: null,
        displayName: 'Arsenal Alternate',
        logoUrl: 'badge',
        venueName: 'Park',
        source: path === 'espn' ? 'espn' : 'mlbstats',
        mlbId: path === 'espn' ? null : 136,
      });
      const unrelated = makeTeam({
        id: 'tsdb:other',
        espnId: null,
        mlbId: null,
        tsdbId: 'other',
        displayName: 'Arsenal Other',
        league: 'MLB',
      });
      mockTsdbSvc.searchTeams.mockResolvedValue([retained, unrelated]);
      mockEspnSvc.getTeams.mockResolvedValue(path === 'espn' ? [candidate] : []);
      mockMlbSvc.getTeams.mockResolvedValue(path === 'espn' ? [] : [candidate]);
      const input = {
        query: 'Arsenal',
        ...(path === 'mlb-unscoped' ? {} : { league: 'mlb' as const }),
      };
      const before = structuredClone([retained, candidate, unrelated]);
      const result = await runToolContract(sportsFindTeam, input);
      expect(result.structuredContent).toMatchObject({
        teams: [
          {
            id: 'tsdb:133604',
            displayName: 'Arsenal',
            logoUrl: 'badge',
            venueName: 'Park',
            tsdbId: '133604',
            espnId: retained.espnId,
            mlbId: retained.mlbId,
          },
          { id: 'tsdb:other', displayName: 'Arsenal Other' },
        ],
        totalFound: 2,
      });
      expect(JSON.stringify(result.content)).toContain('Logo: Arsenal (badge)');
      expect([retained, candidate, unrelated]).toEqual(before);
      expect((await runToolContract(sportsFindTeam, input)).structuredContent).toEqual(
        result.structuredContent,
      );
      retained.logoUrl = 'retained badge';
      retained.venueName = 'retained venue';
      expect((await runToolContract(sportsFindTeam, input)).structuredContent).toMatchObject({
        teams: [{ logoUrl: 'retained badge', venueName: 'retained venue' }, { id: 'tsdb:other' }],
      });
    },
  );

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

  it('retains an already-matching Bundesliga TSDB league', async () => {
    const tsdbTeam = makeTeam({
      id: 'tsdb:133676',
      espnId: '132',
      tsdbId: '133676',
      name: 'Bayern Munich',
      displayName: 'Bayern Munich',
      league: 'German Bundesliga',
    });
    mockTsdbSvc.searchTeams.mockResolvedValue([tsdbTeam]);
    mockEspnSvc.getTeams.mockResolvedValue([]);

    const ctx = createMockContext({ errors: sportsFindTeam.errors });
    const input = sportsFindTeam.input.parse({ query: 'Bayern Munich', league: 'bundesliga' });
    const result = await sportsFindTeam.handler(input, ctx);

    expect(result.teams).toHaveLength(1);
    expect(result.teams[0]).toMatchObject({ tsdbId: '133676', league: 'German Bundesliga' });
  });

  it.each([
    {
      league: 'epl' as const,
      providerLeague: 'English Premier League',
      name: 'Arsenal',
      tsdbId: '133604',
      espnId: '359',
    },
    {
      league: 'laliga' as const,
      providerLeague: 'Spanish La Liga',
      name: 'Real Madrid',
      tsdbId: '133738',
      espnId: '86',
    },
  ])('retains raw TSDB metadata for $providerLeague', async (fixture) => {
    const tsdbTeam = makeTeam({
      id: `tsdb:${fixture.tsdbId}`,
      espnId: null,
      tsdbId: fixture.tsdbId,
      name: fixture.name,
      displayName: fixture.name,
      league: fixture.providerLeague,
      venueName: `${fixture.name} Stadium`,
    });
    const espnTeam = makeTeam({
      id: `espn:${fixture.espnId}`,
      espnId: fixture.espnId,
      tsdbId: null,
      name: fixture.name,
      displayName: fixture.name,
      league: fixture.league,
      venueName: null,
      source: 'espn',
    });
    mockTsdbSvc.searchTeams.mockResolvedValue([tsdbTeam]);
    mockEspnSvc.getTeams.mockResolvedValue([espnTeam]);

    const ctx = createMockContext({ errors: sportsFindTeam.errors });
    const input = sportsFindTeam.input.parse({ query: fixture.name, league: fixture.league });
    const result = await sportsFindTeam.handler(input, ctx);

    expect(result.teams).toHaveLength(1);
    expect(result.teams[0]).toMatchObject({
      espnId: fixture.espnId,
      tsdbId: fixture.tsdbId,
      venueName: `${fixture.name} Stadium`,
    });
  });

  it('excludes a TSDB team from an unrelated league', async () => {
    mockTsdbSvc.searchTeams.mockResolvedValue([
      makeTeam({ league: 'National Hockey League', displayName: 'Seattle Kraken' }),
    ]);
    mockEspnSvc.getTeams.mockResolvedValue([]);
    mockMlbSvc.getTeams.mockResolvedValue([]);

    const ctx = createMockContext({ errors: sportsFindTeam.errors });
    const input = sportsFindTeam.input.parse({ query: 'Seattle Kraken', league: 'mlb' });

    await expect(sportsFindTeam.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'no_match' },
    });
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

  describe.each(['espn-scoped', 'mlb-scoped', 'mlb-unscoped'])('%s optional lookup', (path) => {
    function prepare(error: Error) {
      mockTsdbSvc.searchTeams.mockResolvedValue([
        makeTeam({ name: 'Mariners', displayName: 'Seattle Mariners', league: 'MLB' }),
      ]);
      mockEspnSvc.getTeams.mockResolvedValue([]);
      mockMlbSvc.getTeams.mockResolvedValue([]);
      (path === 'espn-scoped' ? mockEspnSvc.getTeams : mockMlbSvc.getTeams).mockRejectedValue(
        error,
      );
      return sportsFindTeam.input.parse({
        query: 'Mariners',
        ...(path === 'mlb-unscoped' ? {} : { league: 'mlb' }),
      });
    }

    it('retains a primary match during an optional outage', async () => {
      const input = prepare(serviceUnavailable('Provider outage'));
      const result = await sportsFindTeam.handler(
        input,
        createMockContext({ errors: sportsFindTeam.errors }),
      );
      expect(result.teams).toHaveLength(1);
    });

    it('discloses the optional outage on both surfaces alongside free-key guidance', async () => {
      const input = prepare(serviceUnavailable('secret provider body'));
      const result = await runToolContract(sportsFindTeam, input);
      expect(result.structuredContent).toMatchObject({
        unavailableSources: [
          {
            source: path === 'espn-scoped' ? 'espn' : 'mlbstats',
            operation: 'team_list',
            reason: 'unavailable',
            recovery: expect.any(String),
          },
        ],
        notice: expect.stringContaining('free-key'),
      });
      expect(JSON.stringify(result.content)).toContain('team_list: unavailable');
      expect(JSON.stringify(result)).not.toContain('secret provider body');
      mockTsdbSvc.searchTeams.mockResolvedValue([]);
      const empty = await runToolContract(sportsFindTeam, input);
      expect(empty.structuredContent).toMatchObject({
        error: { data: { reason: 'sources_unavailable', recovery: { hint: expect.any(String) } } },
      });
      expect(JSON.stringify(empty.content)).toContain('Recovery:');
    });

    it.each([
      JsonRpcErrorCode.InvalidParams,
      JsonRpcErrorCode.ValidationError,
      JsonRpcErrorCode.RequestCancelled,
    ])('propagates code %i unchanged', async (code) => {
      const error = new McpError(code, 'Provider rejected request');
      const input = prepare(error);
      await expect(
        sportsFindTeam.handler(input, createMockContext({ errors: sportsFindTeam.errors })),
      ).rejects.toBe(error);
    });

    it('rethrows a raw failure when the caller has cancelled', async () => {
      const caller = new AbortController();
      const error = new Error('Abort');
      const input = prepare(error);
      caller.abort();
      await expect(
        sportsFindTeam.handler(
          input,
          createMockContext({ errors: sportsFindTeam.errors, signal: caller.signal }),
        ),
      ).rejects.toBe(error);
    });
  });
  it('reports simultaneous optional outages', async () => {
    mockTsdbSvc.searchTeams.mockResolvedValue([makeTeam({ league: 'MLB' })]);
    mockEspnSvc.getTeams.mockRejectedValue(serviceUnavailable('ESPN'));
    mockMlbSvc.getTeams.mockRejectedValue(serviceUnavailable('MLB'));
    const result = await runToolContract(sportsFindTeam, { query: 'Arsenal', league: 'mlb' });
    expect(result.structuredContent.unavailableSources).toHaveLength(2);
  });
});
