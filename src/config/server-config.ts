/**
 * @fileoverview Server-specific configuration for sports-mcp-server.
 * @module config/server-config
 */

import { z } from '@cyanheads/mcp-ts-core';
import { parseEnvConfig } from '@cyanheads/mcp-ts-core/config';

const ServerConfigSchema = z.object({
  theSportsDbApiKey: z
    .string()
    .default('3')
    .describe('TheSportsDB API key (default: free public key "3")'),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

let _config: ServerConfig | undefined;

export function getServerConfig(): ServerConfig {
  _config ??= parseEnvConfig(ServerConfigSchema, {
    theSportsDbApiKey: 'THESPORTSDB_API_KEY',
  });
  return _config;
}
