/**
 * @fileoverview Provider HTTP classification, deadlines and cancellation through real retry helpers.
 * @module tests/services/provider-requests.test
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { logger } from '@cyanheads/mcp-ts-core/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sportsGetSchedule } from '@/mcp-server/tools/definitions/sports-get-schedule.tool.js';
import { sportsGetScores } from '@/mcp-server/tools/definitions/sports-get-scores.tool.js';
import { sportsGetTeam } from '@/mcp-server/tools/definitions/sports-get-team.tool.js';
import * as espnModule from '@/services/espn/espn-service.js';
import * as mlbModule from '@/services/mlb/mlb-service.js';
import { TheSportsDbService } from '@/services/thesportsdb/thesportsdb-service.js';

const KEY = 'sentinel-paid-key-7391';
vi.mock('@/config/server-config.js', () => ({
  getServerConfig: () => ({ theSportsDbApiKey: 'sentinel-paid-key-7391' }),
}));

const cases = [
  {
    name: 'ESPN',
    call: (ctx: Context) =>
      new espnModule.EspnService().getScoreboard('football', 'nfl', null, ctx),
  },
  { name: 'MLB', call: (ctx: Context) => new mlbModule.MlbService().getSchedule(null, ctx) },
  { name: 'TSDB', call: (ctx: Context) => new TheSportsDbService().searchTeams('Seattle', ctx) },
  {
    name: 'inline schedule',
    call: (ctx: Context) =>
      sportsGetSchedule.handler(
        { league: 'mlb', team_name: 'Mariners' },
        { ...ctx, ...createMockContext({ errors: sportsGetSchedule.errors, signal: ctx.signal }) },
      ),
  },
  {
    name: 'inline team',
    call: (ctx: Context) =>
      sportsGetTeam.handler(
        { league: 'mlb', team_name: 'Mariners' },
        { ...ctx, ...createMockContext({ errors: sportsGetTeam.errors, signal: ctx.signal }) },
      ),
  },
];

/** Native fetch fake: successful preparatory MLB reads, with every target request captured. */
function installFetch(
  name: string,
  response: (signal: AbortSignal) => Promise<Response> | Response,
) {
  const target = vi.fn(response);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const address = String(url);
      if (name.startsWith('inline')) {
        if (address.includes('/teams?sportId='))
          return Promise.resolve(
            Response.json({
              teams: [
                { id: 136, name: 'Seattle Mariners', teamName: 'Mariners', abbreviation: 'SEA' },
              ],
            }),
          );
        if (address.includes('/roster?')) return Promise.resolve(Response.json({ roster: [] }));
        if (address.includes('/schedule?') && !address.includes('teamId='))
          return Promise.resolve(Response.json({ dates: [] }));
      }
      if (!init?.signal) throw new Error('Missing fetch signal');
      return target(init.signal);
    }),
  );
  return target;
}

