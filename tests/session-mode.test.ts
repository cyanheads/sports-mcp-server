/**
 * @fileoverview Boots the server entry point over HTTP and reads the session mode the
 * framework resolved, covering the source-level default and `MCP_SESSION_MODE` precedence.
 * @module tests/session-mode.test
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ENTRY = new URL('../src/index.ts', import.meta.url).pathname;
const BOOT_TIMEOUT_MS = 15_000;

/** Reserves an ephemeral port from the OS, then releases it for the server to bind. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('Could not reserve an ephemeral port.'));
      });
    });
  });
}

/**
 * Starts `src/index.ts` as an HTTP server and returns the `sessionMode` it reports on a
 * plain `GET /mcp`. `undefined` leaves `MCP_SESSION_MODE` out of the child's environment.
 * The child runs from an empty temp directory so no local `.env` leaks into it.
 */
async function resolvedSessionMode(sessionModeEnv: string | undefined): Promise<string> {
  const port = await freePort();
  const workdir = mkdtempSync(join(tmpdir(), 'sports-mcp-session-'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MCP_TRANSPORT_TYPE: 'http',
    MCP_HTTP_HOST: '127.0.0.1',
    MCP_HTTP_PORT: String(port),
    MCP_AUTH_MODE: 'none',
    MCP_LOG_LEVEL: 'error',
    LOGS_DIR: workdir,
    OTEL_ENABLED: 'false',
  };
  delete env.MCP_SESSION_MODE;
  if (sessionModeEnv !== undefined) env.MCP_SESSION_MODE = sessionModeEnv;

  const child = spawn('bun', [ENTRY], { cwd: workdir, env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));

  try {
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`Server exited with code ${child.exitCode} before serving:\n${stderr}`);
      }
      try {
        const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
          headers: { accept: 'application/json' },
        });
        const body = (await res.json()) as { server: { sessionMode: string } };
        return body.server.sessionMode;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error(`Server did not answer GET /mcp within ${BOOT_TIMEOUT_MS} ms:\n${stderr}`);
  } finally {
    if (child.exitCode === null && child.pid !== undefined) {
      process.kill(child.pid, 'SIGTERM');
      const forceKill = setTimeout(() => {
        if (child.exitCode === null && child.pid !== undefined) process.kill(child.pid, 'SIGKILL');
      }, 5_000);
      await exited;
      clearTimeout(forceKill);
    }
    rmSync(workdir, { recursive: true, force: true });
  }
}

describe('HTTP session mode', () => {
  it('defaults to stateless when MCP_SESSION_MODE is unset', async () => {
    expect(await resolvedSessionMode(undefined)).toBe('stateless');
  }, 30_000);

  it('treats a blank MCP_SESSION_MODE as unset and keeps the stateless default', async () => {
    expect(await resolvedSessionMode('')).toBe('stateless');
  }, 30_000);

  it.each([
    ['stateful', 'stateful'],
    ['auto', 'stateful'],
  ])(
    'lets MCP_SESSION_MODE=%s override the default (resolves %s)',
    async (value, expected) => {
      expect(await resolvedSessionMode(value)).toBe(expected);
    },
    30_000,
  );
});
