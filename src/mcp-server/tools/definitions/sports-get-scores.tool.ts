/**
 * @fileoverview sports_get_scores tool — live and final scores for a league on a given date.
 * @module mcp-server/tools/definitions/sports-get-scores.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getEspnService } from '@/services/espn/espn-service.js';
import { getMlbService } from '@/services/mlb/mlb-service.js';
import { LEAGUE_ROUTES } from '@/services/types.js';

const LEAGUE_ENUM = z.enum([
  'nfl',
  'nba',
  'mlb',
  'nhl',
  'epl',
  'mls',
  'laliga',
  'bundesliga',
  'seriea',
  'ligue1',
  'ucl',
  'ncaaf',
  'ncaab',
]);

export const sportsGetScores = tool('sports_get_scores', {
  description:
    'Live and final scores for a league on a given date, optionally scoped to a specific team. ' +
    'Returns each game with home/away teams, current score, status (scheduled/in-progress/final), ' +
    "period/clock, and UTC start time. Omit date for today's games. " +
    'Use sports_find_team first to resolve a fuzzy team name before filtering by team_name.',

  annotations: { readOnlyHint: true, openWorldHint: true },

  input: z.object({
    league: LEAGUE_ENUM.describe(
      'League identifier. Supported: nfl, nba, mlb, nhl, epl, mls, laliga, bundesliga, seriea, ligue1, ucl, ncaaf, ncaab.',
    ),
    date: z.string().optional().describe("Date in YYYY-MM-DD format. Omit for today's games."),
    team_name: z
      .string()
      .optional()
      .describe(
        'Filter results to games involving this team. Fuzzy match on team name or abbreviation.',
      ),
  }),

  output: z.object({
    games: z
      .array(
        z
          .object({
            id: z.string().describe('Source-prefixed game ID, e.g. espn:401872656 or mlb:823457.'),
            shortName: z.string().describe('Short matchup string, e.g. "SEA @ NYY".'),
            homeTeam: z
              .object({
                id: z.string().describe('Source-prefixed team ID.'),
                name: z.string().describe('Full team name.'),
                abbreviation: z.string().describe('Team abbreviation, e.g. "SEA" or "NYY".'),
                score: z
                  .string()
                  .nullable()
                  .describe('Current or final score, null if not yet started.'),
              })
              .describe('Home team details and score.'),
            awayTeam: z
              .object({
                id: z.string().describe('Source-prefixed team ID.'),
                name: z.string().describe('Full team name.'),
                abbreviation: z.string().describe('Team abbreviation, e.g. "SEA" or "NYY".'),
                score: z
                  .string()
                  .nullable()
                  .describe('Current or final score, null if not yet started.'),
              })
              .describe('Away team details and score.'),
            status: z
              .enum(['scheduled', 'in-progress', 'final', 'postponed', 'cancelled'])
              .describe('Game status.'),
            period: z
              .number()
              .nullable()
              .describe('Current period, quarter, or inning. Null if not started.'),
            clock: z
              .string()
              .nullable()
              .describe(
                'Game clock or inning half display (e.g. "2:34", "Top"). Null if not applicable.',
              ),
            startTimeUtc: z.string().describe('Game start time in UTC ISO 8601 format.'),
            venue: z.string().nullable().describe('Venue name, if available.'),
            source: z
              .enum(['espn', 'mlbstats'])
              .describe('Data source: espn for all leagues except MLB; mlbstats for MLB.'),
          })
          .describe('A single game record.'),
      )
      .describe('List of games for the requested date and league.'),
    date: z.string().describe('The effective date queried (YYYY-MM-DD).'),
    league: z.string().describe('The league queried.'),
    reason: z.string().optional().describe('Human-readable note when no games are found.'),
  }),

  errors: [
    {
      reason: 'invalid_league',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'The league parameter is not in the supported set.',
      recovery:
        'Use one of: nfl, nba, mlb, nhl, epl, mls, laliga, bundesliga, seriea, ligue1, ucl, ncaaf, ncaab.',
    },
  ],

  async handler(input, ctx) {
    const route = LEAGUE_ROUTES[input.league];
    if (!route) {
      throw ctx.fail('invalid_league', `League "${input.league}" is not supported.`);
    }

    const effectiveDate = input.date ?? new Date().toISOString().slice(0, 10);
    ctx.log.info('Fetching scores', { league: input.league, date: effectiveDate });

    let games = route.mlbLeagueId
      ? await getMlbService().getSchedule(effectiveDate, ctx)
      : await getEspnService().getScoreboard(route.espnSport, route.espnLeague, effectiveDate, ctx);

    if (input.team_name) {
      const q = input.team_name.toLowerCase();
      games = games.filter(
        (g) =>
          g.homeTeam.name.toLowerCase().includes(q) ||
          g.awayTeam.name.toLowerCase().includes(q) ||
          g.homeTeam.abbreviation.toLowerCase() === q ||
          g.awayTeam.abbreviation.toLowerCase() === q,
      );
    }

    const reason =
      games.length === 0
        ? `No games found for ${input.league.toUpperCase()} on ${effectiveDate}.`
        : undefined;

    return {
      games,
      date: effectiveDate,
      league: input.league,
      ...(reason ? { reason } : {}),
    };
  },

  format: (result) => {
    const lines: string[] = [
      `**${result.league.toUpperCase()} Scores — ${result.date}** (league: ${result.league})\n`,
    ];

    if (result.reason) lines.push(`_${result.reason}_`);

    for (const g of result.games) {
      const periodStr = g.period != null ? ` | Period/Inning: ${g.period}` : '';
      const clockStr = g.clock ? ` | Clock: ${g.clock}` : '';
      lines.push(`**${g.shortName}** [${g.id}] — ${g.status}${periodStr}${clockStr}`);
      lines.push(
        `  Away: ${g.awayTeam.name} (${g.awayTeam.abbreviation}) [${g.awayTeam.id}] — ${g.awayTeam.score ?? '—'}`,
      );
      lines.push(
        `  Home: ${g.homeTeam.name} (${g.homeTeam.abbreviation}) [${g.homeTeam.id}] — ${g.homeTeam.score ?? '—'}`,
      );
      lines.push(`  Start: ${g.startTimeUtc} | Venue: ${g.venue ?? 'N/A'} | Source: ${g.source}`);
    }

    return [{ type: 'text' as const, text: lines.join('\n') }];
  },
});
