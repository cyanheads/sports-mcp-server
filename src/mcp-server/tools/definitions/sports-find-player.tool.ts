/**
 * @fileoverview sports_find_player tool — resolve a player name to their canonical record via TheSportsDB.
 * @module mcp-server/tools/definitions/sports-find-player.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getTheSportsDbService } from '@/services/thesportsdb/thesportsdb-service.js';

export const sportsFindPlayer = tool('sports_find_player', {
  description:
    'Resolve a player name to their canonical record via TheSportsDB. Returns player ID, full name, ' +
    'current team, position, nationality, birth date, and thumbnail URL. ' +
    'Use this before sports_get_player to get a valid player_id.',

  annotations: { readOnlyHint: true, openWorldHint: true },

  input: z.object({
    query: z
      .string()
      .max(200, 'Player name must be 200 characters or fewer.')
      .describe('Player name or partial name to search, e.g. "Shohei Ohtani", "LeBron", "Messi".'),
    sport: z
      .string()
      .max(100, 'Sport name must be 100 characters or fewer.')
      .optional()
      .describe(
        'Advisory sport hint for disambiguation, e.g. "Baseball", "Soccer", "Basketball". ' +
          'TheSportsDB does not support server-side sport filtering, so all players matching the query are returned regardless of this value.',
      ),
  }),

  output: z.object({
    players: z
      .array(
        z
          .object({
            id: z
              .string()
              .describe(
                'TSDB-prefixed player ID, e.g. tsdb:34185573. Pass as player_id to sports_get_player.',
              ),
            tsdbId: z.string().describe('TheSportsDB numeric player ID.'),
            name: z.string().describe('Player full name.'),
            team: z.string().nullable().describe('Current team name, or null if not available.'),
            position: z.string().nullable().describe('Playing position, or null if not available.'),
            nationality: z
              .string()
              .nullable()
              .describe('Player nationality, or null if not available.'),
            birthDate: z
              .string()
              .nullable()
              .describe('Birth date in YYYY-MM-DD format, or null if not available.'),
            thumbnailUrl: z
              .string()
              .nullable()
              .describe('Player thumbnail image URL, or null if not available.'),
            source: z
              .literal('thesportsdb')
              .describe('Data source for this player record — always thesportsdb.'),
          })
          .describe('A matched player record.'),
      )
      .describe('Players matching the search query.'),
    query: z.string().describe('The search query used.'),
    totalFound: z.number().describe('Total number of players found.'),
  }),

  errors: [
    {
      reason: 'no_match',
      code: JsonRpcErrorCode.NotFound,
      when: 'No player matched the query in TheSportsDB.',
      recovery: "Try the player's full name, last name only, or a well-known nickname.",
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Finding player', { query: input.query, sport: input.sport });

    const players = await getTheSportsDbService().searchPlayers(input.query, ctx);

    if (input.sport && players.length > 0) {
      // TheSportsDB doesn't have a sport filter on search — we can't reliably filter here
      // without additional lookups. Surface all results and note the filter was advisory.
      ctx.log.debug('Sport filter advisory only — TSDB search has no server-side sport filter', {
        sport: input.sport,
      });
    }

    if (players.length === 0) {
      throw ctx.fail('no_match', `No player found matching "${input.query}".`, {
        ...ctx.recoveryFor('no_match'),
      });
    }

    return {
      players: players.map((p) => ({
        id: p.id,
        tsdbId: p.tsdbId,
        name: p.name,
        team: p.team,
        position: p.position,
        nationality: p.nationality,
        birthDate: p.birthDate,
        thumbnailUrl: p.thumbnailUrl,
        source: p.source,
      })),
      query: input.query,
      totalFound: players.length,
    };
  },

  format: (result) => {
    const lines: string[] = [
      `**Player Search: "${result.query}"** — ${result.totalFound} result(s)\n`,
    ];

    for (const p of result.players) {
      lines.push(`### ${p.name}`);
      lines.push(
        `Team: ${p.team ?? 'N/A'} | Position: ${p.position ?? 'N/A'} | Nationality: ${p.nationality ?? 'N/A'}`,
      );
      lines.push(`Born: ${p.birthDate ?? 'N/A'} | ID: ${p.id} (TSDB: ${p.tsdbId})`);
      lines.push(`Source: ${p.source}`);
      if (p.thumbnailUrl) lines.push(`Thumbnail: ${p.thumbnailUrl}`);
    }

    return [{ type: 'text' as const, text: lines.join('\n') }];
  },
});
