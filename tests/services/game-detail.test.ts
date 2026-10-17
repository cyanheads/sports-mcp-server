/**
 * @fileoverview Captured game detail contracts at the provider HTTP boundary.
 * @module tests/services/game-detail.test
 */
import { readFileSync } from 'node:fs';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EspnService } from '@/services/espn/espn-service.js';
import { normalizeMlbGameDetail } from '@/services/mlb/mlb-game-detail.js';
import { MlbService } from '@/services/mlb/mlb-service.js';

function capture(name: string): { body: string; status: number } {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/game-detail/${name}.json`, import.meta.url), 'utf8'),
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('game record characterization', () => {
  it('retains ESPN source-prefixed scoreboard IDs and zero scores', async () => {
    const fixture = capture('nfl-board');
    const raw = JSON.parse(fixture.body);
    raw.events[0].competitions[0].competitors[0].score = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Response.json(raw, { status: fixture.status })),
    );
    const games = await new EspnService().getScoreboard(
      'football',
      'nfl',
      null,
      createMockContext(),
    );
    expect(games.map((game) => game.id)).toContain('espn:401872981');
    expect(games.every((game) => game.id.startsWith('espn:'))).toBe(true);
    expect(games.find((game) => game.id === 'espn:401872981')).toMatchObject({
      homeTeam: { score: '0' },
      awayTeam: { score: '17' },
    });
  });
});

describe('game detail', () => {
  it('derives game rates from counts, keeping faithful game displays', () => {
    const raw = JSON.parse(capture('mlb-board-feed').body);
    raw.liveData.boxscore.teams.away.teamStats = {
      batting: {
        hits: 5,
        atBats: 31,
        baseOnBalls: 3,
        hitByPitch: 0,
        sacFlies: 1,
        totalBases: 8,
        avg: '.999',
        obp: '.999',
        slg: '.999',
        ops: '9.999',
        toString: 'provider text',
      },
      pitching: {
        hits: 9,
        baseOnBalls: 0,
        earnedRuns: 1,
        outs: 25,
        inningsPitched: '8.1',
        era: '9.99',
        whip: '9.99',
        strikePercentage: '.600',
      },
    };
    const stats = Object.fromEntries(
      normalizeMlbGameDetail(raw, '849809').teamStats[0]!.statistics.map((s) => [s.name, s.value]),
    );
    expect(stats).toMatchObject({
      'batting.avg': '.161',
      'batting.obp': '.229',
      'batting.slg': '.258',
      'batting.ops': '.487',
      'batting.toString': 'provider text',
      'pitching.era': '1.08',
      'pitching.whip': '1.08',
      'pitching.strikePercentage': '.600',
    });
  });

  it('combines unrounded OBP and SLG for OPS', () => {
    const raw = JSON.parse(capture('mlb-board-feed').body);
    raw.liveData.boxscore.teams.away.teamStats = {
      batting: {
        hits: 1,
        atBats: 3,
        baseOnBalls: 0,
        hitByPitch: 0,
        sacFlies: 0,
        totalBases: 1,
        obp: '.999',
        slg: '.999',
        ops: '9.999',
      },
    };
    expect(normalizeMlbGameDetail(raw, '849809').teamStats[0]!.statistics).toEqual([
      { name: 'batting.hits', label: 'hits', value: '1' },
      { name: 'batting.atBats', label: 'atBats', value: '3' },
      { name: 'batting.baseOnBalls', label: 'baseOnBalls', value: '0' },
      { name: 'batting.hitByPitch', label: 'hitByPitch', value: '0' },
      { name: 'batting.sacFlies', label: 'sacFlies', value: '0' },
      { name: 'batting.totalBases', label: 'totalBases', value: '1' },
      { name: 'batting.obp', label: 'obp', value: '.333' },
      { name: 'batting.slg', label: 'slg', value: '.333' },
      { name: 'batting.ops', label: 'ops', value: '.667' },
    ]);
  });

  it.each([
    [{ hits: 0, atBats: 1 }, '.000'],
    [{ hits: 0, atBats: 0 }, null],
    [{ hits: 1 }, null],
    [{ hits: '', atBats: 3 }, null],
  ])('preserves unknown and zero batting rates %j', (counts, expected) => {
    const raw = JSON.parse(capture('mlb-board-feed').body);
    raw.liveData.boxscore.teams.away.teamStats = { batting: { ...counts, avg: '.999' } };
    expect(
      normalizeMlbGameDetail(raw, '849809').teamStats[0]!.statistics.find(
        (s) => s.name === 'batting.avg',
      )?.value,
    ).toBe(expected);
  });
  it.each(['espn', 'mlb'])(
    'retries a genuine %s outage through the existing transport',
    async (source) => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const fixture = capture(source === 'espn' ? 'nfl-board-summary' : 'mlb-board-feed');
      const fetch = vi
        .fn(() => new Response(fixture.body))
        .mockImplementationOnce(() => Response.json({ message: 'Unavailable' }, { status: 503 }));
      vi.stubGlobal('fetch', fetch);
      const pending =
        source === 'mlb'
          ? new MlbService().getGame('849809', createMockContext())
          : new EspnService().getGame('football', 'nfl', '401872981', createMockContext());
      await vi.runAllTimersAsync();
      expect((await pending).game.status).toBe('final');
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it('rejects a malformed MLB scoring index without silently losing events', async () => {
    const raw = JSON.parse(capture('mlb-board-feed').body);
    raw.liveData.plays.scoringPlays.push(999999);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Response.json(raw)),
    );
    await expect(new MlbService().getGame('849809', createMockContext())).rejects.toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
    });
  });
  it('classifies malformed nested ESPN game metadata as a provider failure', async () => {
    const raw = JSON.parse(capture('nfl-board-summary').body);
    raw.header.competitions[0].competitors = [null];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Response.json(raw)),
    );
    await expect(
      new EspnService().getGame('football', 'nfl', '401872981', createMockContext()),
    ).rejects.toMatchObject({ code: JsonRpcErrorCode.ServiceUnavailable });
  });
  it('returns NFL game performance from the league-routed summary', async () => {
    const fixture = capture('nfl-board-summary');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response(fixture.body, { status: fixture.status })),
    );
    const detail = await new EspnService().getGame(
      'football',
      'nfl',
      '401872981',
      createMockContext(),
    );
    expect(detail.game.id).toBe('espn:401872981');
    expect(detail.periodScores).toHaveLength(4);
    expect(detail.leaders.some((leader) => leader.category === 'rushingYards')).toBe(true);
    expect(detail.scoringPlays[0]?.awayScore).toBe('0');
  });

  it.each([
    ['nba-summary', 'basketball', 'nba', '401766128', 108],
    ['nhl-summary', 'hockey', 'nhl', '401777460', 6],
    ['epl-summary', 'soccer', 'eng.1', '704559', 1],
  ])('normalizes captured %s scoring events', async (name, sport, league, id, count) => {
    const fixture = capture(String(name));
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response(fixture.body, { status: fixture.status })),
    );
    const detail = await new EspnService().getGame(
      String(sport),
      String(league),
      String(id),
      createMockContext(),
    );
    expect(detail.scoringPlays).toHaveLength(Number(count));
    expect(detail.teamStats).toHaveLength(2);
    expect(detail.leaders.length).toBeGreaterThan(0);
    expect(JSON.stringify(detail)).not.toContain('ytdGoals');
    if (league === 'eng.1') expect(detail.scoringPlays[0]?.homeScore).toBeNull();
    if (league === 'nba')
      expect(detail.scoringPlays[0]?.participants[0]?.name).toBe('Andrew Nembhard');
  });

  it('preserves MLB zeros, missing bottom inning, game-only performers, and indexed scoring plays', async () => {
    const fixture = capture('mlb-board-feed');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response(fixture.body, { status: fixture.status })),
    );
    const detail = await new MlbService().getGame('849809', createMockContext());
    expect(detail.game.id).toBe('mlb:849809');
    expect(detail.periodScores).toHaveLength(9);
    expect(detail.periodScores[8]).toMatchObject({ homeScore: null, awayScore: '0' });
    expect(detail.leaders[0]).toMatchObject({
      player: { name: 'Brice Turang' },
      displayValue: '1-2 | HR, BB, RBI',
    });
    expect(detail.scoringPlays.map((play) => play.id)).toEqual(['9', '27', '36']);
    expect(detail.scoringPlays[0]?.participants.map((player) => player.name)).toContain(
      'Shohei Ohtani',
    );
    expect(detail.scoringPlays[0]?.participants.map((player) => player.id)).toEqual([
      ...new Set(detail.scoringPlays[0]?.participants.map((player) => player.id)),
    ]);
    expect(JSON.stringify(detail)).not.toContain('seasonStats');
  });

  it.each(['nfl-future-summary', 'mlb-future-feed'])(
    'suppresses pregame performance in %s',
    async (name) => {
      const fixture = capture(name);
      vi.stubGlobal(
        'fetch',
        vi.fn(() => new Response(fixture.body, { status: fixture.status })),
      );
      const raw = JSON.parse(fixture.body);
      const detail = name.startsWith('mlb')
        ? await new MlbService().getGame(String(raw.gamePk), createMockContext())
        : await new EspnService().getGame(
            'football',
            'nfl',
            String(raw.header.id),
            createMockContext(),
          );
      expect(detail.game.status).toBe('scheduled');
      expect(detail).toMatchObject({
        periodScores: [],
        teamStats: [],
        leaders: [],
        scoringPlays: [],
      });
    },
  );

  it.each([
    ['nfl-missing', 'football', 'nfl', '999999999999'],
    ['wrong-league', 'basketball', 'nba', '401872981'],
    ['mlb-missing', '', '', '999999999999'],
  ])('classifies captured %s as game_not_found', async (name, sport, league, id) => {
    const fixture = capture(name);
    const request = vi.fn(() => new Response(fixture.body, { status: fixture.status }));
    vi.stubGlobal('fetch', request);
    const call = name.startsWith('mlb')
      ? new MlbService().getGame(id, createMockContext())
      : new EspnService().getGame(sport, league, id, createMockContext());
    await expect(call).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      data: { reason: 'game_not_found' },
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(['espn', 'mlb'])('retains unrelated %s provider 400 errors', async (source) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Response.json({ message: 'Invalid unrelated parameter' }, { status: 400 })),
    );
    const call =
      source === 'mlb'
        ? new MlbService().getGame('999999999999', createMockContext())
        : new EspnService().getGame('football', 'nfl', '999999999999', createMockContext());
    await expect(call).rejects.toMatchObject({ code: JsonRpcErrorCode.InvalidParams });
  });

  it.each(['espn', 'mlb'])(
    'treats malformed %s success metadata as a provider failure',
    async (source) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Response.json({})),
      );
      const call =
        source === 'mlb'
          ? new MlbService().getGame('849809', createMockContext())
          : new EspnService().getGame('football', 'nfl', '401872981', createMockContext());
      await expect(call).rejects.toMatchObject({ code: JsonRpcErrorCode.ServiceUnavailable });
    },
  );
});
