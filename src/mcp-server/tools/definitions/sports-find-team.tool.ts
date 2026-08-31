/**
 * @fileoverview sports_find_team tool — resolve a team name to canonical record and source IDs.
 * @module mcp-server/tools/definitions/sports-find-team.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getEspnService } from '@/services/espn/espn-service.js';
import { getMlbService } from '@/services/mlb/mlb-service.js';
import { getTheSportsDbService } from '@/services/thesportsdb/thesportsdb-service.js';
import { LEAGUE_ROUTES, type NormalizedTeam } from '@/services/types.js';

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
        'Team name or partial name to search for, e.g. "Mariners", "Man United", "Seattle Seahawks".',
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
    totalFound: z.number().describe('Total number of matching records.'),
  }),

  errors: [
    {
      reason: 'no_match',
      code: JsonRpcErrorCode.NotFound,
      when: 'No team matched the query across any source.',
      recovery: 'Try a shorter or different name, or omit the league filter to broaden the search.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Finding team', { query: input.query, league: input.league });
    const q = input.query.toLowerCase();

    const results: NormalizedTeam[] = [];

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
              // Check if not already present (by espnId)
              const alreadyInResults = results.some((r) => r.espnId === t.espnId && t.espnId);
              if (!alreadyInResults) results.push(t);
            }
          }
        } catch {
          // ESPN fetch failure is non-fatal for find_team
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
                const alreadyInResults = results.some((r) => r.mlbId === t.mlbId && t.mlbId);
                if (!alreadyInResults) results.push(t);
              }
            }
          } catch {
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
            const alreadyInResults = results.some((r) => r.mlbId === t.mlbId && t.mlbId);
            if (!alreadyInResults) results.push(t);
          }
        }
      } catch {
        ctx.log.warning('MLB teams fetch failed during find_team');
      }
    }

    // Deduplicate by displayName (case-insensitive), merging cross-reference IDs so that
    // espnId/mlbId/tsdbId from any matching record survive in the canonical output entry.
    const byName = new Map<string, NormalizedTeam>();
    for (const t of results) {
      const key = t.displayName.toLowerCase();
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, { ...t });
      } else {
        // Merge IDs — preserve whichever record has a non-null value for each field
        existing.espnId ??= t.espnId;
        existing.mlbId ??= t.mlbId;
        existing.tsdbId ??= t.tsdbId;
        // Keep the more informative record (ESPN/MLB has venueName; TSDB often has logoUrl)
        existing.venueName ??= t.venueName;
        existing.logoUrl ??= t.logoUrl;
      }
    }
    const deduped = [...byName.values()];

    if (deduped.length === 0) {
      throw ctx.fail('no_match', `No team found matching "${input.query}".`, {
        ...ctx.recoveryFor('no_match'),
      });
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
      `**Team Search: "${result.query}"** — ${result.totalFound} result(s)\n`,
    ];

    for (const t of result.teams) {
      lines.push(`### ${t.displayName} (${t.name})`);
      lines.push(`League: ${t.league} | Abbreviation: ${t.abbreviation}`);
      lines.push(`Location: ${t.location} | Venue: ${t.venueName ?? 'N/A'}`);
      lines.push(
        `IDs — Primary: ${t.id} | ESPN: ${t.espnId ?? 'N/A'} | MLB: ${t.mlbId ?? 'N/A'} | TSDB: ${t.tsdbId ?? 'N/A'}`,
      );
      if (t.logoUrl) lines.push(`Logo: ${t.logoUrl}`);
      lines.push(`Source: ${t.source}`);
    }

    return [{ type: 'text' as const, text: lines.join('\n') }];
  },
});
