/**
 * @fileoverview ESPN summary normalization for game-only statistics and scoring events.
 * @module services/espn/espn-game-detail
 */
import { serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import type { GameDetail, GamePerson, GameTeam, NormalizedGame } from '../types.js';

type Raw = Record<string, unknown>;
const object = (value: unknown): Raw =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {};
const records = (value: unknown): Raw[] => (Array.isArray(value) ? value.map(object) : []);
const display = (value: unknown): string | null =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : null;
const score = (value: unknown): string | null =>
  display(value) ?? display(object(value).displayValue) ?? display(object(value).value);
const team = (raw: Raw): GameTeam => ({
  id: `espn:${raw.id}`,
  name: String(raw.displayName ?? raw.name ?? ''),
  abbreviation: String(raw.abbreviation ?? ''),
});
const person = (raw: Raw): GamePerson => ({
  id: `espn:${raw.id}`,
  name: display(raw.displayName ?? raw.fullName),
});

/** Normalize a validated summary against the existing game metadata projection. */
export function normalizeEspnGameDetail(payload: unknown, game: NormalizedGame): GameDetail {
  const data = object(payload);
  const comp = records(object(data.header).competitions)[0];
  if (!comp) throw serviceUnavailable('ESPN summary is missing its competition.');
  const detail: GameDetail = {
    game,
    periodScores: [],
    teamStats: [],
    leaders: [],
    scoringPlays: [],
  };
  if (game.status === 'scheduled' || game.status === 'postponed' || game.status === 'cancelled')
    return detail;
  const sides = records(comp.competitors);
  const home = records(sides.find((side) => side.homeAway === 'home')?.linescores);
  const away = records(sides.find((side) => side.homeAway === 'away')?.linescores);
  const periods = new Map<number, { home?: Raw; away?: Raw }>();
  for (const [side, lines] of [
    ['home', home],
    ['away', away],
  ] as const) {
    lines.forEach((line, index) => {
      const period = typeof line.period === 'number' ? line.period : index + 1;
      const entry = periods.get(period) ?? {};
      entry[side] = line;
      periods.set(period, entry);
    });
  }
  detail.periodScores = [...periods]
    .sort(([a], [b]) => a - b)
    .map(([period, sides]) => ({
      period,
      label: display(sides.home?.label ?? sides.away?.label),
      homeScore: score(sides.home),
      awayScore: score(sides.away),
    }));
  detail.teamStats = records(object(data.boxscore).teams).map((entry) => ({
    team: team(object(entry.team)),
    statistics: records(entry.statistics).map((stat) => ({
      name: String(stat.name ?? ''),
      label: display(stat.label ?? stat.displayName),
      value: display(stat.displayValue ?? stat.value),
    })),
  }));
  for (const group of records(data.leaders)) {
    for (const category of records(group.leaders)) {
      for (const leader of records(category.leaders)) {
        const athlete = object(leader.athlete);
        if (athlete.id == null) continue;
        detail.leaders.push({
          team: team(object(group.team)),
          category: String(category.name ?? ''),
          label: display(category.displayName),
          player: person(athlete),
          displayValue: display(leader.displayValue),
        });
      }
    }
  }
  // Scoring sources are alternatives: using all three duplicates events in some leagues.
  const plays = Array.isArray(data.scoringPlays)
    ? records(data.scoringPlays)
    : Array.isArray(data.plays)
      ? records(data.plays).filter((play) => play.scoringPlay === true)
      : records(data.keyEvents).filter(
          (play) =>
            play.scoringPlay === true || String(object(play.type).type ?? '').startsWith('goal'),
        );
  const names = new Map<string, GamePerson>();
  for (const group of records(object(data.boxscore).players)) {
    for (const category of records(group.statistics)) {
      for (const row of records(category.athletes)) {
        const athlete = object(row.athlete);
        if (athlete.id != null) names.set(String(athlete.id), person(athlete));
      }
    }
  }
  detail.scoringPlays = plays.map((play) => ({
    id: display(play.id),
    period:
      typeof object(play.period).number === 'number'
        ? (object(play.period).number as number)
        : null,
    clock: display(object(play.clock).displayValue),
    teamId: object(play.team).id != null ? `espn:${object(play.team).id}` : null,
    text: String(play.text ?? play.shortText ?? ''),
    homeScore: score(play.homeScore),
    awayScore: score(play.awayScore),
    participants: records(play.participants)
      .map((entry) => object(entry.athlete))
      .filter((athlete) => athlete.id != null)
      .map((athlete) => names.get(String(athlete.id)) ?? person(athlete)),
  }));
  return detail;
}
