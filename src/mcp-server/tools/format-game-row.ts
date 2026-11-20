/**
 * @fileoverview Render metadata for one normalized game.
 * @module mcp-server/tools/format-game-row
 */

import type { NormalizedGame } from '@/services/types.js';
import { inline } from './formatting.js';

/** Render a complete game row independently of its containing tool's heading. */
export function formatGameRow(
  g: NormalizedGame,
  periodLabel: 'Period' | 'Period/Inning',
): string[] {
  const detail = g.statusDetail == null ? '' : ` | Status detail: ${g.statusDetail}`;
  const period = g.period != null ? ` | ${periodLabel}: ${g.period}` : '';
  const clock = g.clock ? ` | Clock: ${g.clock}` : '';
  return [
    inline`**${g.shortName}** [${g.id}] — ${g.status}${detail}${period}${clock}`,
    inline`  Away: ${g.awayTeam.name} (${g.awayTeam.abbreviation}) [${g.awayTeam.id}] — ${g.awayTeam.score ?? '—'}`,
    inline`  Home: ${g.homeTeam.name} (${g.homeTeam.abbreviation}) [${g.homeTeam.id}] — ${g.homeTeam.score ?? '—'}`,
    inline`  Start: ${g.startTimeUtc} | Venue: ${g.venue ?? 'N/A'} | Source: ${g.source}`,
  ];
}
