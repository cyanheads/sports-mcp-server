/**
 * @fileoverview Provider-calendar and selector regressions through real services and both MCP surfaces.
 * @module tests/tools/calendar-contract.test
 */
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sportsFindTeam } from '@/mcp-server/tools/definitions/sports-find-team.tool.js';
import { sportsGetSchedule } from '@/mcp-server/tools/definitions/sports-get-schedule.tool.js';
import { sportsGetScores } from '@/mcp-server/tools/definitions/sports-get-scores.tool.js';
import { sportsGetTeam } from '@/mcp-server/tools/definitions/sports-get-team.tool.js';
import * as espn from '@/services/espn/espn-service.js';
import * as mlb from '@/services/mlb/mlb-service.js';
import * as tsdb from '@/services/thesportsdb/thesportsdb-service.js';
import collegeDefaults from '../fixtures/college-default-inventories.json';
import collegeIds from '../fixtures/college-inventory-ids.json';
import fixtures from '../fixtures/espn-calendar.json';

const calls: URL[] = [];
/** Native HTTP fake: route queries exactly, leaving normalization and retry intact. */
function install(response: (url: URL) => unknown | Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      calls.push(url);
      const body = response(url);
      return body instanceof Response ? body : Response.json(body);
    }),
  );
}
beforeEach(() => {
  calls.length = 0;
  vi.spyOn(espn, 'getEspnService').mockReturnValue(new espn.EspnService());
  vi.spyOn(mlb, 'getMlbService').mockReturnValue(new mlb.MlbService());
  vi.spyOn(tsdb, 'getTheSportsDbService').mockReturnValue(new tsdb.TheSportsDbService());
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('pre-change characterization', () => {
  it('keeps source-default league reads and source-prefixed IDs on both surfaces', async () => {
    install(() => fixtures['nfl-day']);
    const result = await runToolContract(sportsGetSchedule, { league: 'nfl' });
    expect(calls).toHaveLength(1);
    expect(calls[0].searchParams.has('dates')).toBe(false);
    expect(result.structuredContent).toMatchObject({ games: [{ id: 'espn:401872980' }] });
    expect(JSON.stringify(result.content)).toContain('espn:401872980');
  });
  it('preserves sparse and object-score normalization', async () => {
    install(() => fixtures['arsenal-results']);
    const games = await new espn.EspnService().getTeamSchedule(
      'soccer',
      'eng.1',
      '359',
      null,
      createMockContext(),
    );
    const game = games.find((game) => game.id === 'espn:401879268');
    expect(game).toMatchObject({ id: 'espn:401879268', status: 'final' });
    expect(game?.homeTeam.score).not.toContain('[object');
    expect(game?.venue).toBeNull();
  });
});

describe('canonical calendar and team regressions', () => {
  it.each([
    ['2026-03-09T04:30:00Z', '2026-03-09'],
    ['2026-11-02T04:30:00Z', '2026-11-01'],
  ])('tracks the Eastern offset after DST transitions at %s', async (instant, date) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(instant));
    install(() => ({ events: [] }));
    const result = await runToolContract(sportsGetScores, { league: 'nfl' });
    expect(result.structuredContent?.date).toBe(date);
    expect(JSON.stringify(result.content)).toContain(date);
  });
  it('does not skip preseason when event phase disagrees with stale top-level metadata', async () => {
    install((url) =>
      url.searchParams.get('seasontype') === '1'
        ? fixtures['lakers-default']
        : url.searchParams.get('seasontype') === '3'
          ? { events: [] }
          : fixtures['lakers-regular'],
    );
    const games = await new espn.EspnService().getTeamSchedule(
      'basketball',
      'nba',
      '13',
      null,
      createMockContext(),
    );
    expect(calls.some((url) => url.searchParams.get('seasontype') === '1')).toBe(true);
    expect(games.some((game) => game.id === 'espn:401898716')).toBe(true);
  });
  it.each([
    ['nfl', 'Seahawks', '2025-11-02', 'seahawks-2025', '401772926'],
    ['epl', 'Arsenal', '2026-10-18', 'arsenal-fixtures', '401878769'],
  ])(
    'uses bounded historical/fixture scoreboard membership for %s %s',
    async (league, team_name, date, key, id) => {
      const body = fixtures[key as 'seahawks-2025'];
      const event = body.events.find((event) => event.id === id);
      expect(event).toBeDefined();
      install((url) =>
        url.pathname.endsWith('/teams')
          ? fixtures[league === 'nfl' ? 'nfl-teams' : 'epl-teams']
          : { events: [event] },
      );
      const result = await runToolContract(sportsGetSchedule, {
        league,
        team_name,
        date_from: date,
        date_to: date,
      });
      expect(result.structuredContent?.games).toEqual([
        expect.objectContaining({ id: `espn:${id}` }),
      ]);
      expect(JSON.stringify(result.content)).toContain(`espn:${id}`);
      expect(calls.at(-1)?.pathname).toContain('/scoreboard');
      expect(calls.at(-1)?.searchParams.get('dates')).toBe(date.replaceAll('-', ''));
    },
  );
  it('includes Lakers regular-season fixtures in the preseason team summary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
    const teams = {
      sports: [
        {
          leagues: [
            {
              teams: [
                {
                  team: {
                    id: '13',
                    name: 'Lakers',
                    displayName: 'Los Angeles Lakers',
                    abbreviation: 'LAL',
                    location: 'Los Angeles',
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    install((url) =>
      url.pathname.endsWith('/teams')
        ? teams
        : url.pathname.endsWith('/schedule')
          ? url.searchParams.get('seasontype') === '2'
            ? fixtures['lakers-regular']
            : fixtures['lakers-default']
          : { athletes: [] },
    );
    const result = await runToolContract(sportsGetTeam, { league: 'nba', team_name: 'Lakers' });
    expect(result.structuredContent?.upcomingFixtures).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'espn:401909092' })]),
    );
    expect(JSON.stringify(result.content)).toContain('espn:401909092');
  });
  it.each([
    ['ncaaf', 'Washington Huskies', '264'],
    ['ncaab', 'Gonzaga Bulldogs', '2250'],
    ['ncaab', 'Montana Grizzlies', '149'],
  ])(
    'resolves %s %s through lookup, schedule, and multi-result search',
    async (league, name, id) => {
      install((url) =>
        url.pathname.endsWith('/teams')
          ? fixtures[`${league}-teams-full` as 'ncaaf-teams-full']
          : { teams: null, events: [], athletes: [] },
      );
      const lookup = await runToolContract(sportsGetTeam, { league, team_name: name });
      expect(lookup.structuredContent).toMatchObject({ team: { id: `espn:${id}` } });
      expect(JSON.stringify(lookup.content)).toContain(`espn:${id}`);
      const schedule = await runToolContract(sportsGetSchedule, {
        league,
        team_name: name,
        date_from: '2026-10-08',
      });
      expect(schedule.isError).not.toBe(true);
      expect(schedule.structuredContent?.games).toEqual([]);
      const search = await runToolContract(sportsFindTeam, { league, query: name });
      expect(search.structuredContent).toMatchObject({
        teams: expect.arrayContaining([expect.objectContaining({ id: `espn:${id}` })]),
      });
      expect(JSON.stringify(search.content)).toContain(`espn:${id}`);
    },
  );
  it.each([
    ['nfl', ' Seahawks ', 'espn:26'],
    ['nfl', 'Seattle Seahawks', 'espn:26'],
    ['nfl', 'NYJ', 'espn:20'],
    ['mlb', 'BOS', 'mlb:111'],
    ['mlb', 'Boston Red Sox', 'mlb:111'],
    ['mlb', 'Mariners', 'mlb:136'],
  ])('preserves unique selector %s %s', async (league, name, id) => {
    install((url) =>
      url.pathname.endsWith('/teams')
        ? league === 'mlb'
          ? fixtures['mlb-teams']
          : fixtures['nfl-teams']
        : { events: [], dates: [], athletes: [], roster: [] },
    );
    const result = await runToolContract(sportsGetTeam, { league, team_name: name });
    expect(result.structuredContent).toMatchObject({ team: { id } });
    expect(JSON.stringify(result.content)).toContain(id);
  });
  it.each([
    ['nfl', 'New York', ['New York Giants', 'New York Jets']],
    ['mlb', 'Sox', ['Boston Red Sox', 'Chicago White Sox']],
  ])('rejects %s %s with both complete candidate surfaces', async (league, team_name, names) => {
    install(() => (league === 'mlb' ? fixtures['mlb-teams'] : fixtures['nfl-teams']));
    for (const definition of [sportsGetTeam, sportsGetSchedule]) {
      const result = await runToolContract(definition, { league, team_name });
      expect(result.structuredContent).toMatchObject({
        error: { code: -32007, data: { reason: 'ambiguous_team', candidates: expect.any(Array) } },
      });
      for (const name of names) expect(JSON.stringify(result.content)).toContain(name);
    }
  });
  it('pages a complete same-day Division I slate with defaults, second page, and past-end', async () => {
    install(() => fixtures['ncaab-all-plain']);
    const first = await runToolContract(sportsGetSchedule, {
      league: 'ncaab',
      date_from: '2025-12-06',
    });
    const second = await runToolContract(sportsGetSchedule, {
      league: 'ncaab',
      date_from: '2025-12-06',
      offset: 100,
    });
    const past = await runToolContract(sportsGetSchedule, {
      league: 'ncaab',
      date_from: '2025-12-06',
      offset: 116,
    });
    expect(first.structuredContent).toMatchObject({
      availableGames: 116,
      effectiveLimit: 100,
      truncated: true,
      nextOffset: 100,
    });
    expect(second.structuredContent).toMatchObject({
      availableGames: 116,
      truncated: false,
      totalReturned: 16,
    });
    expect(second.structuredContent?.nextDateFrom).toBeUndefined();
    expect(past.structuredContent).toMatchObject({ games: [], totalReturned: 0, truncated: false });
    const ids = [
      ...(first.structuredContent!.games as Array<{ id: string }>),
      ...(second.structuredContent!.games as Array<{ id: string }>),
    ].map((game) => game.id);
    expect(new Set(ids).size).toBe(116);
    for (const result of [first, second])
      for (const game of result.structuredContent!.games as Array<{ id: string }>)
        expect(JSON.stringify(result.content)).toContain(game.id);
    expect(JSON.stringify(first.content)).toContain('nextOffset');
  });
  it('clamps a large limit to 200 and exposes original bounds on both surfaces', async () => {
    install(() => ({
      events: Array.from({ length: 205 }, (_, i) => ({
        ...fixtures['nfl-day'].events[0],
        id: String(i),
      })),
    }));
    const result = await runToolContract(sportsGetSchedule, {
      league: 'nfl',
      date_from: '2026-10-08',
      limit: 1000,
    });
    expect(result.structuredContent).toMatchObject({
      totalReturned: 200,
      availableGames: 205,
      effectiveLimit: 200,
      truncated: true,
      nextOffset: 200,
      notice: expect.stringContaining('1000'),
    });
    expect(JSON.stringify(result.content)).toContain('clamped to 200');
  });
  it('finishes every row page before advancing into a subsequent date window', async () => {
    install((url) => ({
      events: (url.searchParams.get('dates') === '20261008'
        ? ['0', '1', '2']
        : url.searchParams.get('dates') === '20261009'
          ? ['2', '3', '4']
          : url.searchParams.get('dates') === '20261015'
            ? ['5', '6', '7']
            : []
      ).map((id) => ({
        ...fixtures['nfl-day'].events[0],
        id,
      })),
    }));
    const bounds = { league: 'nfl', date_from: '2026-10-08', date_to: '2026-10-15', limit: 2 };
    const first = await runToolContract(sportsGetSchedule, bounds);
    const second = await runToolContract(sportsGetSchedule, { ...bounds, offset: 2 });
    const last = await runToolContract(sportsGetSchedule, { ...bounds, offset: 4 });
    const past = await runToolContract(sportsGetSchedule, { ...bounds, offset: 8 });
    for (const [result, ids] of [
      [first, ['espn:0', 'espn:1']],
      [second, ['espn:2', 'espn:3']],
      [last, ['espn:4']],
    ] as const) {
      expect(
        (result.structuredContent?.games as Array<{ id: string }> | undefined)?.map(
          (game) => game.id,
        ),
      ).toEqual(ids);
      expect(result.structuredContent?.availableGames).toBe(5);
      for (const id of ids) expect(JSON.stringify(result.content)).toContain(id);
    }
    expect(first.structuredContent?.nextOffset).toBe(2);
    expect(second.structuredContent).toMatchObject({ nextOffset: 4 });
    expect(second.structuredContent?.nextDateFrom).toBeUndefined();
    expect(last.structuredContent).toMatchObject({
      totalReturned: 1,
      nextDateFrom: '2026-10-15',
      requestedDateTo: '2026-10-15',
    });
    expect(past.structuredContent).toMatchObject({ games: [], nextDateFrom: '2026-10-15' });
    const next = await runToolContract(sportsGetSchedule, {
      ...bounds,
      date_from: last.structuredContent?.nextDateFrom,
    });
    expect(next.structuredContent).toMatchObject({
      servedDateFrom: '2026-10-15',
      servedDateTo: '2026-10-15',
      nextOffset: 2,
    });
    expect(next.structuredContent?.nextDateFrom).toBeUndefined();
    expect(
      (next.structuredContent?.games as Array<{ id: string }> | undefined)?.map((game) => game.id),
    ).toEqual(['espn:5', 'espn:6']);
    const repeated = await runToolContract(sportsGetSchedule, { ...bounds, offset: 2 });
    expect(repeated.structuredContent).toEqual(second.structuredContent);
  });
  it('retains date continuation for an empty served subwindow', async () => {
    install(() => ({ events: [] }));
    const result = await runToolContract(sportsGetSchedule, {
      league: 'nfl',
      date_from: '2026-10-08',
      date_to: '2026-12-31',
    });
    expect(result.structuredContent).toMatchObject({
      games: [],
      availableGames: 0,
      truncated: true,
      nextDateFrom: '2026-10-15',
    });
    expect(JSON.stringify(result.content)).toContain('2026-12-31');
  });
  it('fetches a seven-day MLB range once and preserves the provider day over UTC', async () => {
    install(() => ({
      dates: [
        {
          date: '2026-10-08',
          games: [
            {
              gamePk: 1,
              gameDate: '2026-10-09T02:00Z',
              teams: {
                home: { team: { id: 1, name: 'Home', abbreviation: 'H' } },
                away: { team: { id: 2, name: 'Away', abbreviation: 'A' } },
              },
            },
          ],
        },
      ],
    }));
    const result = await runToolContract(sportsGetSchedule, {
      league: 'mlb',
      date_from: '2026-10-08',
      date_to: '2026-12-31',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].searchParams.get('endDate')).toBe('2026-10-14');
    expect(result.structuredContent).toMatchObject({
      games: [{ id: 'mlb:1', startTimeUtc: '2026-10-09T02:00Z' }],
      nextDateFrom: '2026-10-15',
    });
    expect(JSON.stringify(result.content)).toContain('mlb:1');
  });
  it('cancellation after a successful first day never becomes a partial success', async () => {
    const caller = new AbortController();
    install(() => {
      caller.abort();
      return fixtures['nfl-day'];
    });
    const result = await runToolContract(
      sportsGetSchedule,
      { league: 'nfl', date_from: '2026-10-08', date_to: '2026-10-09' },
      { context: { signal: caller.signal } },
    );
    expect(result.structuredContent).toMatchObject({ error: { code: -32011 } });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(1);
  });
  it.each([{ offset: -1 }, { limit: 0 }, { limit: 1.5 }, { league: 'unknown' }])(
    'rejects invalid pagination or league before fetch %j',
    async (args) => {
      install(() => ({ events: [] }));
      const result = await runToolContract(sportsGetSchedule, { league: 'nfl', ...args });
      expect(result.structuredContent).toMatchObject({ error: { code: -32602 } });
      expect(calls).toHaveLength(0);
    },
  );
  it('treats optional whitespace and empty date bounds as unset', async () => {
    install(() => fixtures['nfl-day']);
    const result = await runToolContract(sportsGetSchedule, {
      league: 'nfl',
      team_name: '  ',
      date_from: '',
      date_to: '   ',
    });
    expect(result.isError).not.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].searchParams.has('dates')).toBe(false);
    expect(result.structuredContent?.teamFilter).toBeUndefined();
  });
  it('selects upcoming instants without including a stale scheduled game earlier today', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
    const event = fixtures['nfl-day'].events[0];
    install((url) =>
      url.pathname.endsWith('/teams')
        ? fixtures['nfl-teams']
        : url.pathname.endsWith('/schedule')
          ? {
              events: [
                {
                  ...event,
                  id: 'earlier',
                  status: { type: { state: 'pre', name: 'STATUS_SCHEDULED' } },
                  competitions: [{ ...event.competitions[0], date: '2026-10-13T11:00Z' }],
                },
                {
                  ...event,
                  id: 'later',
                  status: { type: { state: 'pre', name: 'STATUS_SCHEDULED' } },
                  competitions: [{ ...event.competitions[0], date: '2026-10-13T13:00Z' }],
                },
              ],
            }
          : { athletes: [] },
    );
    const result = await runToolContract(sportsGetTeam, { league: 'nfl', team_name: 'Cowboys' });
    expect(result.structuredContent?.upcomingFixtures).toEqual([
      expect.objectContaining({ id: 'espn:later' }),
    ]);
    expect(JSON.stringify(result.content)).not.toContain('espn:earlier');
  });
  it('orders the retained duplicate record by its provider day rather than its discarded occurrence', async () => {
    install((url) => ({
      events:
        url.searchParams.get('dates') === '20261008'
          ? [
              {
                ...fixtures['nfl-day'].events[0],
                id: 'duplicate',
                date: '2026-10-08T01:00Z',
                competitions: [
                  { ...fixtures['nfl-day'].events[0].competitions[0], date: '2026-10-08T01:00Z' },
                ],
              },
              { ...fixtures['nfl-day'].events[0], id: 'other' },
            ]
          : [
              {
                ...fixtures['nfl-day'].events[0],
                id: 'duplicate',
                date: '2026-10-09T05:00Z',
                competitions: [
                  { ...fixtures['nfl-day'].events[0].competitions[0], date: '2026-10-09T05:00Z' },
                ],
              },
            ],
    }));
    const result = await runToolContract(sportsGetSchedule, {
      league: 'nfl',
      date_from: '2026-10-08',
      date_to: '2026-10-09',
    });
    expect(
      (result.structuredContent?.games as Array<{ id: string }> | undefined)?.map(
        (game) => game.id,
      ),
    ).toEqual(['espn:other', 'espn:duplicate']);
  });
  it('serves the final four-digit calendar day without overflowing its acquisition loop', async () => {
    install((url) =>
      url.searchParams.get('dates') === '99991231'
        ? fixtures['nfl-day']
        : new Response('Out-of-window request', { status: 400 }),
    );
    const result = await runToolContract(sportsGetSchedule, {
      league: 'nfl',
      date_from: '9999-12-31',
      date_to: '9999-12-31',
    });
    expect(result.structuredContent).toMatchObject({
      servedDateFrom: '9999-12-31',
      servedDateTo: '9999-12-31',
      truncated: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].searchParams.get('dates')).toBe('99991231');
  });
  it('preserves the provider October 8 Cowboys game across UTC midnight', async () => {
    install((url) =>
      url.pathname.endsWith('/teams') ? fixtures['nfl-teams'] : fixtures['nfl-day'],
    );
    const result = await runToolContract(sportsGetSchedule, {
      league: 'nfl',
      team_name: 'Cowboys',
      date_from: '2026-10-08',
      date_to: '2026-10-08',
    });
    expect(result.structuredContent).toMatchObject({ games: [{ id: 'espn:401872980' }] });
    expect(JSON.stringify(result.content)).toContain('espn:401872980');
    expect(calls.at(-1)?.searchParams.get('dates')).toBe('20261008');
  });
  it('acquires each served day once and preserves a classified second-day failure', async () => {
    install((url) =>
      url.searchParams.get('dates') === '20261008'
        ? fixtures['nfl-day']
        : new Response('rejected', { status: 400 }),
    );
    const result = await runToolContract(sportsGetSchedule, {
      league: 'nfl',
      date_from: '2026-10-08',
      date_to: '2026-10-09',
    });
    expect(result.structuredContent).toMatchObject({
      error: { code: -32602, data: { status: 400 } },
    });
    expect(calls.map((u) => u.searchParams.get('dates'))).toEqual(['20261008', '20261009']);
    expect(JSON.stringify(result.content)).toContain('Recovery:');
  });
  it.each(['ncaaf', 'ncaab'])('gets the complete %s inventory', async (league) => {
    install((url) =>
      url.searchParams.get('limit') === '1000'
        ? fixtures[`${league}-teams-full` as 'ncaaf-teams-full']
        : collegeDefaults[`${league}-teams-default` as 'ncaaf-teams-default'],
    );
    const games = await new espn.EspnService().getTeams(
      league === 'ncaaf' ? 'football' : 'basketball',
      league === 'ncaaf' ? 'college-football' : 'mens-college-basketball',
      createMockContext(),
    );
    expect(calls[0].searchParams.get('limit')).toBe('1000');
    expect(games.some((t) => t.espnId === (league === 'ncaaf' ? '264' : '2250'))).toBe(true);
  });
  it.each(['ncaaf', 'ncaab'] as const)(
    'normalizes every %s inventory ID with parity against the limit2000 capture',
    async (league) => {
      const selected = fixtures[`${league}-teams-full`].sports[0].leagues[0].teams;
      const projection = {
        sports: [
          {
            leagues: [
              {
                teams: collegeIds[league].full.map(
                  (id) => selected.find((record) => record.team.id === id) ?? { team: { id } },
                ),
              },
            ],
          },
        ],
      };
      install((url) =>
        url.searchParams.get('limit') === '1000'
          ? projection
          : collegeDefaults[`${league}-teams-default`],
      );
      const records = await new espn.EspnService().getTeams(
        league === 'ncaaf' ? 'football' : 'basketball',
        league === 'ncaaf' ? 'college-football' : 'mens-college-basketball',
        createMockContext(),
      );
      expect(records.map((record) => record.espnId)).toEqual(collegeIds[league]['2000']);
    },
  );
  it('includes Division I Montana game and discloses basketball scope', async () => {
    install((url) =>
      url.searchParams.get('groups') === '50'
        ? fixtures['ncaab-all-plain']
        : fixtures['ncaab-default'],
    );
    const result = await runToolContract(sportsGetScores, {
      league: 'ncaab',
      date: '2025-12-06',
      team_name: 'Montana Grizzlies',
    });
    expect(result.structuredContent).toMatchObject({ games: [{ id: 'espn:401828293' }] });
    expect(JSON.stringify(result.content)).toContain('espn:401828293');
    expect(calls[0].searchParams.has('limit')).toBe(false);
    expect(sportsGetScores.description).toContain('Division I');
  });
  it('preserves the FBS slate without a restrictive limit and discloses coverage', async () => {
    install((url) =>
      url.searchParams.get('groups') === '80' ? fixtures['ncaaf-fbs'] : fixtures['ncaaf-default'],
    );
    const result = await runToolContract(sportsGetScores, { league: 'ncaaf', date: '2026-10-10' });
    expect(result.structuredContent?.games).toHaveLength(fixtures['ncaaf-default'].events.length);
    expect(calls[0].searchParams.get('groups')).toBe('80');
    expect(calls[0].searchParams.has('limit')).toBe(false);
    expect(JSON.stringify(result)).toContain('FBS');
  });
  it('reports a populated slate removed by the team filter with typed enrichment', async () => {
    install(() => fixtures['nfl-day']);
    const result = await runToolContract(sportsGetScores, {
      league: 'nfl',
      date: '2026-10-08',
      team_name: 'zzzz',
    });
    expect(result.structuredContent).toMatchObject({
      games: [],
      emptyReason: 'no_team_matches',
      notice: expect.stringContaining('zzzz'),
      reason: expect.stringContaining('zzzz'),
    });
    expect(JSON.stringify(result.content)).toContain('no_team_matches');
  });
  it('reports a provider-empty slate distinctly', async () => {
    install(() => ({ events: [] }));
    const result = await runToolContract(sportsGetScores, { league: 'nfl', date: '2026-10-08' });
    expect(result.structuredContent).toMatchObject({
      emptyReason: 'no_games',
      notice: expect.stringContaining('No games'),
    });
    expect(JSON.stringify(result.content)).toContain('no_games');
  });
  it.each(['2026-10-13T02:00:00Z', '2026-03-08T04:30:00Z', '2026-11-01T03:30:00Z'])(
    'uses Eastern omitted-score day at %s',
    async (instant) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(instant));
      install(() => ({ events: [] }));
      const result = await runToolContract(sportsGetScores, { league: 'nfl' });
      const expected = instant.startsWith('2026-10')
        ? '2026-10-12'
        : instant.startsWith('2026-03')
          ? '2026-03-07'
          : '2026-10-31';
      expect(result.structuredContent?.date).toBe(expected);
      expect(JSON.stringify(result.content)).toContain(expected);
    },
  );
  it.each([sportsGetTeam, sportsGetSchedule])(
    '$name rejects United with all canonical candidates',
    async (definition) => {
      install((url) =>
        url.pathname.endsWith('/teams') ? fixtures['epl-teams'] : { events: [], athletes: [] },
      );
      const result = await runToolContract(definition, { league: 'epl', team_name: 'United' });
      expect(result.structuredContent).toMatchObject({
        error: { code: -32007, data: { reason: 'ambiguous_team', candidates: expect.any(Array) } },
      });
      for (const name of ['Leeds United', 'Manchester United', 'Newcastle United'])
        expect(JSON.stringify(result)).toContain(name);
      expect(calls).toHaveLength(1);
    },
  );
  it('prefers Manchester United exact abbreviation over Manchester City partial name', async () => {
    install((url) => (url.pathname.endsWith('/teams') ? fixtures['epl-teams'] : { events: [] }));
    await runToolContract(sportsGetSchedule, { league: 'epl', team_name: ' MAN ' });
    expect(calls.slice(1).every((u) => u.pathname.includes('/teams/360/'))).toBe(true);
    expect(calls.length).toBeGreaterThan(1);
  });
  it('merges soccer fixtures and selects newest completed results', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
    install((url) =>
      url.pathname.endsWith('/teams')
        ? fixtures['epl-teams']
        : url.pathname.endsWith('/schedule')
          ? url.searchParams.get('fixture') === 'true'
            ? fixtures['arsenal-fixtures']
            : fixtures['arsenal-results']
          : url.pathname.endsWith('/roster')
            ? { athletes: [] }
            : {},
    );
    const result = await runToolContract(sportsGetTeam, { league: 'epl', team_name: 'Arsenal' });
    expect(result.structuredContent).toMatchObject({
      recentResults: expect.arrayContaining([expect.objectContaining({ id: 'espn:401879268' })]),
      upcomingFixtures: expect.arrayContaining([expect.objectContaining({ id: 'espn:401878769' })]),
    });
    expect(JSON.stringify(result.content)).toContain('espn:401879268');
    expect(JSON.stringify(result.content)).toContain('espn:401878769');
  });
  it('uses NBA provider season year and requested phases despite stale top-level phase', async () => {
    install((url) =>
      url.pathname.endsWith('/teams')
        ? {
            sports: [
              {
                leagues: [
                  {
                    teams: [
                      {
                        team: {
                          id: '13',
                          name: 'Lakers',
                          displayName: 'Los Angeles Lakers',
                          abbreviation: 'LAL',
                          location: 'Los Angeles',
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          }
        : url.searchParams.get('seasontype') === '2'
          ? fixtures['lakers-regular']
          : fixtures['lakers-default'],
    );
    const games = await new espn.EspnService().getTeamSchedule(
      'basketball',
      'nba',
      '13',
      null,
      createMockContext(),
    );
    expect(games.some((g) => g.id === 'espn:401909092')).toBe(true);
    expect(
      calls.some(
        (u) => u.searchParams.get('season') === '2027' && u.searchParams.get('seasontype') === '2',
      ),
    ).toBe(true);
  });
  it('bounds long acquisitions and gives game pages before date continuation', async () => {
    install(() => ({
      events: Array.from({ length: 5 }, (_, i) => ({
        ...fixtures['nfl-day'].events[0],
        id: String(i),
      })),
    }));
    const result = await runToolContract(sportsGetSchedule, {
      league: 'nfl',
      date_from: '2026-10-08',
      date_to: '2026-12-31',
      limit: 2,
    });
    expect(calls).toHaveLength(7);
    expect(result.structuredContent).toMatchObject({
      games: expect.any(Array),
      requestedDateFrom: '2026-10-08',
      requestedDateTo: '2026-12-31',
      servedDateFrom: '2026-10-08',
      servedDateTo: '2026-10-14',
      availableGames: 5,
      effectiveLimit: 2,
      truncated: true,
      nextOffset: 2,
    });
    expect(result.structuredContent?.games).toHaveLength(2);
    expect(result.structuredContent?.nextDateFrom).toBeUndefined();
    const last = await runToolContract(sportsGetSchedule, {
      league: 'nfl',
      date_from: '2026-10-08',
      date_to: '2026-12-31',
      limit: 2,
      offset: 4,
    });
    expect(last.structuredContent).toMatchObject({ nextDateFrom: '2026-10-15' });
    expect(last.structuredContent?.nextOffset).toBeUndefined();
    for (const term of ['2026-12-31', '2026-10-14', 'nextOffset'])
      expect(JSON.stringify(result.content)).toContain(term);
  });
  it.each([{ date_from: '2026-10-08' }, { date_to: '2026-10-08' }])(
    'retrieves a single-bound day %j',
    async (bounds) => {
      install(() => fixtures['nfl-day']);
      const result = await runToolContract(sportsGetSchedule, { league: 'nfl', ...bounds });
      expect(calls[0].searchParams.get('dates')).toBe('20261008');
      expect(result.structuredContent?.games).toHaveLength(1);
    },
  );
  it.each([{ date_from: '2026-02-30' }, { date_from: '2026-09-03', date_to: '2026-09-01' }])(
    'rejects invalid bounds before fetch %j',
    async (bounds) => {
      install(() => ({ events: [] }));
      const result = await runToolContract(sportsGetSchedule, { league: 'nfl', ...bounds });
      expect(result.isError).toBe(true);
      expect(calls).toHaveLength(0);
    },
  );
});
