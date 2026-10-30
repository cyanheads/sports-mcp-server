/**
 * @fileoverview Public TheSportsDB default and explicit environment overrides.
 * @module tests/config/server-config.test
 */

import { afterEach, expect, it, vi } from 'vitest';
// Transform framework dependencies before individual configuration cases run.
import '@/config/server-config.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each(['custom-key', '3'])('preserves explicit TheSportsDB key %s', async (key) => {
  vi.stubEnv('THESPORTSDB_API_KEY', key);
  vi.resetModules();
  const { getServerConfig } = await import('@/config/server-config.js');
  expect(getServerConfig().theSportsDbApiKey).toBe(key);
});

it('uses the current public key when the environment override is unset', async () => {
  vi.stubEnv('THESPORTSDB_API_KEY', undefined);
  vi.resetModules();
  const { getServerConfig } = await import('@/config/server-config.js');
  expect(getServerConfig().theSportsDbApiKey).toBe('123');
});
