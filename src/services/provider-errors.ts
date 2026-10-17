/**
 * @fileoverview Keep input rejection and cancellation terminal in optional provider lookups.
 * @module services/provider-errors
 */
import { type Context, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';

/** Safe bounded disclosure of an optional provider contribution that failed. */
export const UnavailableSources = z
  .array(
    z
      .object({
        source: z.enum(['espn', 'mlbstats']).describe('Unavailable optional provider.'),
        operation: z
          .enum(['team_list', 'standings_team_metadata'])
          .describe('Failed optional contribution.'),
        reason: z.literal('unavailable').describe('Provider contribution could not be obtained.'),
        recovery: z
          .string()
          .max(200)
          .describe('Safe guidance for retrying the missing contribution.'),
      })
      .describe('One unavailable optional provider contribution.'),
  )
  .max(2)
  .optional()
  .describe('Failed optional contributions; successful records remain available.');

/** Construct disclosure without exposing provider messages or request data. */
export function unavailableSource(
  source: 'espn' | 'mlbstats',
  operation: 'team_list' | 'standings_team_metadata',
) {
  return {
    source,
    operation,
    reason: 'unavailable' as const,
    recovery: 'Retry the same request later to obtain the missing optional contribution.',
  };
}

/** Rethrow failures that cannot be represented as an unavailable optional source. */
export function rethrowTerminalProviderError(error: unknown, ctx: Context): void {
  if (
    ctx.signal.aborted ||
    (error instanceof McpError &&
      (error.code === JsonRpcErrorCode.InvalidParams ||
        error.code === JsonRpcErrorCode.InvalidRequest ||
        error.code === JsonRpcErrorCode.ValidationError ||
        error.code === JsonRpcErrorCode.RequestCancelled ||
        error.data?.errorSource === 'FetchSignalTimeout'))
  )
    throw error;
}
