/**
 * @fileoverview sports_find_team tool — resolve a team name to canonical record and source IDs.
 * @module mcp-server/tools/definitions/sports-find-team.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { markdownImage } from '@cyanheads/mcp-ts-core/utils';
import { getServerConfig, THE_SPORTS_DB_PUBLIC_KEY } from '@/config/server-config.js';
import { getEspnService } from '@/services/espn/espn-service.js';
import { getMlbService } from '@/services/mlb/mlb-service.js';
import {
  rethrowTerminalProviderError,
  UnavailableSources,
  unavailableSource,
} from '@/services/provider-errors.js';
import { getTheSportsDbService } from '@/services/thesportsdb/thesportsdb-service.js';
import { LEAGUE_ROUTES, type NormalizedTeam } from '@/services/types.js';
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

export const sportsFindTeam = tool('sports_find_team', {
  description:
    'Resolve a team name or partial name to canonical records and source IDs across providers, optionally scoped to a league. Returns full name, league, logo URL, venue, and ESPN, MLB, and TheSportsDB IDs.',

  annotations: { readOnlyHint: true, openWorldHint: true },

  input: z.object({
    query: z
      .string()
      .regex(/\S/, 'Team name must contain at least one non-whitespace character.')
      .max(200, 'Team name must be 200 characters or fewer.')
      .describe(
        'Team name or partial name to search for, e.g. "Mariners", "Manchester United", "Seattle Seahawks".',
      ),
    league: LEAGUE_ENUM.optional().describe(
      'Narrow search to a specific league. Optional but recommended for faster results.',
    ),
  }),

  output: z.object({
    teams: z
      .array(
        z
          .object({
            id: z.string().describe('Primary source-prefixed ID for this record.'),
            espnId: z
              .string()
              .nullable()
              .describe('ESPN numeric team ID, or null if not found in ESPN.'),
            mlbId: z
              .number()
              .nullable()
              .describe('MLB StatsAPI team ID, or null if not an MLB team.'),
            tsdbId: z.string().nullable().describe('TheSportsDB team ID, or null if not found.'),
            name: z.string().describe('Team name (e.g. "Seahawks").'),
            abbreviation: z.string().describe('Team abbreviation.'),
            location: z.string().describe('Team city or location.'),
            displayName: z.string().describe('Full display name (e.g. "Seattle Seahawks").'),
            league: z.string().describe('League this team plays in.'),
            logoUrl: z
              .string()
              .nullable()
              .describe('Team logo or badge URL, or null if unavailable.'),
            venueName: z.string().nullable().describe('Home venue name, or null if unavailable.'),
            source: z
              .enum(['espn', 'mlbstats', 'thesportsdb'])
              .describe('Data source that provided this team record.'),
          })
          .describe('A matched team record.'),
      )
      .describe('Matching teams found across sources.'),
    query: z.string().describe('The search query used.'),
    totalFound: z
      .number()
      .describe(
        'Number of matching records returned after deduplication, not a total of all available matches.',
      ),
  }),

  enrichment: {
    unavailableSources: UnavailableSources,
    notice: z
      .string()
      .optional()
      .describe(
        'Completeness guidance for TheSportsDB search contributions; ESPN and MLB contributions are unaffected.',
      ),
  },

  enrichmentTrailer: {
    unavailableSources: {
      render: (sources) =>
        sources
          ?.map((s) => `${s.source} / ${s.operation}: ${s.reason}. ${s.recovery}`)
          .join('\n') ?? '',
    },
  },

  errors: [
    {
      reason: 'sources_unavailable',
      code: JsonRpcErrorCode.ServiceUnavailable,
      when: 'No matches were returned and an optional provider lookup failed, so absence cannot be established.',
      recovery: 'Retry the same search later when the unavailable provider can contribute.',
    },
    {
      reason: 'no_match',
      code: JsonRpcErrorCode.NotFound,
      when: 'No team matched the query across any source.',
      recovery: 'Try a shorter or different name, or omit the league filter to broaden the search.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Finding team', { query: input.query, league: input.league });
    const q = input.query.trim().toLowerCase();

    const results: NormalizedTeam[] = [];
    const unavailableSources: Array<ReturnType<typeof unavailableSource>> = [];

    // 1. TheSportsDB search (multi-sport, fuzzy)
    const tsdbTeams = await getTheSportsDbService().searchTeams(input.query, ctx);
    for (const t of tsdbTeams) {
      if (input.league) {
        // Filter by league if specified — TSDB league name may not match our enum exactly
        // biome-ignore lint/style/noNonNullAssertion: Zod enum guarantees input.league is always a key in LEAGUE_ROUTES
        const route = LEAGUE_ROUTES[input.league]!;
        const providerLeague = t.league.toLowerCase();
        const aliases = [
          input.league,
          route.espnLeague.replace('.', ' '),
          ...(route.theSportsDbLeagueAliases ?? []),
        ];
        const leagueMatch = aliases.some((alias) => providerLeague.includes(alias.toLowerCase()));
        if (!leagueMatch) continue;
      }
      results.push(t);
    }
    const tsdbContributed = results.length > 0;

    // 2. ESPN and/or MLB team list search for the given league
    if (input.league) {
      const route = LEAGUE_ROUTES[input.league];
      if (route) {
        try {
          const espnTeams = await getEspnService().getTeams(route.espnSport, route.espnLeague, ctx);
          for (const t of espnTeams) {
            if (
              t.name.toLowerCase().includes(q) ||
              t.displayName.toLowerCase().includes(q) ||
              t.abbreviation.toLowerCase() === q ||
              t.location.toLowerCase().includes(q)
            ) {
              results.push(t);
            }
          }
        } catch (error: unknown) {
          rethrowTerminalProviderError(error, ctx);
          unavailableSources.push(unavailableSource('espn', 'team_list'));
          ctx.log.warning('ESPN team list fetch failed during find_team', { league: input.league });
        }

        // For MLB league, also fetch from MLB StatsAPI to obtain mlbId (ESPN teams carry espnId only)
        if (route.mlbLeagueId) {
          try {
            const mlbTeams = await getMlbService().getTeams(null, ctx);
            for (const t of mlbTeams) {
              if (
                t.name.toLowerCase().includes(q) ||
                t.displayName.toLowerCase().includes(q) ||
                t.abbreviation.toLowerCase() === q
              ) {
                results.push(t);
              }
            }
          } catch (error: unknown) {
            rethrowTerminalProviderError(error, ctx);
            unavailableSources.push(unavailableSource('mlbstats', 'team_list'));
            ctx.log.warning('MLB teams fetch failed during find_team');
          }
        }
      }
    } else {
      // No league filter — try MLB teams
      try {
        const mlbTeams = await getMlbService().getTeams(null, ctx);
        for (const t of mlbTeams) {
          if (
            t.name.toLowerCase().includes(q) ||
            t.displayName.toLowerCase().includes(q) ||
            t.abbreviation.toLowerCase() === q
          ) {
            results.push(t);
          }
        }
      } catch (error: unknown) {
        rethrowTerminalProviderError(error, ctx);
        unavailableSources.push(unavailableSource('mlbstats', 'team_list'));
        ctx.log.warning('MLB teams fetch failed during find_team');
      }
    }

    // Deduplicate by displayName (case-insensitive), merging cross-reference IDs so that
    // espnId/mlbId/tsdbId from any matching record survive in the canonical output entry.
    const deduped: NormalizedTeam[] = [];
    for (const t of results) {
      const key = t.displayName.toLowerCase();
      const existing = deduped.find(
        (r) =>
          (t.espnId !== null && r.espnId === t.espnId) ||
          (t.mlbId !== null && r.mlbId === t.mlbId) ||
          (t.tsdbId !== null && r.tsdbId === t.tsdbId) ||
          r.displayName.toLowerCase() === key,
      );
      if (!existing) {
        deduped.push({ ...t });
      } else {
        // Merge IDs — preserve whichever record has a non-null value for each field
        existing.espnId ??= t.espnId;
        existing.mlbId ??= t.mlbId;
        existing.tsdbId ??= t.tsdbId;
        // Keep the more informative record (ESPN/MLB has venueName; TSDB often has logoUrl)
        existing.venueName ??= t.venueName;
        existing.venueId ??= t.venueId;
        existing.logoUrl ??= t.logoUrl;
      }
    }

    if (deduped.length === 0) {
      if (unavailableSources.length)
        throw ctx.fail(
          'sources_unavailable',
          'No matches returned while optional sources were unavailable.',
          { unavailableSources, ...ctx.recoveryFor('sources_unavailable') },
        );
      throw ctx.fail('no_match', `No team found matching "${input.query}".`, {
        ...ctx.recoveryFor('no_match'),
      });
    }

    if (unavailableSources.length) ctx.enrich({ unavailableSources });
    if (tsdbContributed && getServerConfig().theSportsDbApiKey === THE_SPORTS_DB_PUBLIC_KEY) {
      ctx.enrich.notice(
        'TheSportsDB free-key search contributions may be incomplete (one-record limit). Try a fuller name or a premium key. ESPN and MLB results are unaffected by this limit.',
      );
    }

    return {
      teams: deduped.map((t) => ({
        id: t.id,
        espnId: t.espnId,
        mlbId: t.mlbId,
        tsdbId: t.tsdbId,
        name: t.name,
        abbreviation: t.abbreviation,
        location: t.location,
        displayName: t.displayName,
        league: t.league,
        logoUrl: t.logoUrl,
        venueName: t.venueName,
        source: t.source,
      })),
      query: input.query,
      totalFound: deduped.length,
    };
  },

  format: (result) => {
    const lines: string[] = [
      inline`**Team Search: "${result.query}"** — ${result.totalFound} result(s)\n`,
    ];

    for (const t of result.teams) {
      lines.push(inline`### ${t.displayName} (${t.name})`);
      lines.push(inline`League: ${t.league} | Abbreviation: ${t.abbreviation}`);
      lines.push(inline`Location: ${t.location} | Venue: ${t.venueName ?? 'N/A'}`);
      lines.push(
        inline`IDs — Primary: ${t.id} | ESPN: ${t.espnId ?? 'N/A'} | MLB: ${t.mlbId ?? 'N/A'} | TSDB: ${t.tsdbId ?? 'N/A'}`,
      );
      if (t.logoUrl) lines.push(`Logo: ${markdownImage(t.displayName, t.logoUrl)}`);
      lines.push(inline`Source: ${t.source}`);
    }

    return [{ type: 'text' as const, text: lines.join('\n') }];
  },
});
