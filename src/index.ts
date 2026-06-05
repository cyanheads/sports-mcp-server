#!/usr/bin/env node
/**
 * @fileoverview sports-mcp-server MCP server entry point.
 * @module index
 */

import { createApp } from '@cyanheads/mcp-ts-core';
import { allPromptDefinitions } from './mcp-server/prompts/definitions/index.js';
import { allResourceDefinitions } from './mcp-server/resources/definitions/index.js';
import {
  sportsFindPlayer,
  sportsFindTeam,
  sportsGetPlayer,
  sportsGetSchedule,
  sportsGetScores,
  sportsGetStandings,
  sportsGetTeam,
} from './mcp-server/tools/definitions/index.js';
import { initEspnService } from './services/espn/espn-service.js';
import { initMlbService } from './services/mlb/mlb-service.js';
import { initTheSportsDbService } from './services/thesportsdb/thesportsdb-service.js';

await createApp({
  tools: [
    sportsGetScores,
    sportsGetSchedule,
    sportsGetStandings,
    sportsFindTeam,
    sportsGetTeam,
    sportsFindPlayer,
    sportsGetPlayer,
  ],
  resources: allResourceDefinitions,
  prompts: allPromptDefinitions,
  instructions:
    'sports-mcp-server provides live and historical sports data — scores, schedules, standings, ' +
    'teams, and players — across major leagues via ESPN, MLB StatsAPI, and TheSportsDB.\n\n' +
    'Supported leagues: nfl, nba, mlb, nhl, epl, mls, laliga, bundesliga, seriea, ligue1, ucl, ncaaf, ncaab.\n\n' +
    'Typical workflows:\n' +
    '- "Did the Mariners win?" → sports_get_scores(league:"mlb")\n' +
    '- "NBA standings" → sports_get_standings(league:"nba")\n' +
    '- "When does Arsenal play next?" → sports_find_team → sports_get_schedule or sports_get_team\n' +
    '- "Tell me about Shohei Ohtani" → sports_find_player → sports_get_player\n' +
    'No API keys required — all sources are keyless (ESPN, MLB) or use the public free tier (TheSportsDB).',
  setup(core) {
    initEspnService(core.config, core.storage);
    initMlbService(core.config, core.storage);
    initTheSportsDbService(core.config, core.storage);
  },
});
