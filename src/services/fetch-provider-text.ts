/**
 * @fileoverview Bounded ESPN/MLB text acquisition, including unfinished HTTP error bodies.
 * @module services/fetch-provider-text
 */
import type { Context } from '@cyanheads/mcp-ts-core';
import { requestCancelled, timeout } from '@cyanheads/mcp-ts-core/errors';
import { fetchWithTimeout, type RetryAttempt } from '@cyanheads/mcp-ts-core/utils';

/** Consume one attempt under a clock that remains observable after HTTP error-body capture. */
export async function fetchProviderText(
  url: string,
  ctx: Context,
  attempt: RetryAttempt,
): Promise<string> {
  const timeoutMs = Math.min(10_000, attempt.remainingMs);
  const controller = new AbortController();
  // Keep abort causes visible while core captures non-2xx bodies: cyanheads/mcp-ts-core#604.
  const timer = setTimeout(
    () => controller.abort(new DOMException('Provider attempt timed out.', 'TimeoutError')),
    timeoutMs,
  );
  const signal = AbortSignal.any([attempt.signal, controller.signal]);
  try {
    const response = await fetchWithTimeout(url, timeoutMs, ctx, { signal });
    const text = await response.text();
    signal.throwIfAborted();
    return text;
  } catch (error: unknown) {
    if (attempt.signal.aborted) {
      if (attempt.signal.reason?.name === 'TimeoutError') {
        throw timeout('Provider request reached its external deadline.', {
          errorSource: 'FetchSignalTimeout',
        });
      }
      throw requestCancelled('Provider request was cancelled.', { errorSource: 'FetchAborted' });
    }
    if (controller.signal.aborted) {
      throw timeout('Provider request timed out.', { errorSource: 'FetchTimeout' });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
