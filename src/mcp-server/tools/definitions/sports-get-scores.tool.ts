/**
 * @fileoverview sports_get_scores tool — live and final scores for a league on a given date.
 * @module mcp-server/tools/definitions/sports-get-scores.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { easternToday } from '@/services/date-window.js';
import { getEspnService } from '@/services/espn/espn-service.js';
import { getMlbService } from '@/services/mlb/mlb-service.js';
import { LEAGUE_ROUTES } from '@/services/types.js';
import { inline } from '../formatting.js';

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
    "Live and final scores for a league on a given provider-calendar date, optionally filtered by team name. Returns teams, scores, status, period or clock, and UTC start. Omitted dates use today's US Eastern calendar day, including daylight saving time. NCAAB covers men's Division I; NCAAF covers FBS.",

  annotations: { readOnlyHint: true, openWorldHint: true },

  input: z.object({
    league: LEAGUE_ENUM.describe(
      'League identifier. Supported: nfl, nba, mlb, nhl, epl, mls, laliga, bundesliga, seriea, ligue1, ucl, ncaaf, ncaab.',
    ),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format.')
      .optional()
      .describe("Provider-calendar date in YYYY-MM-DD format. Omit for today's US Eastern day."),
    team_name: z
      .string()
      .max(200, 'Team name must be 200 characters or fewer.')
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
            id: z
              .string()
              .describe(
                'Source-prefixed game ID, e.g. espn:401872656 or mlb:823457. Pass with this league to sports_get_game.',
              ),
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
              .describe('Source provenance for this game record.'),
          })
          .describe('A single game record.'),
      )
      .describe('List of games for the requested date and league.'),
    date: z.string().describe('The effective date queried (YYYY-MM-DD).'),
    league: z.string().describe('The league queried.'),
    reason: z.string().optional().describe('Human-readable note when no games are found.'),
  }),

  enrichment: {
    emptyReason: z
      .enum(['no_games', 'no_team_matches'])
      .optional()
      .describe('Whether the provider slate was empty or the team filter removed all games.'),
    notice: z
      .string()
      .optional()
      .describe('Explanation of an empty result and the applied filter.'),
    coverage: z.string().optional().describe('College scoreboard coverage when applicable.'),
  },

  async handler(input, ctx) {
    // biome-ignore lint/style/noNonNullAssertion: Zod enum guarantees input.league is always a key in LEAGUE_ROUTES
    const route = LEAGUE_ROUTES[input.league]!;
    const effectiveDate = input.date ?? easternToday();
    ctx.log.info('Fetching scores', { league: input.league, date: effectiveDate });

    let games = route.mlbLeagueId
      ? await getMlbService().getSchedule(effectiveDate, ctx)
      : await getEspnService().getScoreboard(route.espnSport, route.espnLeague, effectiveDate, ctx);

    const providerGames = games.length;
    const teamFilter = input.team_name?.trim();
    if (teamFilter) {
      const q = teamFilter.toLowerCase();
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
        ? providerGames && teamFilter
          ? `No games matched team filter "${teamFilter}" for ${input.league.toUpperCase()} on ${effectiveDate}.`
          : `No games found for ${input.league.toUpperCase()} on ${effectiveDate}.`
        : undefined;

    ctx.enrich({
      ...(reason
        ? { emptyReason: providerGames ? 'no_team_matches' : 'no_games', notice: reason }
        : {}),
      ...(input.league === 'ncaaf' ? { coverage: 'FBS football.' } : {}),
      ...(input.league === 'ncaab' ? { coverage: "Men's Division I basketball." } : {}),
    });

    return {
      games,
      date: effectiveDate,
      league: input.league,
      ...(reason ? { reason } : {}),
    };
  },

  format: (result) => {
    const lines: string[] = [
      inline`**${result.league.toUpperCase()} Scores — ${result.date}** (league: ${result.league})\n`,
    ];

    if (result.reason) lines.push(inline`_${result.reason}_`);

    for (const g of result.games) {
      const periodStr = g.period != null ? ` | Period/Inning: ${g.period}` : '';
      const clockStr = g.clock ? ` | Clock: ${g.clock}` : '';
      lines.push(inline`**${g.shortName}** [${g.id}] — ${g.status}${periodStr}${clockStr}`);
      lines.push(
        inline`  Away: ${g.awayTeam.name} (${g.awayTeam.abbreviation}) [${g.awayTeam.id}] — ${g.awayTeam.score ?? '—'}`,
      );
      lines.push(
        inline`  Home: ${g.homeTeam.name} (${g.homeTeam.abbreviation}) [${g.homeTeam.id}] — ${g.homeTeam.score ?? '—'}`,
      );
      lines.push(
        inline`  Start: ${g.startTimeUtc} | Venue: ${g.venue ?? 'N/A'} | Source: ${g.source}`,
      );
    }

    return [{ type: 'text' as const, text: lines.join('\n') }];
  },
});
