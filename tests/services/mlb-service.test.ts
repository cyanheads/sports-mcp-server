/**
 * @fileoverview Unit tests for MLB StatsAPI schedule acquisition and normalization.
 * @module tests/services/mlb-service.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('fetch', vi.fn());

import { MlbService } from '@/services/mlb/mlb-service.js';

describe('MlbService', () => {
  const ctx = createMockContext();
  const svc = new MlbService();

  it('preserves both bounds in a range schedule request', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ dates: [] }),
    } as Response);

    const games = await svc.getScheduleRange('2026-07-04', '2026-07-05', ctx);

    expect(games).toEqual([]);
    expect(fetch).toHaveBeenCalledWith(
      'https://statsapi.mlb.com/api/v1/schedule?sportId=1&hydrate=team,linescore,decisions&startDate=2026-07-04&endDate=2026-07-05',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('retries failed range requests through the shared fetch path', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockReset()
      .mockResolvedValue({ ok: false, status: 503 } as Response);

    try {
      const rejection = expect(
        svc.getScheduleRange('2026-07-04', '2026-07-05', ctx),
      ).rejects.toThrow('failed after 4 attempts');
      await vi.runAllTimersAsync();
      await rejection;
      expect(fetch).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
});
