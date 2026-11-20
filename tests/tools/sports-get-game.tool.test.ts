/**
 * @fileoverview Game detail wiring, pagination reconstruction, and both public response surfaces.
 * @module tests/tools/sports-get-game.tool.test
 */
import { readFileSync } from 'node:fs';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sportsGetGame } from '@/mcp-server/tools/definitions/sports-get-game.tool.js';
import * as espnModule from '@/services/espn/espn-service.js';
import * as mlbModule from '@/services/mlb/mlb-service.js';

const capture = (name: string): { body: string; status: number } =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/game-detail/${name}.json`, import.meta.url), 'utf8'),
  );
const input = { league: 'nba', game_id: 'espn:401766128' };
beforeEach(() => {
  vi.spyOn(espnModule, 'getEspnService').mockReturnValue(new espnModule.EspnService());
  vi.spyOn(mlbModule, 'getMlbService').mockReturnValue(new mlbModule.MlbService());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Install the immutable captured provider body at fetch, retaining parsing/retry/normalization. */
function serve(name: string) {
  const fixture = capture(name);
  const fetch = vi.fn(() => new Response(fixture.body, { status: fixture.status }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const text = (result: Awaited<ReturnType<typeof runToolContract>>) =>
  result.content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n');

describe('sports_get_game', () => {
  it('shows game-derived MLB rates on both callable surfaces', async () => {
    const raw = JSON.parse(capture('mlb-board-feed').body);
    raw.liveData.boxscore.teams.away.teamStats.batting = { hits: 5, atBats: 31, avg: '.258' };
    raw.liveData.boxscore.teams.home.teamStats.pitching = { earnedRuns: 1, outs: 27, era: '3.10' };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Response.json(raw)),
    );
    const result = await runToolContract(sportsGetGame, { league: 'mlb', game_id: 'mlb:849809' });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.structuredContent)).toContain('.161');
    expect(text(result)).toContain('batting.avg (avg): .161');
    expect(text(result)).toContain('pitching.era (era): 1.00');
  });
  it('keeps sparse sections and missing scores honest on both surfaces', async () => {
    const raw = JSON.parse(capture('epl-summary').body);
    delete raw.boxscore;
    delete raw.leaders;
    raw.gameInfo = null;
    delete raw.header.competitions[0].competitors[0].score;
    for (const event of raw.keyEvents) {
      delete event.period;
      delete event.clock;
      delete event.participants;
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Response.json(raw)),
    );
    const result = await runToolContract(sportsGetGame, { league: 'epl', game_id: 'espn:704559' });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      teamStats: [],
      leaders: [],
      game: { homeTeam: { score: null } },
    });
    expect(
      (result.structuredContent.scoringPlays as Array<Record<string, unknown>>)[0],
    ).toMatchObject({ period: null, clock: null, participants: [], homeScore: null });
    expect(text(result)).toContain('Period N/A');
    expect(text(result)).toContain('Home N/A');
  });
  it('reconstructs every NBA event across default, next, end, and past-end pages', async () => {
    const fetch = serve('nba-summary');
    const all = await new espnModule.EspnService().getGame(
      'basketball',
      'nba',
      '401766128',
      createMockContext(),
    );
    const ids: unknown[] = [];
    let offset = 0;
    while (true) {
      const result = await runToolContract(sportsGetGame, { ...input, offset });
      expect(result.isError).not.toBe(true);
      const page = result.structuredContent;
      expect(page.totalCount).toBe(108);
      expect(page.teamStats).toEqual(all.teamStats);
      expect(page.leaders).toEqual(all.leaders);
      expect(page.periodScores).toEqual(all.periodScores);
      const plays = page.scoringPlays as typeof all.scoringPlays;
      ids.push(...plays.map((play) => play.id));
      expect(page.servedFrom).toBe(offset);
      expect(page.servedTo).toBe(offset + plays.length - 1);
      expect(text(result)).toContain('totalCount');
      expect(text(result)).toContain('nextOffset');
      for (const play of plays) {
        expect(text(result)).toContain(String(play.id));
        expect(text(result)).toContain(play.text);
      }
      if (page.nextOffset == null) break;
      offset = page.nextOffset as number;
    }
    expect(ids).toEqual(all.scoringPlays.map((play) => play.id));
    expect(new Set(ids).size).toBe(108);
    const past = await runToolContract(sportsGetGame, { ...input, offset: 108 });
    expect(past.structuredContent).toMatchObject({
      scoringPlays: [],
      returnedCount: 0,
      servedFrom: null,
      servedTo: null,
      nextOffset: null,
    });
    expect(text(past)).toContain('past');
    expect(fetch.mock.calls.length).toBe(8);
  });

  it('clips a larger limit, exposes the cap, and preserves zero on both surfaces', async () => {
    serve('nba-summary');
    const result = await runToolContract(sportsGetGame, { ...input, limit: 100 });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      effectiveLimit: 50,
      returnedCount: 50,
      truncationCeiling: 50,
      nextOffset: 50,
    });
    expect(text(result)).toContain('clipped to 50');
    expect(result.structuredContent).toHaveProperty('scoringPlays.0.homeScore', '0');
    expect(text(result).split('Scoring plays:\n')[1]).toMatch(/ \/ Home 0: /);
  });

  it('reconstructs scoring-only pages through the cap and final page', async () => {
    serve('nba-summary');
    const omitted = ['periodScores', 'teamStats', 'leaders'];
    for (const [offset, returnedCount, nextOffset] of [
      [0, 50, 50],
      [50, 50, 100],
      [100, 8, null],
      [108, 0, null],
    ] as const) {
      const args = { ...input, offset, limit: 60 };
      const full = await runToolContract(sportsGetGame, args);
      const page = await runToolContract(sportsGetGame, { ...args, sections: ['scoringPlays'] });
      expect(page.structuredContent).toEqual({
        ...full.structuredContent,
        periodScores: [],
        teamStats: [],
        leaders: [],
        omittedSections: omitted,
        totalCount: 108,
        returnedCount,
        nextOffset,
      });
      expect(text(page)).toContain('**omittedSections:** periodScores, teamStats, leaders');
      expect(text(page).split('Scoring plays:\n')[1]?.split('\n\n')[0]).toBe(
        text(full).split('Scoring plays:\n')[1]?.split('\n\n')[0],
      );
      expect(text(page)).toContain('clipped to 50');
      if (offset === 108) expect(text(page)).toContain('past the 108 available scoring plays');
    }
  });

  it('returns only selected details and no continuation when scoring plays are excluded', async () => {
    serve('nba-summary');
    const args = { ...input, offset: 200, limit: 60 };
    const full = await runToolContract(sportsGetGame, args);
    const selected = await runToolContract(sportsGetGame, { ...args, sections: ['teamStats'] });
    expect(selected.structuredContent).toMatchObject({
      game: { id: input.game_id },
      teamStats: full.structuredContent.teamStats,
      periodScores: [],
      leaders: [],
      scoringPlays: [],
      omittedSections: ['periodScores', 'leaders', 'scoringPlays'],
      totalCount: 108,
      offset: 200,
      effectiveLimit: 50,
      returnedCount: 0,
      servedFrom: null,
      servedTo: null,
      nextOffset: null,
    });
    expect(selected.structuredContent).not.toHaveProperty('truncationCeiling');
    expect(selected.structuredContent).not.toHaveProperty('notice');
    expect(text(selected)).toContain('fieldGoalsMade-fieldGoalsAttempted');
    expect(text(selected)).toContain('**omittedSections:** periodScores, leaders, scoringPlays');
    expect(text(selected)).not.toMatch(/clipped|past the 108|No scoring plays/);
  });

  it('distinguishes selected empty sections from an empty selector on a scheduled game', async () => {
    serve('nfl-future-summary');
    const args = { league: 'nfl', game_id: 'espn:401872996' };
    const keys = ['periodScores', 'teamStats', 'leaders', 'scoringPlays'];
    const full = await runToolContract(sportsGetGame, args);
    const all = await runToolContract(sportsGetGame, { ...args, sections: keys });
    expect(all.structuredContent).toEqual(full.structuredContent);
    expect(text(all)).toBe(text(full));
    const none = await runToolContract(sportsGetGame, { ...args, sections: [] });
    expect(none.structuredContent).toMatchObject({
      game: { id: args.game_id, status: 'scheduled' },
      periodScores: [],
      teamStats: [],
      leaders: [],
      scoringPlays: [],
      omittedSections: keys,
      totalCount: 0,
    });
    expect(none.structuredContent).not.toHaveProperty('notice');
    expect(text(none)).toContain(
      '**omittedSections:** periodScores, teamStats, leaders, scoringPlays',
    );
    expect(text(none)).not.toContain('scheduled games have no played statistics');
  });

  it.each([
    [
      'nfl-board-summary',
      'nfl',
      'espn:401872981',
      'Trevor Lawrence',
      '24/39, 331 YDS, 2 TD, 1 INT',
      'firstDowns',
      '13',
    ],
    ['nhl-summary', 'nhl', 'espn:401777460', 'Carter Verhaeghe', '3', 'blockedShots', '15'],
    ['epl-summary', 'epl', 'espn:704559', 'Declan Rice', '3', 'foulsCommitted', '10'],
    [
      'mlb-board-feed',
      'mlb',
      'mlb:849809',
      'Brice Turang',
      '1-2 | HR, BB, RBI',
      'batting.flyOuts',
      '7',
    ],
  ])(
    'returns schema-valid game details on both surfaces for %s',
    async (fixture, league, game_id, player, performance, statistic, value) => {
      const fetch = serve(fixture);
      const result = await runToolContract(sportsGetGame, { league, game_id });
      expect(result.isError).not.toBe(true);
      expect(text(result)).toContain(game_id);
      expect(result.structuredContent).toMatchObject({
        game: { id: game_id, status: 'final' },
      });
      expect(result.structuredContent).toHaveProperty('leaders.0.player.name', player);
      expect(result.structuredContent).toHaveProperty('leaders.0.displayValue', performance);
      expect(result.structuredContent).toHaveProperty('teamStats.0.statistics.0.name', statistic);
      expect(result.structuredContent).toHaveProperty('teamStats.0.statistics.0.value', value);
      const sections = text(result).split('Provider game leaders:\n');
      expect(sections[1]?.split('Scoring plays:')[0]).toContain(`: ${player} [`);
      expect(sections[1]?.split('Scoring plays:')[0]).toContain(`, ${performance}\n`);
      expect(sections[0]?.split('Team statistics:\n')[1]).toMatch(
        new RegExp(`^  ${statistic.replaceAll('.', '\\.')} \\([^\\n]+\\): ${value}$`, 'm'),
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['nfl-future-summary', 'nfl', 'espn:401872996'],
    ['mlb-future-feed', 'mlb', 'mlb:849806'],
  ])(
    'explains empty scheduled sections on both surfaces for %s',
    async (fixture, league, game_id) => {
      serve(fixture);
      const result = await runToolContract(sportsGetGame, { league, game_id });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        leaders: [],
        scoringPlays: [],
        totalCount: 0,
        nextOffset: null,
      });
      expect(text(result)).toContain('scheduled games have no played statistics');
    },
  );

  it.each([
    { ...input, game_id: 'tsdb:1' },
    { ...input, game_id: 'espn:not-numeric' },
    { ...input, game_id: 'espn:1'.repeat(100) },
    { ...input, offset: -1 },
    { ...input, limit: 0 },
    { ...input, limit: 1.5 },
    { ...input, sections: ['boxscore'] },
    { game_id: 'espn:1' },
  ])('rejects invalid input before fetching: %j', async (args) => {
    const fetch = serve('nba-summary');
    const result = await runToolContract(sportsGetGame, args);
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toMatchObject({ code: JsonRpcErrorCode.InvalidParams });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns compatible-source recovery on both surfaces', async () => {
    const fetch = serve('nba-summary');
    const result = await runToolContract(sportsGetGame, { league: 'nfl', game_id: 'mlb:849809' });
    expect(result.structuredContent.error).toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: {
        reason: 'incompatible_game_source',
        recovery: { hint: sportsGetGame.errors?.[0]?.recovery },
      },
    });
    expect(text(result)).toContain('Use league mlb');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns not-found recovery for a schema-valid unknown ID on both surfaces', async () => {
    serve('nfl-missing');
    const result = await runToolContract(sportsGetGame, {
      league: 'nfl',
      game_id: 'espn:999999999999',
    });
    expect(result.structuredContent.error).toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      data: { reason: 'game_not_found', recovery: { hint: sportsGetGame.errors?.[1]?.recovery } },
    });
    expect(text(result)).toContain('Check the league');
  });

  it.each(['mlb:0', 'mlb:1'])(
    'returns not-found recovery for the MLB placeholder for %s',
    async (game_id) => {
      const fetch = serve('mlb-unknown-feed');
      const result = await runToolContract(sportsGetGame, { league: 'mlb', game_id });
      expect(result.structuredContent.error).toMatchObject({
        code: JsonRpcErrorCode.NotFound,
        data: {
          reason: 'game_not_found',
          recovery: { hint: expect.stringContaining('Check the league') },
        },
      });
      expect(text(result)).toContain('game_not_found');
      expect(text(result)).toContain('Check the league');
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('cancels in-flight fetch without returning partial performance', async () => {
    const caller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetch = vi.fn(
      (_url: unknown, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          started();
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const pending = runToolContract(sportsGetGame, input, { context: { signal: caller.signal } });
    await ready;
    caller.abort();
    const result = await pending;
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toMatchObject({
      code: JsonRpcErrorCode.RequestCancelled,
    });
    expect(text(result)).toMatch(/cancel|abort/i);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
