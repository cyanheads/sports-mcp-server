<div align="center">
  <h1>@cyanheads/sports-mcp-server</h1>
  <p><b>Get live scores, schedules, standings, team and player data for NFL, NBA, MLB, NHL, soccer, and more via MCP. STDIO or Streamable HTTP.</b>
  <div>8 Tools</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.4.0-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/sports-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.3.1-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/sports-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/sports-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.3%2B-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/sports-mcp-server/releases/latest/download/sports-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=sports-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvc3BvcnRzLW1jcC1zZXJ2ZXIiXX0=) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22sports-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fsports-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

---

## Overview

Live and historical sports data from ESPN, MLB StatsAPI, and TheSportsDB. Look up teams and players, check scores, schedules, and standings across NFL, NBA, MLB, NHL, and major soccer leagues from any MCP client. College basketball covers men's Division I; college football scoreboards cover FBS, while team lookup uses ESPN's broader inventory. Runs as a stdio process or a local Streamable HTTP server.

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

## Capability reference

### `sports_find_team` <sub>tool</sub>

- Free-text `query` (max 200 characters) with an optional `league` filter
- Returns team metadata and merged `espnId`/`mlbId`/`tsdbId` cross-references; `no_match` when no provider finds a team
- `totalFound` counts returned records after deduplication. Free-key TheSportsDB contributions include a notice that search results may be incomplete; the limit does not apply to ESPN or MLB contributions

---

### `sports_find_player` <sub>tool</sub>

- Free-text `query` (max 200 characters); optional `sport` is advisory and does not filter matches
- Returns player IDs, name, team, position, nationality, birth date, and thumbnail; `no_match` when TheSportsDB finds no player
- `totalFound` counts returned records. The default key `3` has a one-record search limit; a notice recommends a fuller name or premium key without claiming every single match was truncated

---

### `sports_get_scores` <sub>tool</sub>

- `league` required; `date` (YYYY-MM-DD) defaults to today's US Eastern calendar day, including daylight saving time; optional `team_name` filters games
- Returns home/away teams, score, status, period or clock, and UTC start time. Empty results retain `reason` and add typed `emptyReason` (`no_games` or `no_team_matches`) and `notice` on both response surfaces

---

### `sports_get_schedule` <sub>tool</sub>

- `league` required; optional `team_name`, inclusive provider-calendar `date_from`/`date_to`, `limit` (default 100, capped at 200), and nonnegative `offset` (default 0). A single date bound requests that day; impossible or reversed dates fail before fetching
- Returns home/away teams and scores, status, UTC start time, venue, and source. Exact full names and abbreviations take precedence; partial selectors must identify one team. `ambiguous_team` lists canonical candidates; `team_not_found` means no match
- Dated requests acquire at most seven days, preserving provider membership across UTC midnight. Both surfaces disclose `requestedDateFrom`/`requestedDateTo`, `servedDateFrom`/`servedDateTo`, `availableGames` in that served window, `effectiveLimit`, `offset`, and `truncated`
- Follow `nextOffset` with the original bounds until the final game page. Only then use `nextDateFrom` as `date_from`, retaining `requestedDateTo` as `date_to`. Each page reacquires the served window; live data can change between calls
- Without dates, league reads keep the provider default; ESPN team reads merge the current provider season's phases and soccer results/fixtures. MLB team reads span 14 days back to 30 ahead. These returned slates also support game pagination

---

### `sports_get_game` <sub>tool</sub>

- Required `league` and source-prefixed numeric `game_id` from scores, schedules, or team detail. ESPN IDs use the supplied league; `mlb:` IDs require `league: "mlb"`
- Returns established game metadata plus `periodScores`, `teamStats`, `leaders`, and `scoringPlays`. Provider statistic names, labels, and display values are preserved; missing values remain null, including unplayed innings. Athlete IDs in game detail belong to ESPN or MLB and are not TheSportsDB player-lookup IDs
- `offset` defaults to 0; `limit` defaults to 20 and caps at 50, with larger limits clipped and disclosed. Both response surfaces expose `totalCount`, `returnedCount`, zero-based `servedFrom`/`servedTo`, `effectiveLimit`, and `nextOffset`. Continue with the same league and game ID. Pages reacquire the game; live events can change between calls
- Scheduled games return metadata and empty played-stat sections; no season leaders, full player boxscores, or raw play-by-play. Missing/wrong-league events return `game_not_found`; provider outages and malformed responses retain provider failures

---

### `sports_get_standings` <sub>tool</sub>

- `league` required; optional `season` (4-digit year) — omit for the current season
- Returns rank and its upstream group (conference, table, or MLB division), wins, losses, ties, NHL overtime losses, soccer/NHL points, winning percentage, division rank, streak, and games behind. Missing or inapplicable group/OTL values remain null; numeric zero is preserved
- ESPN uses the provider's default table. An explicit season must match served root/group season metadata; missing or mismatched metadata and empty explicit seasons return `season_not_found`. Omitted seasons retain `season: null`, with the existing notice when genuinely empty

---

### `sports_get_team` <sub>tool</sub>

- `league` and `team_name` required; exact full names or abbreviations take precedence, otherwise partial names or locations must identify one team (`ambiguous_team` includes candidates)
- Returns metadata, active roster, the latest 5 completed results, and the next 3 scheduled fixtures by start instant; `team_not_found` when the team doesn't resolve in the league. ESPN merges current-season phases and soccer fixtures; MLB uses a 30-day history and lookahead
- ESPN accepts flat and grouped rosters, uses athlete positions, and excludes NFL injured-reserve/out, suspended, and practice-squad groups. Supplied franchise venue metadata is retained; missing jerseys and venues remain null

