/**
 * @fileoverview Game status and calendar heading contracts through provider fetch and MCP output.
 * @module tests/tools/game-status-detail.test
 */

import { readFileSync } from 'node:fs';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, expect, it, vi } from 'vitest';
import { sportsGetGame } from '@/mcp-server/tools/definitions/sports-get-game.tool.js';
import { sportsGetSchedule } from '@/mcp-server/tools/definitions/sports-get-schedule.tool.js';
import { sportsGetScores } from '@/mcp-server/tools/definitions/sports-get-scores.tool.js';
import { sportsGetTeam } from '@/mcp-server/tools/definitions/sports-get-team.tool.js';
import * as espn from '@/services/espn/espn-service.js';
import * as mlb from '@/services/mlb/mlb-service.js';

function readCapture(name: string) {
  const capture = JSON.parse(
    readFileSync(new URL(`../fixtures/game-detail/${name}.json`, import.meta.url), 'utf8'),
  );
  return JSON.parse(capture.body);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps an ESPN pregame event on its provider day without score or clock placeholders', async () => {
  const board = readCapture('nfl-board');
  const event = board.events[0];
  event.status.type.state = 'pre';
  event.status.type.name = 'STATUS_SCHEDULED';
  event.status.displayClock = '0:00';
  event.competitions[0].date = '2026-10-09T00:15Z';
  for (const competitor of event.competitions[0].competitors) competitor.score = '0';
  board.events = [event];
  vi.spyOn(espn, 'getEspnService').mockReturnValue(new espn.EspnService());
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(board)),
  );

  const scores = await runToolContract(sportsGetScores, { league: 'nfl', date: '2026-10-08' });
  const schedule = await runToolContract(sportsGetSchedule, {
    league: 'nfl',
    date_from: '2026-10-08',
    date_to: '2026-10-08',
  });
  for (const response of [scores, schedule]) {
    expect(response.structuredContent).toMatchObject({
      games: [
        {
          status: 'scheduled',
          homeTeam: { score: null },
          awayTeam: { score: null },
          clock: null,
          startTimeUtc: '2026-10-09T00:15Z',
        },
      ],
    });
    expect(response.content[0]).toMatchObject({ text: expect.stringContaining('2026-10-08') });
    expect(response.content[0]).toMatchObject({
      text: expect.not.stringMatching(/— 0|Clock: 0:00/),
    });
  }
});

it('carries MLB schedule detail through scores, schedule, and the separately mapped team rows', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-06T12:00:00Z'));
  const mariners = { id: 136, name: 'Seattle Mariners', abbreviation: 'SEA' };
  const oakland = { id: 133, name: 'Athletics', abbreviation: 'ATH' };
  const game = {
    gamePk: 111,
    gameDate: '2026-07-05T01:00:00Z',
    status: { abstractGameState: 'Final', detailedState: 'Game Over' },
    teams: { home: { team: mariners, score: 5 }, away: { team: oakland, score: 0 } },
  };
  vi.spyOn(mlb, 'getMlbService').mockReturnValue(new mlb.MlbService());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const pathname = new URL(input).pathname;
      if (pathname.endsWith('/roster')) return Response.json({ roster: [] });
      if (pathname.endsWith('/teams')) return Response.json({ teams: [mariners] });
      return Response.json({ dates: [{ date: '2026-07-04', games: [game] }] });
    }),
  );

  const scores = await runToolContract(sportsGetScores, { league: 'mlb', date: '2026-07-04' });
  const schedule = await runToolContract(sportsGetSchedule, {
    league: 'mlb',
    date_from: '2026-07-04',
    date_to: '2026-07-04',
  });
  const team = await runToolContract(sportsGetTeam, { league: 'mlb', team_name: 'Mariners' });
  for (const response of [scores, schedule, team]) {
    expect(response.isError).not.toBe(true);
    expect(response.content[0]).toMatchObject({
      text: expect.stringContaining('final | Status detail: Game Over'),
    });
  }
  const expected = [{ id: 'mlb:111', status: 'final', statusDetail: 'Game Over' }];
  expect(scores.structuredContent).toMatchObject({ games: expected });
  expect(schedule.structuredContent).toMatchObject({ games: expected });
  expect(team.structuredContent).toMatchObject({ recentResults: expected });
});

it('preserves competition-level ESPN detail and the full UTC start on both result surfaces', async () => {
  const summary = readCapture('nfl-board-summary');
  const competition = summary.header.competitions[0];
  competition.status.type.shortDetail = 'Final/OT';
  competition.date = '2026-10-09T00:15Z';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(summary)),
  );
  vi.spyOn(espn, 'getEspnService').mockReturnValue(new espn.EspnService());
  const response = await runToolContract(sportsGetGame, {
    league: 'nfl',
    game_id: 'espn:401872981',
  });
  expect(response.structuredContent).toMatchObject({
    game: { status: 'final', statusDetail: 'Final/OT', startTimeUtc: '2026-10-09T00:15Z' },
  });
  expect(response.content[0]).toMatchObject({
    type: 'text',
    text: expect.stringMatching(/^\*\*NFL Game\*\* \(league: nfl\)\n/),
  });
  expect(response.content[0]).toMatchObject({
    text: expect.stringContaining('final | Status detail: Final/OT'),
  });
  expect(response.content[0]).toMatchObject({ text: expect.stringContaining('2026-10-09T00:15Z') });
});

it('preserves MLB live-feed delay detail and omits the text label when unavailable', async () => {
  const feed = readCapture('mlb-board-feed');
  feed.gameData.status.detailedState = 'Delayed: Rain';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(feed)),
  );
  vi.spyOn(mlb, 'getMlbService').mockReturnValue(new mlb.MlbService());
  const args = { league: 'mlb', game_id: `mlb:${feed.gamePk}` };
  const delayed = await runToolContract(sportsGetGame, args);
  expect(delayed.structuredContent).toMatchObject({ game: { statusDetail: 'Delayed: Rain' } });
  expect(delayed.content[0]).toMatchObject({
    text: expect.stringContaining('Status detail: Delayed: Rain'),
  });
  delete feed.gameData.status.detailedState;
  const missing = await runToolContract(sportsGetGame, args);
  expect(missing.structuredContent).toMatchObject({ game: { statusDetail: null } });
  expect(missing.content[0]).toMatchObject({
    text: expect.not.stringContaining('Status detail:'),
  });
});
