/**
 * @fileoverview Server-specific configuration for sports-mcp-server.
 * @module config/server-config
 */

import { z } from '@cyanheads/mcp-ts-core';
import { parseEnvConfig } from '@cyanheads/mcp-ts-core/config';

/** Public TheSportsDB key with one-record player/team search limits. */
export const THE_SPORTS_DB_PUBLIC_KEY = '123';

const ServerConfigSchema = z.object({
  theSportsDbApiKey: z
    .string()
    .default(THE_SPORTS_DB_PUBLIC_KEY)
    .describe(
      'TheSportsDB API key (default: free public key "123", one-record player/team searches)',
    ),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

let _config: ServerConfig | undefined;

export function getServerConfig(): ServerConfig {
  _config ??= parseEnvConfig(ServerConfigSchema, {
    theSportsDbApiKey: 'THESPORTSDB_API_KEY',
  });
  return _config;
}
