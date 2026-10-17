/**
 * @fileoverview Optional MLB standings enrichment preserves terminal provider failures.
 * @module tests/services/mlb-enrichment.test
 */
import { JsonRpcErrorCode, McpError, serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sportsGetStandings } from '@/mcp-server/tools/definitions/sports-get-standings.tool.js';
import * as mlbModule from '@/services/mlb/mlb-service.js';
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
  it('discloses metadata degradation on both callable standings surfaces', async () => {
    vi.spyOn(mlbModule, 'getMlbService').mockReturnValue(service(serviceUnavailable('secret')));
    const result = await runToolContract(sportsGetStandings, { league: 'mlb', season: '2025' });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      standings: [{ wins: 90 }],
      unavailableSources: [
        {
          source: 'mlbstats',
          operation: 'standings_team_metadata',
          reason: 'unavailable',
          recovery: expect.any(String),
        },
      ],
    });
    expect(JSON.stringify(result.content)).toContain('standings_team_metadata');
    expect(JSON.stringify(result)).not.toContain('secret');
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
