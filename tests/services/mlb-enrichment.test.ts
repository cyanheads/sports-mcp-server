/**
 * @fileoverview Optional MLB standings enrichment preserves terminal provider failures.
 * @module tests/services/mlb-enrichment.test
 */
import { JsonRpcErrorCode, McpError, serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MlbService } from '@/services/mlb/mlb-service.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MLB standings optional abbreviation lookup', () => {
  function service(error: Error) {
    const svc = new MlbService();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('Unexpected fetch');
      }),
    );
    // Only the acquisition seam is replaced: the catch and normalization under test run unchanged.
    vi.spyOn(
      svc as unknown as { fetchJson: (url: string) => Promise<unknown> },
      'fetchJson',
    ).mockImplementation(async (url) => {
      if (url.includes('/teams?')) throw error;
      return {
        records: [
          { teamRecords: [{ team: { id: 136, name: 'Seattle Mariners' }, wins: 90, losses: 72 }] },
        ],
      };
    });
    return svc;
  }

  it('preserves standings when optional metadata is unavailable', async () => {
    const result = await service(serviceUnavailable('Outage')).getStandings(
      null,
      createMockContext(),
    );
    expect(result[0]).toMatchObject({
      team: { id: 'mlb:136', abbreviation: '' },
      wins: 90,
      losses: 72,
    });
  });

  it.each([
    JsonRpcErrorCode.InvalidParams,
    JsonRpcErrorCode.ValidationError,
    JsonRpcErrorCode.RequestCancelled,
  ])('propagates code %i unchanged', async (code) => {
    const error = new McpError(code, 'Rejected');
    await expect(service(error).getStandings(null, createMockContext())).rejects.toBe(error);
  });

  it('does not swallow caller cancellation with a raw reason', async () => {
    const caller = new AbortController();
    caller.abort();
    const error = new Error('Abort');
    await expect(
      service(error).getStandings(null, createMockContext({ signal: caller.signal })),
    ).rejects.toBe(error);
  });
});
