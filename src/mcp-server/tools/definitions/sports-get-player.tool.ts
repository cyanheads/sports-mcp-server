/**
 * @fileoverview sports_get_player tool — full player bio and metadata from TheSportsDB.
 * @module mcp-server/tools/definitions/sports-get-player.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getTheSportsDbService } from '@/services/thesportsdb/thesportsdb-service.js';

export const sportsGetPlayer = tool('sports_get_player', {
  description:
    'Full player detail from TheSportsDB: bio, current team, position, nationality, birth date, ' +
    'height/weight, career description, and media thumbnail. ' +
    'Requires a TheSportsDB player ID — use sports_find_player to resolve a player name to a valid player_id first.',

  annotations: { readOnlyHint: true, openWorldHint: true },

  input: z.object({
    player_id: z
      .string()
      .max(50, 'Player ID must be 50 characters or fewer.')
      .describe(
        'TheSportsDB player ID. Accepts tsdb: prefixed (e.g. tsdb:34185573) or raw numeric string (e.g. 34185573).',
      ),
  }),

  output: z.object({
    player: z
      .object({
        id: z.string().describe('TSDB-prefixed player ID.'),
        tsdbId: z.string().describe('TheSportsDB numeric player ID.'),
        espnId: z.string().nullable().describe('ESPN player ID cross-reference, or null.'),
        name: z.string().describe('Player full name.'),
        team: z.string().nullable().describe('Current team name, or null.'),
        position: z.string().nullable().describe('Playing position, or null.'),
        nationality: z.string().nullable().describe('Player nationality, or null.'),
        birthDate: z.string().nullable().describe('Birth date in YYYY-MM-DD, or null.'),
        height: z.string().nullable().describe('Height string (e.g. "6\'4""), or null.'),
        weight: z.string().nullable().describe('Weight string (e.g. "225 lbs"), or null.'),
        description: z
          .string()
          .nullable()
          .describe('Career description/biography in English, or null.'),
        thumbnailUrl: z.string().nullable().describe('Thumbnail image URL, or null.'),
        source: z
          .literal('thesportsdb')
          .describe('Data source for this player record — always thesportsdb.'),
      })
      .describe('Full player record.'),
  }),

  errors: [
    {
      reason: 'player_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'TheSportsDB returned HTTP 200 with an invalid player ID indicator, or the player was not found.',
      recovery:
        'Use sports_find_player to search for the player by name and get a valid player_id.',
    },
  ],

  async handler(input, ctx) {
    // Strip tsdb: prefix if present
    const rawId = input.player_id.startsWith('tsdb:') ? input.player_id.slice(5) : input.player_id;

    ctx.log.info('Fetching player detail', { playerId: rawId });

    const player = await getTheSportsDbService().lookupPlayer(rawId, ctx);

    if (!player) {
      throw ctx.fail('player_not_found', `No player found with ID "${input.player_id}".`, {
        ...ctx.recoveryFor('player_not_found'),
      });
    }

    return { player };
  },

  format: (result) => {
    const p = result.player;
    const lines: string[] = [
      `# ${p.name}`,
      `**Team:** ${p.team ?? 'N/A'} | **Position:** ${p.position ?? 'N/A'}`,
      `**Nationality:** ${p.nationality ?? 'N/A'} | **Born:** ${p.birthDate ?? 'N/A'}`,
      `**Height:** ${p.height ?? 'N/A'} | **Weight:** ${p.weight ?? 'N/A'}`,
      `**ID:** ${p.id} (TSDB: ${p.tsdbId}) | **ESPN:** ${p.espnId ?? 'N/A'}`,
    ];

    if (p.thumbnailUrl) lines.push(`**Thumbnail:** ${p.thumbnailUrl}`);

    if (p.description) {
      lines.push('', '## Bio');
      // Truncate long descriptions for readability
      const bio = p.description.length > 1000 ? `${p.description.slice(0, 1000)}…` : p.description;
      lines.push(bio);
    }

    lines.push(`Source: ${p.source}`);

    return [{ type: 'text' as const, text: lines.join('\n') }];
  },
});
