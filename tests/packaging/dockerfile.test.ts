/**
 * @fileoverview Regression tests for the multi-stage production image contract.
 * @module tests/packaging/dockerfile.test
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');

describe('Dockerfile', () => {
  it('keeps Bun as the native build-stage runtime', () => {
    expect(dockerfile).toContain('FROM --platform=$BUILDPLATFORM oven/bun:1.4.0 AS build');
    expect(dockerfile).toContain('RUN bun run build');
  });

  it('runs the final image as a non-root user with a writable log directory', () => {
    expect(dockerfile).toContain('RUN mkdir -p /var/log/sports-mcp-server');
    expect(dockerfile).toMatch(/USER \S+/);
    expect(dockerfile).toContain('ENV LOGS_DIR="/var/log/sports-mcp-server"');
  });

  it('uses Node for the production stage, healthcheck, and server command', () => {
    expect(dockerfile).toContain('FROM node:24-bookworm-slim AS production');
    expect(dockerfile).toContain('chown -R node:node /var/log/sports-mcp-server');
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain('HEALTHCHECK --interval=30s');
    expect(dockerfile).toContain('CMD node -e');
    expect(dockerfile).toContain('CMD ["node", "dist/index.js"]');
  });
});
