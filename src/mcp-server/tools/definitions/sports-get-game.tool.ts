/**
 * @fileoverview Game detail with bounded scoring-play pages and provider game statistics.
 * @module mcp-server/tools/definitions/sports-get-game.tool
 */
import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getEspnService } from '@/services/espn/espn-service.js';
import { getMlbService } from '@/services/mlb/mlb-service.js';
import { LEAGUE_ROUTES, SUPPORTED_LEAGUES } from '@/services/types.js';
import { inline } from '../formatting.js';
import { sportsGetScores } from './sports-get-scores.tool.js';

const Team = z
  .object({
    id: z.string().describe('Provider-prefixed team ID.'),
    name: z.string().describe('Provider team name.'),
    abbreviation: z.string().describe('Provider team abbreviation, empty when unavailable.'),
  })
  .describe('Game team identity.');
const Person = z
  .object({
    id: z.string().describe('Provider-prefixed athlete ID; not a sports_get_player ID.'),
    name: z.string().nullable().describe('Athlete name, null when the event supplies only an ID.'),
  })
  .describe('Game athlete identity.');

export const sportsGetGame = tool('sports_get_game', {
  description:
    'Game metadata, period scores, team totals, provider top performers, and scoring plays. Pass a game ID returned by sports_get_scores, sports_get_schedule, or sports_get_team with its league; ESPN IDs do not identify a league. Scheduled games return metadata with empty played-stat sections. Scoring plays default to 20 per page, capped at 50; continue with nextOffset and the same league and game_id. Other sections remain on every page. No full player boxscores or season statistics.',
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    league: z
      .enum(SUPPORTED_LEAGUES)
      .describe('Supported league of the game; required to route ESPN IDs.'),
    game_id: z
      .string()
      .max(32)
      .regex(/^(espn|mlb):[0-9]+$/)
      .describe(
        'Source-prefixed numeric game ID, e.g. espn:401872981. mlb: IDs require league mlb.',
      ),
    offset: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .default(0)
      .describe('Zero-based scoring-play offset. Defaults to 0; use nextOffset to continue.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER)
      .default(20)
      .describe(
        'Scoring plays requested per page. Defaults to 20; values above 50 are clipped and disclosed.',
      ),
  }),
  output: z.object({
    game: sportsGetScores.output.shape.games.element.describe(
      'Game metadata with the established source-prefixed ID.',
    ),
    league: z.string().describe('The league queried.'),
    periodScores: z
      .array(
        z
          .object({
            period: z.number().describe('One-based period or inning number.'),
            label: z.string().nullable().describe('Provider period label when supplied.'),
            homeScore: z
              .string()
              .nullable()
              .describe('Home period score; null if missing or inning unplayed.'),
            awayScore: z.string().nullable().describe('Away period score; null if missing.'),
          })
          .describe('One period line.'),
      )
      .describe('Played period lines; empty when unavailable or not started.'),
    teamStats: z
      .array(
        z
          .object({
            team: Team.describe('Team identity.'),
            statistics: z
              .array(
                z
                  .object({
                    name: z
                      .string()
                      .describe(
                        'Provider statistic name; MLB names include batting, pitching, or fielding category.',
                      ),
                    label: z
                      .string()
                      .nullable()
                      .describe('Provider display label, null when unavailable.'),
                    value: z
                      .string()
                      .nullable()
                      .describe(
                        'Game display value, preserving zero; MLB AVG/OBP/SLG/OPS/ERA/WHIP derive from game counts. Null when operands are unavailable.',
                      ),
                  })
                  .describe('One provider statistic.'),
              )
              .describe('Game-only team statistics.'),
          })
          .describe('One team statistics group.'),
      )
      .describe('Team totals; empty when unavailable or not started.'),
    leaders: z
      .array(
        z
          .object({
            team: Team.describe('Performer team.'),
            category: z.string().describe('Provider statistic category or top-performer type.'),
            label: z
              .string()
              .nullable()
              .describe('Provider category label or top-performer designation.'),
            player: Person.describe('Performer identity.'),
            displayValue: z
              .string()
              .nullable()
              .describe('Provider game performance, null when unavailable.'),
          })
          .describe('One provider performer.'),
      )
      .describe('Provider game leaders or top performers, without composite rankings.'),
    scoringPlays: z
      .array(
        z
          .object({
            id: z
              .string()
              .nullable()
              .describe('Provider event ID or MLB at-bat index, null if missing.'),
            period: z.number().nullable().describe('Period or inning, null if not supplied.'),
            clock: z.string().nullable().describe('Provider clock or inning half.'),
            teamId: z
              .string()
              .nullable()
              .describe('Source-prefixed scoring team ID when supplied.'),
            text: z.string().describe('Provider scoring event description.'),
            homeScore: z
              .string()
              .nullable()
              .describe('Home score after this event; null when unavailable.'),
            awayScore: z
              .string()
              .nullable()
              .describe('Away score after this event; null when unavailable.'),
            participants: z
              .array(Person)
              .describe('Provider event participants; names may be unavailable.'),
          })
          .describe('One normalized scoring event.'),
      )
      .describe('One page of normalized scoring events; no raw play-by-play.'),
  }),
  enrichment: {
    totalCount: z.number().describe('Total scoring events available in this response snapshot.'),
    offset: z.number().describe('Requested zero-based offset.'),
    returnedCount: z.number().describe('Scoring events returned on this page.'),
    servedFrom: z
      .number()
      .nullable()
      .describe('Zero-based first served event index, null for an empty page.'),
    servedTo: z
      .number()
      .nullable()
      .describe('Zero-based last served event index, null for an empty page.'),
    nextOffset: z.number().nullable().describe('Next scoring-play offset; null at the end.'),
    effectiveLimit: z.number().describe('Applied scoring-play page limit.'),
    truncationCeiling: z
      .number()
      .optional()
      .describe('Serving cap when a larger limit was clipped.'),
    notice: z
      .string()
      .optional()
      .describe('Explanation of unavailable scoring events, past-end offsets, or a clipped limit.'),
  },
  errors: [
    {
      reason: 'incompatible_game_source',
      code: JsonRpcErrorCode.ValidationError,
      when: 'An MLB game ID is used with another league.',
      recovery:
        'Use league mlb with mlb: game IDs, or obtain an ESPN game ID for the requested league.',
    },
    {
      reason: 'game_not_found',
      code: JsonRpcErrorCode.NotFound,
      thrownBy: 'service',
      when: 'The provider explicitly reports that the game does not exist in this league.',
      recovery:
        'Check the league and use a game ID returned by sports_get_scores or sports_get_schedule.',
    },
  ],
  async handler(input, ctx) {
    const source = input.game_id.slice(0, input.game_id.indexOf(':'));
    const id = input.game_id.slice(input.game_id.indexOf(':') + 1);
    if (source === 'mlb' && input.league !== 'mlb') throw ctx.fail('incompatible_game_source');
    // biome-ignore lint/style/noNonNullAssertion: The supported league enum guarantees a route.
    const route = LEAGUE_ROUTES[input.league]!;
    const detail =
      source === 'mlb'
        ? await getMlbService().getGame(id, ctx)
        : await getEspnService().getGame(route.espnSport, route.espnLeague, id, ctx);
    const totalCount = detail.scoringPlays.length;
    const effectiveLimit = Math.min(input.limit, 50);
    const scoringPlays = detail.scoringPlays.slice(input.offset, input.offset + effectiveLimit);
    const nextOffset =
      input.offset + scoringPlays.length < totalCount ? input.offset + scoringPlays.length : null;
    const notices: string[] = [];
    if (input.limit > effectiveLimit)
      notices.push(`Requested limit ${input.limit} was clipped to ${effectiveLimit}.`);
    if (!totalCount)
      notices.push(
        'No scoring plays are available for this game; scheduled games have no played statistics.',
      );
    else if (!scoringPlays.length)
      notices.push(
        `Offset ${input.offset} is past the ${totalCount} available scoring plays. Use an offset below ${totalCount}.`,
      );
    ctx.enrich({
      totalCount,
      offset: input.offset,
      returnedCount: scoringPlays.length,
      servedFrom: scoringPlays.length ? input.offset : null,
      servedTo: scoringPlays.length ? input.offset + scoringPlays.length - 1 : null,
      nextOffset,
      effectiveLimit,
      ...(input.limit > effectiveLimit ? { truncationCeiling: 50 } : {}),
      ...(notices.length ? { notice: notices.join(' ') } : {}),
    });
    return { ...detail, scoringPlays, league: input.league };
  },
  format: (result) => {
    // biome-ignore lint/style/noNonNullAssertion: The scores definition declares its formatter.
    const lines = sportsGetScores.format!({
      games: [result.game],
      league: result.league,
      date: result.game.startTimeUtc.slice(0, 10),
    })
      .map((block) => (block.type === 'text' ? block.text : ''))
      .filter(Boolean);
    lines.push('Period scores:');
    for (const period of result.periodScores)
      lines.push(
        inline`${period.period} (${period.label ?? 'N/A'}): away ${period.awayScore ?? 'N/A'}, home ${period.homeScore ?? 'N/A'}`,
      );
    lines.push('Team statistics:');
    for (const entry of result.teamStats) {
      lines.push(inline`${entry.team.name} (${entry.team.abbreviation}) [${entry.team.id}]`);
      for (const stat of entry.statistics)
        lines.push(inline`  ${stat.name} (${stat.label ?? 'N/A'}): ${stat.value ?? 'N/A'}`);
    }
    lines.push('Provider game leaders:');
    for (const leader of result.leaders)
      lines.push(
        inline`${leader.team.name} (${leader.team.abbreviation}) [${leader.team.id}] — ${leader.category} (${leader.label ?? 'N/A'}): ${leader.player.name ?? 'N/A'} [${leader.player.id}], ${leader.displayValue ?? 'N/A'}`,
      );
    lines.push('Scoring plays:');
    for (const play of result.scoringPlays) {
      lines.push(
        inline`[${play.id ?? 'N/A'}] Period ${play.period ?? 'N/A'} | Clock ${play.clock ?? 'N/A'} | Team ${play.teamId ?? 'N/A'} | Away ${play.awayScore ?? 'N/A'} / Home ${play.homeScore ?? 'N/A'}: ${play.text}`,
      );
      for (const participant of play.participants)
        lines.push(inline`  ${participant.name ?? 'N/A'} [${participant.id}]`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
