/**
 * @fileoverview sports_get_schedule tool — upcoming and past fixtures for a team or league.
 * @module mcp-server/tools/definitions/sports-get-schedule.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { addCalendarDays, dateWindow } from '@/services/date-window.js';
import { getEspnService } from '@/services/espn/espn-service.js';
import { getMlbService } from '@/services/mlb/mlb-service.js';
import { ambiguityDetails, teamCandidates } from '@/services/team-resolver.js';
import { LEAGUE_ROUTES, type NormalizedGame, type NormalizedTeam } from '@/services/types.js';
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

export const sportsGetSchedule = tool('sports_get_schedule', {
  description:
    'Upcoming and past fixtures for a team or league, with provider-calendar date windows of up to seven days and paged games. No dates uses the provider default slate, or the current season for an ESPN team (MLB teams: 14 days back to 30 ahead). NCAAB covers men’s Division I; NCAAF scoreboards cover FBS. Returns opponents, UTC start, venue, and available results.',

  annotations: { readOnlyHint: true, openWorldHint: true },

  input: z.object({
    league: LEAGUE_ENUM.describe(
      'League identifier. Supported: nfl, nba, mlb, nhl, epl, mls, laliga, bundesliga, seriea, ligue1, ucl, ncaaf, ncaab.',
    ),
    team_name: z
      .string()
      .max(200, 'Team name must be 200 characters or fewer.')
      .optional()
      .describe(
        'Exact full name or abbreviation takes precedence; partial names or locations must identify one team. Omit for league-wide schedule.',
      ),
    date_from: z
      .preprocess(
        (value) => (typeof value === 'string' && !value.trim() ? undefined : value),
        z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format.')
          .optional(),
      )
      .describe(
        'Inclusive provider-calendar start date, YYYY-MM-DD. A single bound requests that day.',
      ),
    date_to: z
      .preprocess(
        (value) => (typeof value === 'string' && !value.trim() ? undefined : value),
        z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format.')
          .optional(),
      )
      .describe(
        'Inclusive provider-calendar end date, YYYY-MM-DD. Retain this original end when continuing.',
      ),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Games per page, default 100. Requests above 200 are clamped to 200 with disclosure.',
      ),
    offset: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        'Game offset in the served window, default 0. Use nextOffset with the original date bounds.',
      ),
  }),

  output: z.object({
    games: z
      .array(
        z
          .object({
            id: z
              .string()
              .describe('Source-prefixed game ID. Pass with this league to sports_get_game.'),
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

  enrichment: {
    requestedDateFrom: z
      .string()
      .optional()
      .describe('Original inclusive start of the dated request.'),
    requestedDateTo: z
      .string()
      .optional()
      .describe('Original inclusive end of the dated request; retain when advancing date_from.'),
    servedDateFrom: z.string().optional().describe('First provider day acquired in this call.'),
    servedDateTo: z
      .string()
      .optional()
      .describe(
        'Last provider day acquired in this call, at most seven days after the first inclusive.',
      ),
    scope: z.string().describe('Acquisition scope when dates are absent or bounded.'),
    coverage: z.string().optional().describe('College scoreboard coverage when applicable.'),
    availableGames: z
      .number()
      .describe(
        'Games available in the acquired window after filtering, never a total for unserved dates.',
      ),
    effectiveLimit: z.number().describe('Applied game page size, at most 200.'),
    offset: z.number().describe('Applied game offset in the acquired window.'),
    truncated: z.boolean().describe('Whether game rows or requested dates remain unserved.'),
    nextOffset: z
      .number()
      .optional()
      .describe('Next game offset; repeat the original bounds before advancing the date window.'),
    nextDateFrom: z
      .string()
      .optional()
      .describe(
        'Next provider-day window start, offered only after the final game page; retain requestedDateTo.',
      ),
    notice: z.string().optional().describe('Limit clamping or continuation guidance.'),
  },

  errors: [
    {
      reason: 'ambiguous_team',
      code: JsonRpcErrorCode.ValidationError,
      when: 'The team selector matches more than one canonical team.',
      recovery: 'Choose an exact full name or abbreviation from the supplied candidates.',
    },
    {
      reason: 'team_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The team_name resolves to no matching team in the league.',
      recovery: 'Use sports_find_team to resolve a fuzzy team name to a canonical record first.',
    },
  ],

  async handler(input, ctx) {
    // biome-ignore lint/style/noNonNullAssertion: Zod enum guarantees a key in LEAGUE_ROUTES
    const route = LEAGUE_ROUTES[input.league]!;
    const window = dateWindow(input.date_from, input.date_to);
    const teamFilter = input.team_name?.trim();
    const effectiveLimit = Math.min(input.limit ?? 100, 200);
    const offset = input.offset ?? 0;
    let games: NormalizedGame[];
    let scope = window ? 'provider-calendar date window' : 'provider-default league slate';
    let team: NormalizedTeam | undefined;
    if (teamFilter) {
      const teams = route.mlbLeagueId
        ? await getMlbService().getTeams(null, ctx)
        : await getEspnService().getTeams(route.espnSport, route.espnLeague, ctx);
      const candidates = teamCandidates(teams, teamFilter);
      team = candidates[0];
      if (!team)
        throw ctx.fail(
          'team_not_found',
          `No team found matching "${teamFilter}" in ${input.league}.`,
        );
      if (candidates.length > 1)
        throw ctx.fail(
          'ambiguous_team',
          `Team selector "${teamFilter}" is ambiguous.`,
          ambiguityDetails(candidates),
        );
    }

    if (route.mlbLeagueId) {
      if (team) {
        const from =
          window?.servedDateFrom ?? addCalendarDays(new Date().toISOString().slice(0, 10), -14);
        const to =
          window?.servedDateTo ?? addCalendarDays(new Date().toISOString().slice(0, 10), 30);
        if (!team.mlbId) throw ctx.fail('team_not_found', `No MLB ID for "${teamFilter}".`);
        games = await getMlbService().getTeamScheduleRange(team.mlbId, from, to, ctx);
        if (!window) scope = `MLB team window ${from} through ${to}`;
      } else {
        games = window
          ? await getMlbService().getScheduleRange(window.servedDateFrom, window.servedDateTo, ctx)
          : await getMlbService().getSchedule(null, ctx);
      }
    } else {
      if (window) {
        games = await getEspnService().getScoreboardRange(
          route.espnSport,
          route.espnLeague,
          window.servedDateFrom,
          window.servedDateTo,
          ctx,
        );
        if (team)
          games = games.filter(
            (game) => game.homeTeam.id === team.id || game.awayTeam.id === team.id,
          );
      } else if (team) {
        games = await getEspnService().getTeamSchedule(
          route.espnSport,
          route.espnLeague,
          team.espnId ?? team.id.replace('espn:', ''),
          null,
          ctx,
        );
        scope = 'ESPN team current provider season, merged phases and soccer fixtures';
      } else {
        games = await getEspnService().getScoreboard(route.espnSport, route.espnLeague, null, ctx);
      }
    }

    games = [...new Map(games.map((game) => [game.id, game])).values()];
    games.sort(
      (a, b) =>
        (a.providerDate ?? '').localeCompare(b.providerDate ?? '') ||
        a.startTimeUtc.localeCompare(b.startTimeUtc) ||
        a.id.localeCompare(b.id),
    );
    const availableGames = games.length;
    const page = games
      .slice(offset, offset + effectiveLimit)
      .map(({ providerDate: _day, ...game }) => game);
    const rowsRemain = offset + page.length < availableGames;
    const datesRemain = !!window && window.servedDateTo < window.requestedDateTo;
    const nextOffset = rowsRemain ? offset + page.length : undefined;
    const nextDateFrom =
      !rowsRemain && datesRemain && window ? addCalendarDays(window.servedDateTo, 1) : undefined;
    const clamped = (input.limit ?? 100) > effectiveLimit;
    const continuation = rowsRemain
      ? 'Continue with nextOffset and the original date_from/date_to. Finish game pages before advancing dates.'
      : datesRemain
        ? 'Continue with nextDateFrom as date_from and retain requestedDateTo as date_to.'
        : '';
    ctx.enrich({
      ...window,
      scope,
      availableGames,
      effectiveLimit,
      offset,
      truncated: rowsRemain || datesRemain,
      ...(input.league === 'ncaaf'
        ? { coverage: 'FBS scoreboards; ESPN inventory can include other football levels.' }
        : {}),
      ...(input.league === 'ncaab' ? { coverage: 'Men’s Division I basketball.' } : {}),
      ...(nextOffset != null ? { nextOffset } : {}),
      ...(nextDateFrom ? { nextDateFrom } : {}),
      ...(clamped || continuation
        ? {
            notice: `${clamped ? `Requested limit ${input.limit} clamped to 200. ` : ''}${continuation}`,
          }
        : {}),
    });
    return {
      games: page,
      league: input.league,
      ...(teamFilter ? { teamFilter } : {}),
      ...(window ? { dateFrom: window.requestedDateFrom, dateTo: window.requestedDateTo } : {}),
      totalReturned: page.length,
    };
  },

  format: (result) => {
    const parts = [inline`**${result.league.toUpperCase()} Schedule** (league: ${result.league})`];
    if (result.teamFilter) parts.push(inline` — ${result.teamFilter}`);
    if (result.dateFrom || result.dateTo) {
      parts.push(inline` (${result.dateFrom ?? '...'} → ${result.dateTo ?? '...'})`);
    }
    parts.push(`\n_${result.totalReturned} games_\n`);
    const lines: string[] = [parts.join('')];

    for (const g of result.games) {
      const periodStr = g.period != null ? ` | Period: ${g.period}` : '';
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