/** Abort-aware stalled headers/body, matching native fetch's rejection behavior. */
function stalled(
  signal: AbortSignal,
  phase: 'headers' | 'body',
  status = 200,
): Promise<Response> | Response {
  if (signal.aborted) return Promise.reject(signal.reason);
  if (phase === 'headers')
    return new Promise((_, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    );
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"pending":'));
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
      },
    }),
    { status },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  vi.spyOn(mlbModule, 'getMlbService').mockReturnValue(new mlbModule.MlbService());
  vi.spyOn(espnModule, 'getEspnService').mockReturnValue(new espnModule.EspnService());
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected fetch');
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(cases)('$name request boundary', ({ name, call }) => {
  it.each([400, 503])(
    'retries an attempt timeout while reading an HTTP %i body',
    async (status) => {
      const caller = new AbortController();
      const target = installFetch(name, () => Response.json({}));
      target.mockImplementationOnce((signal) => stalled(signal, 'body', status));
      const outcome = call(createMockContext({ signal: caller.signal })).catch(
        (error: unknown) => error,
      );
      try {
        await vi.advanceTimersByTimeAsync(11_100);
        expect(target).toHaveBeenCalledTimes(2);
        expect(await outcome).not.toBeInstanceOf(Error);
      } finally {
        caller.abort();
        await outcome;
      }
    },
  );

  it.each(['<!DOCTYPE html><html>temporary</html>', 'temporarily not JSON'])(
    'retries a non-JSON success body before returning valid JSON',
    async (body) => {
      const target = installFetch(name, () => Response.json({}));
      target.mockImplementationOnce(() => new Response(body));
      const outcome = call(createMockContext());
      await vi.runAllTimersAsync();
      expect(await outcome).not.toBeInstanceOf(Error);
      expect(target).toHaveBeenCalledTimes(2);
    },
  );

  it('bounds captured error diagnostics', async () => {
    const target = installFetch(name, () => new Response('x'.repeat(20_000), { status: 400 }));
    const outcome = call(createMockContext()).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await outcome;
    expect(error).toBeInstanceOf(McpError);
    if (!(error instanceof McpError)) throw new Error('Expected HTTP failure');
    expect(String(error.data?.body).length).toBeLessThan(550);
    expect(target).toHaveBeenCalledTimes(1);
  });

  it.each(['headers', 'body'] as const)(
    'bounds stalled %s attempts and the entire ladder',
    async (phase) => {
      const caller = new AbortController();
      const target = installFetch(name, (signal) => stalled(signal, phase));
      const outcome = call(createMockContext({ signal: caller.signal })).catch(
        (error: unknown) => error,
      );
      try {
        await vi.advanceTimersByTimeAsync(11_100);
        expect(target).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(18_900);
        expect(await outcome).toMatchObject({
          code: JsonRpcErrorCode.Timeout,
          data: { reason: 'retry_deadline_exceeded', deadlineMs: 30_000, retryAttempts: 3 },
        });
        expect(target).toHaveBeenCalledTimes(3);
      } finally {
        caller.abort();
        await outcome;
      }
    },
  );

  it.each(['headers', 'body'] as const)(
    'cancels during %s without another attempt',
    async (phase) => {
      const caller = new AbortController();
      const target = installFetch(name, (signal) => stalled(signal, phase));
      const outcome = call(createMockContext({ signal: caller.signal })).catch(
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(100);
      caller.abort();
      expect(await outcome).toMatchObject({ code: JsonRpcErrorCode.RequestCancelled });
      await vi.runAllTimersAsync();
      expect(target).toHaveBeenCalledTimes(1);
    },
  );

  it('interrupts retry backoff immediately', async () => {
    const caller = new AbortController();
    const target = installFetch(name, () => new Response('unavailable', { status: 503 }));
    let settled = false;
    const outcome = call(createMockContext({ signal: caller.signal }))
      .catch((error: unknown) => error)
      .finally(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(100);
    caller.abort();
    await vi.advanceTimersByTimeAsync(0);
    const stoppedBeforeBackoff = settled;
    await vi.runAllTimersAsync();
    await outcome;
    expect(stoppedBeforeBackoff).toBe(true);
    expect(target).toHaveBeenCalledTimes(1);
  });

  it('keeps cancellation terminal while reading a non-2xx body', async () => {
    const caller = new AbortController();
    const target = installFetch(name, (signal) => stalled(signal, 'body', 503));
    const outcome = call(createMockContext({ signal: caller.signal })).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(100);
    caller.abort();
    expect(await outcome).toMatchObject({ code: JsonRpcErrorCode.RequestCancelled });
    expect(target).toHaveBeenCalledTimes(1);
  });

  it('keeps an external signal timeout terminal and distinct from an attempt timeout', async () => {
    const caller = new AbortController();
    const target = installFetch(name, (signal) => stalled(signal, 'body'));
    const outcome = call(createMockContext({ signal: caller.signal })).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(100);
    caller.abort(new DOMException('External deadline', 'TimeoutError'));
    expect(await outcome).toMatchObject({
      code: JsonRpcErrorCode.Timeout,
      data: { errorSource: 'FetchSignalTimeout' },
    });
    await vi.runAllTimersAsync();
    expect(target).toHaveBeenCalledTimes(1);
  });

  it('keeps an external deadline terminal during HTTP error-body capture', async () => {
    const caller = new AbortController();
    const target = installFetch(name, (signal) => stalled(signal, 'body', 400));
    const outcome = call(createMockContext({ signal: caller.signal })).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(100);
    caller.abort(new DOMException('External deadline', 'TimeoutError'));
    expect(await outcome).toMatchObject({
      code: JsonRpcErrorCode.Timeout,
      data: { errorSource: 'FetchSignalTimeout' },
    });
    expect(target).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, JsonRpcErrorCode.InvalidParams],
    [401, JsonRpcErrorCode.Unauthorized],
    [403, JsonRpcErrorCode.Forbidden],
    [404, JsonRpcErrorCode.NotFound],
    [422, JsonRpcErrorCode.ValidationError],
    [501, JsonRpcErrorCode.ServiceUnavailable],
  ])('fails HTTP %i once with code %i and bounded body', async (status, code) => {
    const target = installFetch(name, () => new Response('provider rejection', { status }));
    const outcome = call(createMockContext()).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await outcome;
    expect(error).toMatchObject({ code, data: { status, body: 'provider rejection' } });
    if (status === 501) expect(error).toMatchObject({ data: { retryable: false } });
    expect(target).toHaveBeenCalledTimes(1);
  });

  it.each([408, 429, 500, 503, 504])(
    'retains four attempts for fast HTTP %i failures',
    async (status) => {
      const target = installFetch(name, () => new Response('temporary failure', { status }));
      const outcome = call(createMockContext()).catch((error: unknown) => error);
      await vi.runAllTimersAsync();
      expect(await outcome).toMatchObject({ data: { status, retryAttempts: 4 } });
      expect(target).toHaveBeenCalledTimes(4);
    },
  );

  it('honors Retry-After and preserves it if it exceeds the remaining budget', async () => {
    const target = installFetch(
      name,
      () => new Response('slow down', { status: 429, headers: { 'Retry-After': '2' } }),
    );
    target
      .mockImplementationOnce(
        () => new Response('slow down', { status: 429, headers: { 'Retry-After': '2' } }),
      )
      .mockImplementationOnce(
        () => new Response('later', { status: 429, headers: { 'Retry-After': '29' } }),
      );
    const outcome = call(createMockContext()).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1999);
    expect(target).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
      data: { retryAfter: '29', status: 429 },
    });
    expect(target).toHaveBeenCalledTimes(2);
  });
});

