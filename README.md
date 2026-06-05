<div align="center">
  <h1>@cyanheads/sports-mcp-server</h1>
  <p><b>Get live scores, schedules, standings, team and player data for NFL, NBA, MLB, NHL, soccer, and more via MCP. STDIO or Streamable HTTP.</b>
  <div>7 Tools</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.1.0-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/sports-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^1.29.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/sports-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/sports-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^6.0.3-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.3.11-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/sports-mcp-server/releases/latest/download/sports-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=sports-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvc3BvcnRzLW1jcC1zZXJ2ZXIiXX0=) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22sports-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fsports-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

---

## Tools

Seven tools organized around what an agent needs — find a team or player, get today's scores, check the schedule, read the standings, or pull full team or player detail:

| Tool | Description |
|:-----|:------------|
| `sports_find_team` | Resolve a team name or partial name to its canonical record and source IDs. Use before any team-scoped query. |
| `sports_find_player` | Resolve a player name to their canonical record via TheSportsDB. Disambiguation step before player-scoped queries. |
| `sports_get_scores` | Live and final scores for a league on a given date, optionally scoped to a specific team. |
| `sports_get_schedule` | Upcoming and past fixtures for a team or league over a date range. |
| `sports_get_standings` | Current standings or league table for a league and season. |
| `sports_get_team` | Team detail: active roster, last 5 results, next 3 fixtures, venue, and metadata. |
| `sports_get_player` | Player detail: bio, current team, position, nationality, birth date, height/weight, and thumbnail. |

### `sports_find_team`

Resolve a fuzzy team name to its canonical record across ESPN, MLB StatsAPI, and TheSportsDB.

- Returns full name, league, logo URL, venue, and ESPN/MLB/TheSportsDB cross-reference IDs
- Use before `sports_get_scores`, `sports_get_schedule`, `sports_get_standings`, or `sports_get_team` to get a valid `team_name`
- Fuzzy match on display name, abbreviation, or location (e.g. "Mariners", "SEA", "Seattle Seahawks")

---

### `sports_find_player`

Resolve a player name to their canonical record.

- Multi-sport player search via TheSportsDB
- Optional `sport` filter to narrow ambiguous names (e.g. "Michael Jordan")
- Returns player ID, full name, current team, position, nationality, birth date, and thumbnail URL
- Use the returned `player_id` with `sports_get_player` for full bio detail

---

### `sports_get_scores`

Live and final scores for a league on a given date.

- Routes NFL/NBA/NHL/soccer → ESPN; MLB → MLB StatsAPI (more authoritative)
- Returns home/away teams, current score, status (`scheduled`/`in-progress`/`final`), period/clock, and UTC start time
- Omit `date` for today's games; use `team_name` to filter to one team's game
- Returns `games: [], reason: '...'` (not an error) when no games are scheduled

---

### `sports_get_schedule`

Upcoming and past fixtures for a team or league over a date range.

- Fetches full season from ESPN and applies `date_from`/`date_to` filtering server-side
- Returns opponent, home/away flag, UTC date/time, venue, and result for completed games
- Omit `team_name` for the full league calendar; provide it for a single team's fixtures

---

### `sports_get_standings`

Current standings or league table for a league and season.

- Returns rank, W/L (or points for soccer/NHL), division/conference, streak, and games behind
- Omit `season` for the current season; pass a YYYY year for historical standings
- NHL uses points system (`wins`/`otLosses`/`losses`); soccer returns `points` for the league table

---

### `sports_get_team`

Composite team detail combining multiple source calls.

- Active roster (or squad), last 5 results, next 3 fixtures, venue, and team metadata
- MLB teams use MLB StatsAPI for roster and schedule; all others use ESPN

---

### `sports_get_player`

Full player profile from TheSportsDB.

- Bio, current team, position, nationality, birth date, height/weight, career description
- Media thumbnail URL for display
- Accepts `tsdb:`-prefixed IDs (from `sports_find_player`) or raw numeric TheSportsDB IDs

---

## Features

Built on [`@cyanheads/mcp-ts-core`](https://www.npmjs.com/package/@cyanheads/mcp-ts-core):

- Declarative tool definitions — single file per tool, framework handles registration and validation
- Unified error handling — handlers throw, framework catches, classifies, and formats
- Pluggable auth: `none`, `jwt`, `oauth`
- Swappable storage backends: `in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`
- Structured logging with optional OpenTelemetry tracing
- STDIO and Streamable HTTP transports

Sports-specific:

- Three keyless sources — ESPN site API, MLB StatsAPI, TheSportsDB (free tier key `3`) — no API credentials required
- League routing table internally routes each query to the best source per sport; agents never reference an upstream API
- Normalized output types across all sources — `NormalizedGame`, `NormalizedTeam`, `NormalizedPlayer`, `NormalizedStanding` — with source provenance on every record
- Graceful degradation — empty scoreboards (off-season, no games) return `games: []` with a `reason` string, not an error

Agent-friendly output:

- Source provenance on every record — `source: 'espn' | 'mlbstats' | 'thesportsdb'` so agents can reason about data authority
- Structured `reason` field on empty score responses so agents can explain the result to users
- Cross-source IDs surfaced by `sports_find_team` — `espnId`, `mlbId`, `tsdbId` — for seamless downstream routing without re-resolving names

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

- [Bun v1.3.0](https://bun.sh/) or higher (or Node.js v24+).
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
| `THESPORTSDB_API_KEY` | TheSportsDB API key. Replace with a paid key for higher rate limits. | `3` |
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http`. | `stdio` |
| `MCP_HTTP_PORT` | Port for HTTP server. | `3010` |
| `MCP_AUTH_MODE` | Auth mode: `none`, `jwt`, or `oauth`. | `none` |
| `MCP_LOG_LEVEL` | Log level (RFC 5424). | `info` |
| `LOGS_DIR` | Directory for log files (Node.js only). | `<project-root>/logs` |
| `OTEL_ENABLED` | Enable [OpenTelemetry instrumentation](https://github.com/cyanheads/mcp-ts-core/tree/main/docs/telemetry). | `false` |

See [`.env.example`](./.env.example) for the full list of optional overrides.

## Running the server

### Local development

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

The Dockerfile defaults to HTTP transport, stateless session mode, and logs to `/var/log/sports-mcp-server`. OpenTelemetry peer dependencies are installed by default — build with `--build-arg OTEL_ENABLED=false` to omit them.

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

Issues and pull requests are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
