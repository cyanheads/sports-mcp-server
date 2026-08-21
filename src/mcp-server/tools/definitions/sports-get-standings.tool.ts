/**
 * @fileoverview sports_get_standings tool — current or historical league standings.
 * @module mcp-server/tools/definitions/sports-get-standings.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getEspnService } from '@/services/espn/espn-service.js';
import { getMlbService } from '@/services/mlb/mlb-service.js';
import { LEAGUE_ROUTES, type NormalizedStanding } from '@/services/types.js';

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

export const sportsGetStandings = tool('sports_get_standings', {
  description:
    'Current standings or league table for a league. Returns team rank, W/L record (or points for ' +
    'soccer/NHL), division or conference, streak, and games behind. Omit season for the current year. ' +
    'NHL standings use points; soccer uses points-based league tables.',

  annotations: { readOnlyHint: true, openWorldHint: true },

  input: z.object({
    league: LEAGUE_ENUM.describe(
      'League identifier. Supported: nfl, nba, mlb, nhl, epl, mls, laliga, bundesliga, seriea, ligue1, ucl, ncaaf, ncaab.',
    ),
    season: z
      .string()
      .regex(/^\d{4}$/, 'Season must be a 4-digit year, e.g. "2025".')
      .optional()
      .describe('Season year, e.g. "2025". Omit for the current season.'),
  }),

  output: z.object({
    standings: z
      .array(
        z
          .object({
            rank: z.number().describe('Team rank within their group (1-based).'),
            team: z
              .object({
                id: z.string().describe('Source-prefixed team ID.'),
                name: z.string().describe('Full team name.'),
                abbreviation: z.string().describe('Team abbreviation, e.g. "SEA" or "NYY".'),
              })
              .describe('Team identification.'),
            wins: z.number().describe('Number of wins.'),
            losses: z.number().describe('Number of losses.'),
            ties: z.number().nullable().describe('Number of ties (null if not applicable).'),
            points: z.number().nullable().describe('Points total (used in NHL and soccer).'),
            winningPercentage: z
              .string()
              .nullable()
              .describe('Win percentage as a decimal string (NFL/NBA/MLB). Null for NHL.'),
            divisionRank: z.string().nullable().describe('Division rank string, if available.'),
            streak: z.string().nullable().describe('Current streak code, e.g. W3 or L2.'),
            gamesBehind: z.string().nullable().describe('Games behind division leader.'),
            source: z
              .enum(['espn', 'mlbstats'])
              .describe('Data source that provided this standings entry.'),
          })
          .describe('A single team standing entry.'),
      )
      .describe('Standings entries, ordered as returned by the source.'),
    league: z.string().describe('The league queried.'),
    season: z.string().nullable().describe('The season queried, or null if current.'),
    source: z.enum(['espn', 'mlbstats']).describe('Primary data source used.'),
  }),

  enrichment: {
    notice: z
      .string()
      .optional()
      .describe(
        'Informational note, e.g. "Season not currently active" when standings are unavailable during the off-season.',
      ),
  },

  errors: [
    {
      reason: 'season_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'An explicit season year was requested but returned no standings data.',
      recovery: 'Try a recent year or omit the season parameter to get current standings.',
    },
  ],

  async handler(input, ctx) {
    // biome-ignore lint/style/noNonNullAssertion: Zod enum guarantees input.league is always a key in LEAGUE_ROUTES
    const route = LEAGUE_ROUTES[input.league]!;
    ctx.log.info('Fetching standings', { league: input.league, season: input.season });

    let standings: NormalizedStanding[];
    let source: 'espn' | 'mlbstats';

    if (route.mlbLeagueId) {
      standings = await getMlbService().getStandings(input.season ?? null, ctx);
      source = 'mlbstats';
    } else {
      standings = await getEspnService().getStandings(
        route.espnSport,
        route.espnLeague,
        input.season ?? null,
        ctx,
      );
      source = 'espn';
    }

    if (standings.length === 0) {
      // When a season was explicitly requested and not found, that is a hard error.
      // When no season was provided, the league is likely in its off-season — return
      // empty standings with a notice rather than throwing.
      if (input.season) {
        throw ctx.fail(
          'season_not_found',
          `No standings data found for ${input.league} season ${input.season}.`,
          { ...ctx.recoveryFor('season_not_found') },
        );
      }
      ctx.enrich.notice(
        'Season not currently active — standings are unavailable during the off-season.',
      );
      return {
        standings: [],
        league: input.league,
        season: null,
        source,
      };
    }

    return {
      standings,
      league: input.league,
      season: input.season ?? null,
      source,
    };
  },

  format: (result) => {
    const seasonLabel = result.season ? ` ${result.season}` : '';
    const lines: string[] = [
      `**${result.league.toUpperCase()}${seasonLabel} Standings** (league: ${result.league}, source: ${result.source})\n`,
    ];

    for (const s of result.standings) {
      const tiesStr = s.ties != null ? ` ${s.ties}T` : '';
      const ptsStr = s.points != null ? ` ${s.points}pts` : '';
      const record = `${s.wins}W ${s.losses}L${tiesStr}${ptsStr}`;
      const pct = s.winningPercentage ? ` pct:${s.winningPercentage}` : '';
      const streak = s.streak ? ` | streak:${s.streak}` : '';
      const gb = s.gamesBehind ? ` | GB:${s.gamesBehind}` : '';
      const divRank = s.divisionRank ? ` | divRank:${s.divisionRank}` : '';

      lines.push(
        `${s.rank}. **${s.team.abbreviation}** (${s.team.name}) [${s.team.id}] — ${record}${pct}${streak}${gb}${divRank}`,
      );
    }

    return [{ type: 'text' as const, text: lines.join('\n') }];
  },
});