describe('ESPN scoreboard recovery', () => {
  it.each([sportsGetScores, sportsGetSchedule])(
    '$name preserves HTTP 400 and gives date guidance on both surfaces',
    async (definition) => {
      installFetch(
        'ESPN',
        () =>
          new Response('{"code":400,"message":"Failed to get events endpoint."}', { status: 400 }),
      );
      const args =
        definition.name === 'sports_get_scores'
          ? { league: 'nfl', date: '2026-13-99' }
          : { league: 'nfl', date_from: '2026-13-99', date_to: '2026-13-99' };
      const outcome = runToolContract(definition, args);
      await vi.runAllTimersAsync();
      const result = await outcome;
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: JsonRpcErrorCode.InvalidParams,
          data: { status: 400, recovery: { hint: expect.stringContaining('date') } },
        },
      });
      expect(JSON.stringify(result)).not.toContain('invalid_league');
      expect(JSON.stringify(result.content)).toContain('Recovery:');
    },
  );

  it('never classifies by message text containing 400', async () => {
    installFetch('ESPN', () => {
      throw new Error('socket error 400');
    });
    const outcome = new espnModule.EspnService()
      .getScoreboard('football', 'nfl', null, createMockContext())
      .catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await outcome).toMatchObject({ code: JsonRpcErrorCode.ServiceUnavailable });
  });
});

describe('TheSportsDB credential boundary', () => {
  it.each(['http', 'network', 'parse'] as const)(
    'never exposes the paid path key in %s errors or logs',
    async (kind) => {
      const debug = vi.spyOn(logger, 'debug');
      const errorLog = vi.spyOn(logger, 'error');
      installFetch('TSDB', () => {
        if (kind === 'network')
          throw new Error(
            `fetch https://www.thesportsdb.com/api/v1/json/${KEY}/searchteams.php failed`,
            { cause: new Error(KEY) },
          );
        return new Response(kind === 'parse' ? KEY : `denied ${KEY}`, {
          status: kind === 'http' ? 400 : 200,
        });
      });
      const outcome = new TheSportsDbService()
        .searchTeams('Seattle', createMockContext())
        .catch((error: unknown) => error);
      await vi.runAllTimersAsync();
      const error = await outcome;
      expect(error).toBeInstanceOf(McpError);
      let cause: unknown = error;
      while (cause instanceof Error) {
        expect(cause.message).not.toContain(KEY);
        expect(JSON.stringify(cause)).not.toContain(KEY);
        cause = cause.cause;
      }
      expect(JSON.stringify([debug.mock.calls, errorLog.mock.calls])).not.toContain(KEY);
      if (kind === 'http')
        expect(error).toMatchObject({
          code: JsonRpcErrorCode.InvalidParams,
          data: { body: 'denied [redacted]' },
        });
    },
  );
});
