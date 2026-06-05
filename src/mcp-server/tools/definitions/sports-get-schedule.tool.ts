/**
 * @fileoverview sports_get_schedule tool — upcoming and past fixtures for a team or league.
 * @module mcp-server/tools/definitions/sports-get-schedule.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getEspnService } from '@/services/espn/espn-service.js';
import { getMlbService } from '@/services/mlb/mlb-service.js';
import { LEAGUE_ROUTES, type NormalizedGame } from '@/services/types.js';

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

export const sportsGetSchedule = tool('sports_get_schedule', {
  description:
    'Upcoming and past fixtures for a team or full league over a date range. Returns opponent, ' +
    'home/away flag, UTC date/time, venue, and result if final. Use sports_find_team first to ' +
    'resolve an ambiguous team name to the canonical form before passing it as team_name.',

  annotations: { readOnlyHint: true, openWorldHint: true },

  input: z.object({
    league: LEAGUE_ENUM.describe(
      'League identifier. Supported: nfl, nba, mlb, nhl, epl, mls, laliga, bundesliga, seriea, ligue1, ucl, ncaaf, ncaab.',
    ),
    team_name: z
      .string()
      .optional()
      .describe(
        'Team name or partial name to filter schedule. Fuzzy match. Omit for league-wide schedule.',
      ),
    date_from: z
      .string()
      .optional()
      .describe('Start of date range in YYYY-MM-DD format. Inclusive.'),
    date_to: z.string().optional().describe('End of date range in YYYY-MM-DD format. Inclusive.'),
  }),

  output: z.object({
    games: z
      .array(
        z
          .object({
            id: z.string().describe('Source-prefixed game ID.'),
            shortName: z.string().describe('Short matchup string.'),
            homeTeam: z
              .object({
                id: z.string().describe('Source-prefixed team ID.'),
                name: z.string().describe('Full team name.'),
                abbreviation: z.string().describe('Team abbreviation, e.g. "SEA" or "DAL".'),
                score: z.string().nullable().describe('Final score, null if game not played yet.'),
              })
              .describe('Home team.'),
            awayTeam: z
              .object({
                id: z.string().describe('Source-prefixed team ID.'),
                name: z.string().describe('Full team name.'),
                abbreviation: z.string().describe('Team abbreviation, e.g. "SEA" or "DAL".'),
                score: z.string().nullable().describe('Final score, null if game not played yet.'),
              })
              .describe('Away team.'),
            status: z
              .enum(['scheduled', 'in-progress', 'final', 'postponed', 'cancelled'])
              .describe('Game status.'),
            period: z
              .number()
              .nullable()
              .describe('Current period or inning, null if not started.'),
            clock: z.string().nullable().describe('Game clock display, null if not applicable.'),
            startTimeUtc: z.string().describe('Game start time in UTC ISO 8601.'),
            venue: z.string().nullable().describe('Venue name, or null if unavailable.'),
            source: z
              .enum(['espn', 'mlbstats'])
              .describe('Data source that provided this game record.'),
          })
          .describe('A single scheduled or completed game.'),
      )
      .describe('Games in the requested date range.'),
    league: z.string().describe('The league queried.'),
    teamFilter: z.string().optional().describe('Team name filter applied, if any.'),
    dateFrom: z.string().optional().describe('Start date filter applied, if any.'),
    dateTo: z.string().optional().describe('End date filter applied, if any.'),
    totalReturned: z.number().describe('Total number of games returned.'),
  }),

  errors: [
    {
      reason: 'invalid_league',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'The league parameter is not in the supported set.',
      recovery:
        'Use one of: nfl, nba, mlb, nhl, epl, mls, laliga, bundesliga, seriea, ligue1, ucl, ncaaf, ncaab.',
    },
    {
      reason: 'team_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The team_name resolves to no matching team in the league.',
      recovery: 'Use sports_find_team to resolve a fuzzy team name to a canonical record first.',
    },
  ],

  async handler(input, ctx) {
    const route = LEAGUE_ROUTES[input.league];
    if (!route) {
      throw ctx.fail('invalid_league', `League "${input.league}" is not supported.`);
    }

    ctx.log.info('Fetching schedule', { league: input.league, team: input.team_name });

    let games: NormalizedGame[] = [];

    if (route.mlbLeagueId) {
      // MLB: fetch schedule (no date = today's, we fetch a wider range below)
      // For schedule we want multiple dates — use a wide window
      const from =
        input.date_from ?? new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
      const to = input.date_to ?? new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);

      if (input.team_name) {
        // Get teams to find team ID
        const teams = await getMlbService().getTeams(null, ctx);
        const q = input.team_name.toLowerCase();
        const team = teams.find(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.displayName.toLowerCase().includes(q) ||
            t.abbreviation.toLowerCase() === q,
        );
        if (!team)
          throw ctx.fail('team_not_found', `No MLB team found matching "${input.team_name}".`);

        // Fetch schedule for multiple individual dates would be expensive; use date range via MLB API
        const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&hydrate=team,linescore&teamId=${team.mlbId}&startDate=${from}&endDate=${to}`;
        const { withRetry, fetchWithTimeout } = await import('@cyanheads/mcp-ts-core/utils');
        const data = await withRetry(
          async () => {
            const res = await fetchWithTimeout(url, 10_000, ctx, { signal: ctx.signal });
            return res.json() as Promise<{ dates?: unknown[] }>;
          },
          { operation: 'mlb-team-schedule', context: ctx, baseDelayMs: 1000 },
        );
        const allGames: NormalizedGame[] = [];
        for (const d of data?.dates ?? []) {
          const dateObj = d as Record<string, unknown>;
          for (const g of (dateObj.games as unknown[]) ?? []) {
            const game = g as Record<string, unknown>;
            const teams2 = game.teams as Record<string, unknown> | undefined;
            const homeRaw = teams2?.home as Record<string, unknown> | undefined;
            const awayRaw = teams2?.away as Record<string, unknown> | undefined;
            const homeTeam = homeRaw?.team as Record<string, unknown> | undefined;
            const awayTeam = awayRaw?.team as Record<string, unknown> | undefined;
            const status2 = game.status as Record<string, unknown> | undefined;
            const abstractState = String(status2?.abstractGameState ?? 'Preview');
            const detailedState = String(status2?.detailedState ?? 'Scheduled');
            const homeAbbr = String(homeTeam?.abbreviation ?? '');
            const awayAbbr = String(awayTeam?.abbreviation ?? '');
            allGames.push({
              id: `mlb:${String(game.gamePk ?? '')}`,
              shortName: `${awayAbbr} @ ${homeAbbr}`,
              homeTeam: {
                id: `mlb:${String(homeTeam?.id ?? '')}`,
                name: String(homeTeam?.name ?? ''),
                abbreviation: homeAbbr,
                score: homeRaw?.score != null ? String(homeRaw.score) : null,
              },
              awayTeam: {
                id: `mlb:${String(awayTeam?.id ?? '')}`,
                name: String(awayTeam?.name ?? ''),
                abbreviation: awayAbbr,
                score: awayRaw?.score != null ? String(awayRaw.score) : null,
              },
              status: (abstractState === 'Live'
                ? 'in-progress'
                : abstractState === 'Final'
                  ? detailedState.includes('Postponed')
                    ? 'postponed'
                    : 'final'
                  : 'scheduled') as
                | 'scheduled'
                | 'in-progress'
                | 'final'
                | 'postponed'
                | 'cancelled',
              period: null,
              clock: null,
              startTimeUtc: String(game.gameDate ?? ''),
              venue:
                (game.venue as Record<string, unknown>)?.name != null
                  ? String((game.venue as Record<string, unknown>).name)
                  : null,
              source: 'mlbstats' as const,
            });
          }
        }
        games = allGames;
      } else {
        // No team filter — return today's games
        games = await getMlbService().getSchedule(null, ctx);
      }
    } else {
      // ESPN path: need team ID to fetch team schedule
      if (input.team_name) {
        const espnTeams = await getEspnService().getTeams(route.espnSport, route.espnLeague, ctx);
        const q = input.team_name.toLowerCase();
        const team = espnTeams.find(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.displayName.toLowerCase().includes(q) ||
            t.abbreviation.toLowerCase() === q ||
            t.location.toLowerCase().includes(q),
        );
        if (!team)
          throw ctx.fail(
            'team_not_found',
            `No team found matching "${input.team_name}" in ${input.league}.`,
          );
        const teamId = team.espnId ?? team.id.replace('espn:', '');
        games = await getEspnService().getTeamSchedule(
          route.espnSport,
          route.espnLeague,
          teamId,
          null,
          ctx,
        );
      } else {
        games = await getEspnService().getScoreboard(route.espnSport, route.espnLeague, null, ctx);
      }
    }

    // Apply date range filter
    if (input.date_from || input.date_to) {
      games = games.filter((g) => {
        const gameDate = g.startTimeUtc.slice(0, 10);
        if (input.date_from && gameDate < input.date_from) return false;
        if (input.date_to && gameDate > input.date_to) return false;
        return true;
      });
    }

    return {
      games,
      league: input.league,
      ...(input.team_name ? { teamFilter: input.team_name } : {}),
      ...(input.date_from ? { dateFrom: input.date_from } : {}),
      ...(input.date_to ? { dateTo: input.date_to } : {}),
      totalReturned: games.length,
    };
  },

  format: (result) => {
    const parts = [`**${result.league.toUpperCase()} Schedule** (league: ${result.league})`];
    if (result.teamFilter) parts.push(` — ${result.teamFilter}`);
    if (result.dateFrom || result.dateTo) {
      parts.push(` (${result.dateFrom ?? '...'} → ${result.dateTo ?? '...'})`);
    }
    parts.push(`\n_${result.totalReturned} games_\n`);
    const lines: string[] = [parts.join('')];

    for (const g of result.games) {
      const periodStr = g.period != null ? ` | Period: ${g.period}` : '';
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
