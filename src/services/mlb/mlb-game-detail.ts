/**
 * @fileoverview MLB live-feed game statistics, provider performers, and scoring plays.
 * @module services/mlb/mlb-game-detail
 */
import { serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import type { GameDetail, GamePerson, GameTeam } from '../types.js';

type Raw = Record<string, unknown>;
const object = (value: unknown): Raw =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {};
const records = (value: unknown): Raw[] => (Array.isArray(value) ? value.map(object) : []);
const display = (value: unknown): string | null =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : null;
const team = (raw: Raw): GameTeam => ({
  id: `mlb:${raw.id}`,
  name: String(raw.name ?? ''),
  abbreviation: String(raw.abbreviation ?? ''),
});
const person = (raw: Raw): GamePerson => ({ id: `mlb:${raw.id}`, name: display(raw.fullName) });

/** Replace cumulative boxscore rates using the game counts in the same category. */
function gameRates(category: string, raw: Raw): Record<string, string | null> {
  const count = (name: string): number => {
    const value = raw[name];
    return (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) &&
      Number.isFinite(Number(value))
      ? Number(value)
      : Number.NaN;
  };
  const ratio = (numerator: number, denominator: number) =>
    denominator > 0 ? numerator / denominator : Number.NaN;
  const render = (value: number, digits: number, batting = false) =>
    Number.isFinite(value)
      ? batting
        ? value.toFixed(digits).replace(/^0\./, '.')
        : value.toFixed(digits)
      : null;
  if (category === 'batting') {
    const obp = ratio(
      count('hits') + count('baseOnBalls') + count('hitByPitch'),
      count('atBats') + count('baseOnBalls') + count('hitByPitch') + count('sacFlies'),
    );
    const slg = ratio(count('totalBases'), count('atBats'));
    return {
      avg: render(ratio(count('hits'), count('atBats')), 3, true),
      obp: render(obp, 3, true),
      slg: render(slg, 3, true),
      ops: render(obp + slg, 3, true),
    };
  }
  if (category === 'pitching')
    return {
      era: render(ratio(27 * count('earnedRuns'), count('outs')), 2),
      whip: render(ratio(3 * (count('baseOnBalls') + count('hits')), count('outs')), 2),
    };
  return {};
}

/** Normalize only liveData game statistics; seasonStats never enter the result. */
export function normalizeMlbGameDetail(payload: unknown, gamePk: string): GameDetail {
  const data = object(payload);
  const meta = object(data.gameData);
  const live = object(data.liveData);
  const teams = object(meta.teams);
  const home = object(teams.home);
  const away = object(teams.away);
  const datetime = object(meta.datetime);
  const status = object(meta.status);
  if (
    String(data.gamePk ?? '') !== gamePk ||
    home.id == null ||
    away.id == null ||
    !datetime.dateTime ||
    !status.abstractGameState
  )
    throw serviceUnavailable('MLB live feed returned missing or mismatched game metadata.');
  const lines = object(live.linescore);
  const totals = object(lines.teams);
  const detail: GameDetail = {
    game: {
      id: `mlb:${gamePk}`,
      shortName: `${away.abbreviation ?? ''} @ ${home.abbreviation ?? ''}`,
      homeTeam: { ...team(home), score: display(object(totals.home).runs) },
      awayTeam: { ...team(away), score: display(object(totals.away).runs) },
      status: String(status.detailedState).includes('Postponed')
        ? 'postponed'
        : String(status.detailedState).includes('Cancelled')
          ? 'cancelled'
          : status.abstractGameState === 'Final'
            ? 'final'
            : status.abstractGameState === 'Live'
              ? 'in-progress'
              : 'scheduled',
      period: typeof lines.currentInning === 'number' ? lines.currentInning : null,
      clock: display(lines.inningHalf),
      startTimeUtc: String(datetime.dateTime),
      venue: display(object(meta.venue).name),
      source: 'mlbstats',
    },
    periodScores: [],
    teamStats: [],
    leaders: [],
    scoringPlays: [],
  };
  if (
    detail.game.status === 'scheduled' ||
    detail.game.status === 'postponed' ||
    detail.game.status === 'cancelled'
  ) {
    detail.game.homeTeam.score = null;
    detail.game.awayTeam.score = null;
    return detail;
  }
  detail.periodScores = records(lines.innings)
    .filter((inning) => typeof inning.num === 'number')
    .map((inning) => ({
      period: inning.num as number,
      label: display(inning.ordinalNum),
      homeScore: display(object(inning.home).runs),
      awayScore: display(object(inning.away).runs),
    }));
  const box = object(live.boxscore);
  for (const side of ['away', 'home'] as const) {
    const raw = object(object(box.teams)[side]);
    const statistics: GameDetail['teamStats'][number]['statistics'] = [];
    for (const [category, values] of Object.entries(object(raw.teamStats))) {
      const rates = gameRates(category, object(values));
      for (const [name, value] of Object.entries(object(values))) {
        if (value == null || typeof value === 'string' || typeof value === 'number')
          statistics.push({
            name: `${category}.${name}`,
            label: name,
            // biome-ignore lint/style/noNonNullAssertion: Own-key check proves the calculated rate exists.
            value: Object.hasOwn(rates, name) ? rates[name]! : display(value),
          });
      }
    }
    if (statistics.length)
      detail.teamStats.push({ team: team(side === 'home' ? home : away), statistics });
  }
  for (const performer of records(box.topPerformers)) {
    const player = object(performer.player);
    const athlete = object(player.person);
    const performerTeam = [home, away].find(
      (raw) => String(raw.id) === String(player.parentTeamId),
    );
    if (!performerTeam || athlete.id == null) continue;
    const stats = object(player.stats);
    const summary =
      display(object(stats.batting).summary) ?? display(object(stats.pitching).summary);
    detail.leaders.push({
      team: team(performerTeam),
      category: String(performer.type ?? ''),
      label: 'Provider top performer',
      player: person(athlete),
      displayValue: summary,
    });
  }
  const plays = object(live.plays);
  const allPlays = records(plays.allPlays);
  for (const index of Array.isArray(plays.scoringPlays) ? plays.scoringPlays : []) {
    if (typeof index !== 'number' || !Number.isInteger(index) || !allPlays[index])
      throw serviceUnavailable('MLB live feed contains an invalid scoring-play index.');
    const play = allPlays[index];
    const about = object(play.about);
    const result = object(play.result);
    const participants = new Map<string, GamePerson>();
    const batter = object(object(play.matchup).batter);
    if (batter.id != null) participants.set(String(batter.id), person(batter));
    for (const runner of records(play.runners)) {
      const athlete = object(object(runner.details).runner);
      if (athlete.id != null) participants.set(String(athlete.id), person(athlete));
    }
    detail.scoringPlays.push({
      id: display(about.atBatIndex),
      period: typeof about.inning === 'number' ? about.inning : null,
      clock: display(about.halfInning),
      teamId:
        about.isTopInning === true
          ? `mlb:${away.id}`
          : about.isTopInning === false
            ? `mlb:${home.id}`
            : null,
      text: String(result.description ?? ''),
      homeScore: display(result.homeScore),
      awayScore: display(result.awayScore),
      participants: [...participants.values()],
    });
  }
  return detail;
}