---

### `sports_get_player` <sub>tool</sub>

- `player_id` accepts a `tsdb:`-prefixed ID (from `sports_find_player`) or a raw numeric TheSportsDB ID
- Returns biography, team, position, nationality, birth date, height, weight, and thumbnail; `player_not_found` when the ID doesn't resolve
- Supplied nonempty, nonzero TheSportsDB ESPN cross-references populate `espnId`; missing IDs remain null

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

Sports-specific:

- Three keyless sources — ESPN site API, MLB StatsAPI, and TheSportsDB (free tier key `3`) — no required API credentials
- Internal league routing table sends each query to the best source per sport; callers never reference an upstream API directly
- Normalized output types across all sources — `NormalizedGame`, `NormalizedTeam`, `NormalizedPlayer`, `NormalizedStanding` — with source provenance on every record
- Cross-source team IDs merged onto one canonical record by `sports_find_team`, deduplicated by display name
- Graceful off-season handling — empty standings return an enrichment notice rather than an error; empty scoreboards return `games: []` with a `reason` string
- Upstream operations use 10-second attempts and a 30-second total retry budget, including body reads and backoff, with up to four attempts for fast transient failures. Composite tools can make several such operations

Agent-friendly output:

- Source provenance on every record — `source: 'espn' | 'mlbstats' | 'thesportsdb'` — so agents can reason about data authority
- Typed empty-score notices alongside the compatible `reason` field, plus schedule window and continuation metadata on both response surfaces
- Cross-source IDs surfaced by `sports_find_team` — `espnId`, `mlbId`, `tsdbId` — identify the same team across providers; team-scoped tools resolve `team_name` independently
- Typed error reasons (`no_match`, `team_not_found`, `ambiguous_team`, `player_not_found`, `season_not_found`, `game_not_found`, `incompatible_game_source`) each carrying an actionable recovery hint
- Upstream HTTP errors retain their status and bounded diagnostics; ESPN scoreboard input rejections include date/bounds guidance. Optional-source outages degrade gracefully, while input rejections and cancellation propagate
- Formatted provider fields stay on their authored lines, and full player biographies appear in text fences; structured values remain verbatim. Provider content is data, never instructions

## Getting started

Add the following to your MCP client configuration file.

```json
{
  "mcpServers": {
    "sports": {
      "type": "stdio",
      "command": "bunx",
      "args": ["@cyanheads/sports-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with npx (no Bun required):

```json
{
  "mcpServers": {
    "sports": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cyanheads/sports-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with Docker:

```json
{
  "mcpServers": {
    "sports": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "MCP_TRANSPORT_TYPE=stdio",
        "ghcr.io/cyanheads/sports-mcp-server:latest"
      ]
    }
  }
}
```

For Streamable HTTP, set the transport and start the server:

```sh
MCP_TRANSPORT_TYPE=http MCP_HTTP_PORT=3010 bun run start:http
# Server listens at http://localhost:3010/mcp
```

### Prerequisites

- [Bun v1.4.0](https://bun.sh/) or higher (or Node.js v24+).
- No API keys required — ESPN and MLB StatsAPI are fully keyless; TheSportsDB ships with a free public test key (`3`).

### Installation

1. **Clone the repository:**

```sh
git clone https://github.com/cyanheads/sports-mcp-server.git
```

2. **Navigate into the directory:**

```sh
cd sports-mcp-server
```

3. **Install dependencies:**

```sh
bun install
```

4. **Configure environment:**

```sh
cp .env.example .env
# edit .env to override defaults (all optional)
```

## Configuration

| Variable | Description | Default |
|:---------|:------------|:--------|
| `THESPORTSDB_API_KEY` | TheSportsDB API key. The default free key limits team/player searches to one record; use a premium key for broader searches. | `3` |
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http`. | `stdio` |
| `MCP_HTTP_PORT` | Port for HTTP server. | `3010` |
| `MCP_SESSION_MODE` | HTTP session mode: `stateful`, `stateless`, or `auto` (resolves to stateful). The server declares `stateless` in source; an explicit value here overrides it. | `stateless` |
| `MCP_AUTH_MODE` | Auth mode: `none`, `jwt`, or `oauth`. | `none` |
| `MCP_LOG_LEVEL` | Log level (RFC 5424). | `info` |
| `LOGS_DIR` | Directory for log files (Node.js only). | `<project-root>/logs` |
| `LOG_TOOL_FAILURE_PAYLOADS` | Log failed tool arguments and results, redacted by key name and capped by `LOG_TOOL_FAILURE_PAYLOAD_MAX_BYTES` (default `16384`). Free-form values are not redacted. | `false` |
| `OTEL_ENABLED` | Enable [OpenTelemetry instrumentation](https://github.com/cyanheads/mcp-ts-core/tree/main/docs/telemetry). | `false` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Base OTLP/HTTP URL for traces and metrics. Signal-specific endpoints override it. | Unset |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | Explicit OTLP log endpoint; the base endpoint does not enable log export. | Unset |

See [`.env.example`](./.env.example) for the full list of optional overrides.

## Running the server

### Local development

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
docker build -t sports-mcp-server .
docker run --rm -p 3010:3010 sports-mcp-server
```

The Dockerfile builds with Bun, runs the production server under Node, defaults to HTTP transport and stateless session mode, and logs to `/var/log/sports-mcp-server`. OpenTelemetry peer dependencies are installed by default — build with `--build-arg OTEL_ENABLED=false` to omit them.

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
