<div align="center">
  <h1>@cyanheads/sports-mcp-server</h1>
  <p><b>Get live scores, schedules, standings, team and player data for NFL, NBA, MLB, NHL, soccer, and more via MCP. STDIO or Streamable HTTP.</b>
  <div>8 Tools</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.5.0-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/sports-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.4.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/sports-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/sports-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.4%2B-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/sports-mcp-server/releases/latest/download/sports-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=sports-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvc3BvcnRzLW1jcC1zZXJ2ZXIiXX0=) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22sports-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fsports-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

---

## Overview

Live and historical sports data from ESPN, MLB StatsAPI, and TheSportsDB. Check scores, schedules, and standings, and look up teams and players across the NFL, NBA, MLB, NHL, major soccer leagues, and college football and basketball.

### Tools

| Tool | Description |
|:-----|:------------|
| `sports_find_team` | Resolve a team name or partial name to canonical records and source IDs across providers. |
| `sports_find_player` | Resolve a player name to canonical TheSportsDB records with ID, team, position, and bio fields. |
| `sports_get_scores` | Live and final scores for a league on a given date, optionally filtered by team. |
| `sports_get_game` | Game metadata, period scores, team totals, provider top performers, and paged scoring plays. |
| `sports_get_schedule` | Upcoming and past fixtures for a team or league over a date range. |
| `sports_get_standings` | Current standings or league table for a league and season. |
| `sports_get_team` | Team detail combining metadata, roster, recent results, and upcoming fixtures. |
| `sports_get_player` | Player details from TheSportsDB — biography, team, position, and physical stats. |

### Agent skill

The [sports-guide](./skills/sports-guide/SKILL.md) covers complete fixture ranges, game recaps, standings comparisons, and player identity checks. It ships with plugin installs, npm, Docker, and the desktop bundle, and is available to MCP clients as a skill resource.

## Capability reference

### `sports_find_team` <sub>tool</sub>

- Free-text `query` (max 200 characters) with an optional `league` filter
- Returns team metadata with `espnId`/`mlbId`/`tsdbId` cross-references merged across providers; `totalFound` counts returned records
- Failed ESPN/MLB lookups appear in `unavailableSources`; no results returns `no_match`, or `sources_unavailable` if a source failed. The free TheSportsDB key can return incomplete results

---

### `sports_find_player` <sub>tool</sub>

- Free-text `query` (max 200 characters); optional `sport` is advisory and does not filter
- Returns player IDs, name, team, position, nationality, birth date, and thumbnail; `no_match` when none is found
- The default key `123` limits searches to one record

---

### `sports_get_scores` <sub>tool</sub>

- `league` required; `date` (YYYY-MM-DD) defaults to today in US Eastern time; optional `team_name` filters games
- Returns home/away teams, score, status, period or clock, and UTC start time. Empty results carry `reason`, `emptyReason` (`no_games` or `no_team_matches`), and `notice`
- `limit` defaults to 100 (max 200) and `offset` to 0; responses include `availableGames`, `totalReturned`, `effectiveLimit`, `offset`, `truncated`, and `nextOffset`

---

### `sports_get_schedule` <sub>tool</sub>

- `league` required; optional `team_name`, `date_from`/`date_to`, `limit` (default 100, max 200), and `offset` (default 0). A single date bound requests that day; reversed dates fail
- Returns home/away teams and scores, status, UTC start time, venue, and source. A partial `team_name` must identify one team: `ambiguous_team` lists candidates, `team_not_found` means no match
- Dated requests cover at most seven days. Responses include `requestedDateFrom`/`requestedDateTo`, `servedDateFrom`/`servedDateTo`, `availableGames`, `effectiveLimit`, `offset`, and `truncated`; follow `nextOffset`, then `nextDateFrom` as `date_from`

---

### `sports_get_game` <sub>tool</sub>

- Required `league` and source-prefixed numeric `game_id` from scores, schedules, or team detail; `mlb:` IDs require `league: "mlb"`
- Returns game metadata plus `periodScores`, `teamStats`, `leaders`, and `scoringPlays`; missing values are null. Scheduled games return metadata only; `game_not_found` for a missing or wrong-league game. Athlete IDs belong to ESPN or MLB, not TheSportsDB
- `limit` defaults to 20 (max 50) and `offset` to 0; responses include `totalCount`, `returnedCount`, `servedFrom`/`servedTo`, `effectiveLimit`, and `nextOffset`

---

### `sports_get_standings` <sub>tool</sub>

- `league` required; optional `season` (4-digit year), current season if omitted
- Returns rank, group (conference, table, or MLB division), wins, losses, ties, NHL overtime losses, points, winning percentage, division rank, streak, and games behind; inapplicable values are null. `season_not_found` when the season has no data
- `limit` defaults to 100 (max 200) and `offset` to 0; responses include `availableStandings`, `totalReturned`, `effectiveLimit`, `offset`, `truncated`, and `nextOffset`. If the MLB team lookup fails, `unavailableSources` lists `standings_team_metadata`

---

### `sports_get_team` <sub>tool</sub>

- `league` and `team_name` required; exact names or abbreviations win, otherwise a partial name must identify one team (`ambiguous_team` lists candidates, `team_not_found` means no match)
- Returns metadata, active roster, the latest 5 completed results, and the next 3 scheduled fixtures
- NFL rosters exclude injured-reserve/out, suspended, and practice-squad players; missing jerseys and venues are null

---

### `sports_get_player` <sub>tool</sub>

