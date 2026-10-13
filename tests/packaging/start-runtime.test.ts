/**
 * @fileoverview Actual documented start commands must serve with Node while builds retain Bun.
 * @module tests/packaging/start-runtime.test
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it.each(['start:stdio', 'start:http'])(
  '%s runs the rebuilt server under Node',
  async (script) => {
    const reservation = createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const address = reservation.address();
    if (!address || typeof address === 'string') throw new Error('Expected loopback port');
    const port = address.port;
    await new Promise<void>((resolve, reject) =>
      reservation.close((error) => (error ? reject(error) : resolve())),
    );
    const child = spawn('bun', ['run', script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${resolve('tests/fixtures/runtime-probe.cjs')}`,
        MCP_HTTP_HOST: '127.0.0.1',
        MCP_HTTP_PORT: String(port),
        MCP_AUTH_MODE: 'none',
        LOG_LEVEL: 'info',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let executable = '';
    let serverPid: number | undefined;
    const read = (chunk: Buffer) => {
      output += String(chunk);
      const match = /SPORTS_RUNTIME (\{[^\n]+\})/.exec(output);
      if (match) {
        const record = JSON.parse(match[1]);
        executable = record.executable;
        serverPid = record.pid;
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    try {
      if (script === 'start:stdio') {
        child.stdin.end();
        await once(child, 'exit');
      } else {
        const deadline = Date.now() + 6000;
        let ready = false;
        while (Date.now() < deadline && child.exitCode === null) {
          try {
            ready =
              (
                await fetch(`http://127.0.0.1:${port}/healthz`, {
                  signal: AbortSignal.timeout(100),
                })
              ).status === 200;
          } catch {}
          if (ready) break;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(child.exitCode, output).toBeNull();
        expect(ready, output).toBe(true);
      }
      expect(executable).toMatch(/\/node$/);
      if (script === 'start:stdio') expect(child.exitCode).toBe(0);
    } finally {
      if (serverPid && serverPid !== child.pid) {
        try {
          process.kill(serverPid, 'SIGTERM');
        } catch {}
      }
      if (child.exitCode === null) child.kill('SIGTERM');
      if (child.exitCode === null)
        await Promise.race([
          once(child, 'exit'),
          new Promise((resolve) => setTimeout(resolve, 1000)),
        ]);
    }
  },
  10000,
);
