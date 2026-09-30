/**
 * @fileoverview Keep input rejection and cancellation terminal in optional provider lookups.
 * @module services/provider-errors
 */
import type { Context } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';

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