- `player_id` accepts a `tsdb:`-prefixed ID (from `sports_find_player`) or a raw numeric TheSportsDB ID
- Returns biography, team, position, nationality, birth date, height, weight, and thumbnail; `player_not_found` when the ID doesn't resolve
- `espnId` is filled when TheSportsDB supplies one, otherwise null

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

Sports-specific:

- Three keyless sources — ESPN site API, MLB StatsAPI, and TheSportsDB (free tier key `123`)
- League routing sends each query to the best source per sport
- Normalized output types across sources — `NormalizedGame`, `NormalizedTeam`, `NormalizedPlayer`, `NormalizedStanding`
- Cross-source team IDs merged onto one record by `sports_find_team`
- Off-season queries return a notice (standings) or `games: []` with a `reason` (scoreboards) instead of an error

Agent-friendly output:

- Source provenance on every record — `source: 'espn' | 'mlbstats' | 'thesportsdb'`
- Typed error reasons (`no_match`, `sources_unavailable`, `team_not_found`, `ambiguous_team`, `player_not_found`, `season_not_found`, `game_not_found`, `incompatible_game_source`), each with a recovery hint
- Typed empty-result notices and pagination or schedule-window metadata on every response
- Provider text is escaped and treated as data, never instructions

## Getting started

Add it to Claude Code:

```sh
claude mcp add sports-mcp-server -- npx -y @cyanheads/sports-mcp-server
```

For other clients, add this to the MCP config file:

```json
{
  "mcpServers": {
    "sports-mcp-server": {
      "command": "npx",
      "args": ["-y", "@cyanheads/sports-mcp-server"]
    }
  }
}
```

No API keys are required. `THESPORTSDB_API_KEY` optionally enables a premium key for broader player and team searches; the default free key returns at most one record. For Docker or a source build, see [Running the server](#running-the-server).

## Configuration

| Variable | Description | Default |
|:---------|:------------|:--------|
| `THESPORTSDB_API_KEY` | TheSportsDB API key. The free key limits searches to one record. | `123` |
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http`. | `stdio` |
| `MCP_HTTP_PORT` | Port for HTTP server. | `3010` |
| `MCP_SESSION_MODE` | HTTP session mode: `stateful`, `stateless`, or `auto`. | `stateless` |
| `MCP_AUTH_MODE` | Auth mode: `none`, `jwt`, or `oauth`. | `none` |
| `MCP_LOG_LEVEL` | Log level (RFC 5424). | `info` |
| `LOGS_DIR` | Directory for log files (Node.js only). | `<project-root>/logs` |
| `LOG_TOOL_FAILURE_PAYLOADS` | Log failed tool arguments and results, redacted by key name and capped by `LOG_TOOL_FAILURE_PAYLOAD_MAX_BYTES` (default `16384`). Free-form values are not redacted. | `false` |
| `OTEL_ENABLED` | Enable [OpenTelemetry instrumentation](https://github.com/cyanheads/mcp-ts-core/tree/main/docs/telemetry). | `false` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Base OTLP/HTTP URL for traces and metrics. | Unset |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | OTLP log endpoint. | Unset |

See [`.env.example`](./.env.example) for the full list of optional overrides.

## Running the server

### Local development

Requires [Bun v1.4.0](https://bun.sh/) or higher and Node.js v24+.

```sh
git clone https://github.com/cyanheads/sports-mcp-server.git
cd sports-mcp-server && bun install
cp .env.example .env
# All overrides are optional.
```

Serving commands execute Node, including when launched with `bun run`. Bun handles dependency resolution and build tooling; ESPN requests run under Node.

- **Build and run:**

  ```sh
  # One-time build
  bun run rebuild

  # Run the built server
  bun run start:stdio
  # or
  bun run start:http
  ```

- **Run checks and tests:**

  ```sh
  bun run devcheck   # Lint, format, typecheck, security
  bun run test       # Vitest test suite
  bun run lint:mcp   # Validate MCP definitions against spec
  ```

### Docker

```sh
docker run --rm -p 3010:3010 ghcr.io/cyanheads/sports-mcp-server:latest
```

The image builds with Bun, runs the production server under Node, defaults to HTTP transport and stateless session mode, and logs to `/var/log/sports-mcp-server`. For stdio, use `docker run -i --rm -e MCP_TRANSPORT_TYPE=stdio ghcr.io/cyanheads/sports-mcp-server:latest`. To build locally, use `docker build -t sports-mcp-server .`; OpenTelemetry peer dependencies are installed by default — build with `--build-arg OTEL_ENABLED=false` to omit them.

## Project structure

| Directory | Purpose |
|:----------|:--------|
| `src/index.ts` | `createApp()` entry point — registers tools and inits services. |
| `src/config` | Server-specific environment variable parsing (`THESPORTSDB_API_KEY`). |
| `src/services/types.ts` | Normalized cross-source types and league routing table. |
| `src/services/espn` | ESPN site API service — scores, schedules, standings, teams. |
| `src/services/mlb` | MLB StatsAPI service — scores, schedules, standings, rosters. |
| `src/services/thesportsdb` | TheSportsDB service — player and team search/metadata. |
| `src/mcp-server/tools` | Tool definitions (`*.tool.ts`). |
| `tests/` | Unit and integration tests mirroring `src/`. |
| `docs/` | Design doc and directory tree. |

## Development guide

See [`CLAUDE.md`/`AGENTS.md`](./CLAUDE.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for request-scoped logging, `ctx.state` for tenant-scoped storage
- Register new tools via the barrel in `src/mcp-server/tools/definitions/index.ts`
- Wrap external API calls: validate raw → normalize to domain type → return output schema; never fabricate missing fields

## Contributing

Issues are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
