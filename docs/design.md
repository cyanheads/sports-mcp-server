# sports-mcp-server — Design

## MCP Surface

### Tools

| Name | Description | Key Inputs | Annotations | Errors (reason → code, when) |
|:-----|:------------|:-----------|:------------|:-----------------------------|
| `sports_get_scores` | Live and final scores for a league (or optionally scoped to a team) on a given date. Returns each game with home/away teams, current score, status (scheduled/in-progress/final), period/clock, and UTC start time. Routes NFL/NBA/NHL/soccer → ESPN; MLB → StatsAPI. | `league` (enum), `date?` (YYYY-MM-DD), `team_name?` | `readOnlyHint: true`, `openWorldHint: true` | `invalid_league` → `InvalidParams`, when league slug is not in the supported set; `no_games` → informational empty result (not an error — return `games: [], reason: '...'`) |
| `sports_get_schedule` | Upcoming and past fixtures for a team or league over a date range. Returns opponent, home/away flag, UTC date/time, venue, and result if the game is final. Date filtering is applied MCP-side after fetching the full season from ESPN. | `league` (enum), `team_name?`, `date_from?` (YYYY-MM-DD), `date_to?` (YYYY-MM-DD) | `readOnlyHint: true`, `openWorldHint: true` | `invalid_league` → `InvalidParams`; `team_not_found` → `NotFound`, when team_name resolves to no record |
| `sports_get_standings` | Current standings or league table for a league and season. Returns team rank, W/L (or points), division/conference, streak, and games behind/ahead. | `league` (enum), `season?` (YYYY) | `readOnlyHint: true`, `openWorldHint: true` | `invalid_league` → `InvalidParams`; `season_not_found` → `NotFound`, when the requested season has no standings data |
| `sports_find_team` | Resolve a team name or partial name to its canonical record and source IDs across providers. Returns full name, league, logo URL, venue, and ESPN/MLB/TheSportsDB IDs. Use this before any team-scoped query to get a valid `team_name`. | `query` | `readOnlyHint: true`, `openWorldHint: true` | `no_match` → `NotFound`, when no team matches the query |
| `sports_get_team` | Team detail: active roster (or squad), last 5 results, next 3 fixtures, venue, and team metadata. Combines multiple source calls internally. | `league` (enum), `team_name` | `readOnlyHint: true`, `openWorldHint: true` | `team_not_found` → `NotFound`, when team_name resolves to no record; `invalid_league` → `InvalidParams` |
| `sports_find_player` | Resolve a player name to their canonical record via TheSportsDB. Returns player ID, full name, current team, position, nationality, birth date, and thumbnail URL. Disambiguation step before player-scoped queries. | `query`, `sport?` | `readOnlyHint: true`, `openWorldHint: true` | `no_match` → `NotFound`, when no player matches the query |
| `sports_get_player` | Player detail: bio, current team, position, nationality, birth date, height/weight, career description, and media thumbnail (TheSportsDB). | `player_id` (tsdb: prefixed or raw numeric) | `readOnlyHint: true`, `openWorldHint: true` | `player_not_found` → `NotFound`, when TheSportsDB returns HTTP 200 with `{"players": "Invalid Player ID passed"}` — must detect this shape explicitly |

### Resources

None — all data is live and time-sensitive; a stable-URI resource model doesn't add value over the tool surface.

### Prompts

None — this is a pure data server with no recurring interaction templates that warrant structuring.

---

## Overview

`sports-mcp-server` provides live and historical sports data — scores, schedules, standings, teams, and players — across major professional and semi-professional leagues by aggregating three free, keyless APIs into one unified tool surface.

The server is organized around what an agent (or its human) is trying to accomplish: "did the Mariners win?", "NBA standings", "when does Arsenal play next?", "tell me about Shohei Ohtani". Tools route to the best source per sport internally; agents never choose or reference an underlying API.

**Target audience:** casual sports fans, fantasy players, sports journalists, agents embedded in general-purpose assistants.

**No credentials required** — all three upstream sources are either keyless (ESPN, MLB) or use a public test key that ships with the server (TheSportsDB key `3`).

---

## Requirements

- Live scores and game status (scheduled / in-progress with period and clock / final) for all covered leagues
- Schedule lookup by team or league, arbitrary date range
- Standings for all covered leagues — current season by default, historical by season parameter
- Team search (name → IDs) and team detail (roster, recent form, next fixtures)
- Player search (name → ID) and player detail (bio, metadata, thumbnail)
- No auth — keyless across all sources
- All game times normalized to UTC in output; human-readable local time in `format()` text
- Source provenance surfaced in output so agents can assess data origin
- Graceful degradation: when ESPN returns an empty scoreboard (off-season, no games that day), return an empty array with a `reason` field — not an error

---

## League Coverage

Coverage is per-source. The `league` input parameter is a constrained enum across all tools — valid values are exactly the keys in the routing table below. Input schema: `z.enum(['nfl','nba','mlb','nhl','epl','mls','laliga','bundesliga','seriea','ligue1','ucl','ncaaf','ncaab'])`.

Agents route by league; the service layer picks the source.

| League | ESPN slug | StatsAPI | TheSportsDB | Notes |
|:-------|:----------|:---------|:------------|:------|
| NFL | `football/nfl` | — | partial | ESPN primary; regular + postseason |
| NBA | `basketball/nba` | — | partial | ESPN primary; regular + playoffs |
| MLB | `baseball/mlb` | ✓ (primary) | partial | StatsAPI preferred; ESPN fallback for off-season scores |
| NHL | `hockey/nhl` | — | partial | ESPN primary |
| EPL (soccer) | `soccer/eng.1` | — | `133604` league | ESPN primary |
| MLS | `soccer/usa.1` | — | partial | ESPN primary |
| College football | `football/college-football` | — | — | ESPN only; standings limited |
| Other soccer (Liga, Bundesliga, etc.) | varies (`soccer/esp.1`, `soccer/ger.1`, …) | — | partial | ESPN; league slugs documented below |
| College basketball | `basketball/mens-college-basketball` | — | — | ESPN only; limited season |

**Soccer league slugs (verified working):**
- EPL: `eng.1`
- La Liga: `esp.1`
- Bundesliga: `ger.1`
- Serie A: `ita.1`
- Ligue 1: `fra.1`
- Champions League: `uefa.champions`
- MLS: `usa.1`

**TheSportsDB limitations:** free tier (key `3`) returns reduced data; player search returns `relevance` but no full stats. Player bio (`strDescriptionEN`) and media (`strThumb`, `strFanart1`) are reliable; live score and standings data is NOT available on the free tier. TheSportsDB is used exclusively for player/team lookup and metadata.

---

## Services

| Service | Wraps | Used By |
|:--------|:------|:--------|
| `EspnService` | ESPN site API (`site.api.espn.com`) | `sports_get_scores`, `sports_get_schedule`, `sports_get_standings`, `sports_find_team`, `sports_get_team` |
| `MlbService` | MLB StatsAPI (`statsapi.mlb.com`) | `sports_get_scores` (MLB), `sports_get_schedule` (MLB), `sports_get_standings` (MLB), `sports_get_team` (MLB) |
| `TheSportsDbService` | TheSportsDB (`thesportsdb.com/api/v1/json/3/`) | `sports_find_team`, `sports_find_player`, `sports_get_player` |

Each service owns its own HTTP fetch, error mapping, and retry config. Tools compose across services internally; the service boundary is invisible to agents.

---

## Config

| Env Var | Required | Description |
|:--------|:---------|:------------|
| `THESPORTSDB_API_KEY` | No | TheSportsDB API key. Defaults to `3` (free public test key). Replace with a paid key for higher rate limits and full data access. |

No other env vars required — ESPN and MLB StatsAPI are fully keyless.

---

## Implementation Order

1. **Config** — `src/config/server-config.ts` with `THESPORTSDB_API_KEY` (default `3`)
2. **Shared types** — `src/services/types.ts` — normalized `Game`, `Team`, `Player`, `Standing`, `LeagueRoute` types
3. **EspnService** — `src/services/espn/espn-service.ts` — scoreboard, schedule, standings, teams endpoints
4. **MlbService** — `src/services/mlb/mlb-service.ts` — schedule, standings, teams, roster endpoints
5. **TheSportsDbService** — `src/services/thesportsdb/thesportsdb-service.ts` — searchteams, searchplayers, lookupplayer, lookupteam endpoints
6. **`sports_find_team`** — simplest multi-source, good integration smoke test
7. **`sports_get_scores`** — highest value; route by league
8. **`sports_get_schedule`** — ESPN team schedule + MLB schedule
9. **`sports_get_standings`** — ESPN v2 standings + MLB standings
10. **`sports_get_team`** — composite: team detail + roster + recent/next games
11. **`sports_find_player`** — TheSportsDB player search
12. **`sports_get_player`** — TheSportsDB player lookup

Each step is independently testable before the next.

---

## Domain Mapping

### Normalized types (cross-source)

```ts
// Game — returned by get_scores and get_schedule
interface NormalizedGame {
  id: string;             // source-prefixed: 'espn:401872656' or 'mlb:823457'
  shortName: string;      // 'SEA @ NYY'
  homeTeam: { id: string; name: string; abbreviation: string; score: string | null };
  awayTeam: { id: string; name: string; abbreviation: string; score: string | null };
  status: 'scheduled' | 'in-progress' | 'final' | 'postponed' | 'cancelled';
  period: number | null;          // inning for MLB, quarter/period for others
  clock: string | null;           // '2:34' remaining or game clock display
  startTimeUtc: string;           // ISO 8601
  venue: string | null;
  source: 'espn' | 'mlbstats';
}

// Team
interface NormalizedTeam {
  id: string;             // 'espn:26' or 'mlb:136' or 'tsdb:133604'
  espnId: string | null;
  mlbId: number | null;
  tsdbId: string | null;
  name: string;
  abbreviation: string;
  location: string;
  displayName: string;
  league: string;
  logoUrl: string | null;
  venueId: string | null;
  venueName: string | null;
  source: 'espn' | 'mlbstats' | 'thesportsdb';
}

// Standing entry
interface NormalizedStanding {
  rank: number;
  team: { id: string; name: string; abbreviation: string };
  wins: number;
  losses: number;
  ties: number | null;
  points: number | null;         // soccer league table
  winningPercentage: string | null;
  divisionRank: string | null;
  streak: string | null;          // normalize: ESPN stats[name='streak'].displayValue ('W3'), MLB streak.streakCode ('L3')
  gamesBehind: string | null;
  source: 'espn' | 'mlbstats';
}

// Player
interface NormalizedPlayer {
  id: string;             // 'tsdb:34185573'
  tsdbId: string;
  espnId: string | null;
  name: string;
  team: string | null;
  position: string | null;
  nationality: string | null;
  birthDate: string | null;      // 'YYYY-MM-DD'
  height: string | null;
  weight: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  source: 'thesportsdb';
}
```

### League routing table (internal service logic)

```ts
const LEAGUE_ROUTES: Record<string, LeagueRoute> = {
  // NFL
  nfl: { espnSport: 'football', espnLeague: 'nfl', mlbLeagueId: null },
  // NBA
  nba: { espnSport: 'basketball', espnLeague: 'nba', mlbLeagueId: null },
  // MLB — StatsAPI primary
  mlb: { espnSport: 'baseball', espnLeague: 'mlb', mlbLeagueId: [103, 104] },
  // NHL
  nhl: { espnSport: 'hockey', espnLeague: 'nhl', mlbLeagueId: null },
  // Soccer
  epl: { espnSport: 'soccer', espnLeague: 'eng.1', mlbLeagueId: null },
  mls: { espnSport: 'soccer', espnLeague: 'usa.1', mlbLeagueId: null },
  laliga: { espnSport: 'soccer', espnLeague: 'esp.1', mlbLeagueId: null },
  bundesliga: { espnSport: 'soccer', espnLeague: 'ger.1', mlbLeagueId: null },
  seriea: { espnSport: 'soccer', espnLeague: 'ita.1', mlbLeagueId: null },
  ligue1: { espnSport: 'soccer', espnLeague: 'fra.1', mlbLeagueId: null },
  ucl: { espnSport: 'soccer', espnLeague: 'uefa.champions', mlbLeagueId: null },
  // College
  ncaaf: { espnSport: 'football', espnLeague: 'college-football', mlbLeagueId: null },
  ncaab: { espnSport: 'basketball', espnLeague: 'mens-college-basketball', mlbLeagueId: null },
};
```

---

## Design Decisions

### MLB routes to StatsAPI, everything else to ESPN

StatsAPI is the official MLB data source — it provides `gamePk`, detailed `linescore` with inning-by-inning runs/hits/errors, `decisions` (winning/losing pitcher), and a full roster endpoint. ESPN covers MLB but with shallower detail. For any MLB query, MlbService is primary and ESPN is fallback only if StatsAPI is unreachable.

All other major leagues (NFL, NBA, NHL, soccer) have no comparable official free API with the depth ESPN provides. ESPN's site API is undocumented and unofficial but has been stable for years; it is isolated behind EspnService so any schema change is contained.

### TheSportsDB is metadata and player lookup only

The free tier (key `3`) does not provide live scores or complete standings. Its value is:
1. **Player search** — no other keyless source has multi-sport player search with bio, thumbnail, and cross-references
2. **Team cross-references** — `idESPN` field on team records enables matching TheSportsDB teams to ESPN IDs without a fuzzy name match
3. **Logo and media assets** — `strTeamBadge`, `strThumb` for player thumbnails

Live event data from TheSportsDB (eventsday, eventslastleague) returns empty or unreliable results on the free tier — confirmed via live probe (0 events for EPL on 2026-06-04 despite active games).

### ESPN standings use `/apis/v2/` not `/apis/site/v2/`

Live-probed: `site.api.espn.com/apis/site/v2/sports/football/nfl/standings` returns `{"fullViewLink": ..., "children": []}` — the children array is empty. The correct path is `site.api.espn.com/apis/v2/sports/football/nfl/standings`, which returns `children` with `standings.entries` populated. Both the `site` path and the base path exist; the base path is canonical for standings.

### `sports_find_team` returns cross-source IDs to enable seamless routing

A client calling `sports_get_scores` for team "Mariners" needs the server to resolve the name to an MLB team ID (136) or ESPN team ID. Rather than fuzzy-matching every time, `sports_find_team` surfaces all known IDs (`espnId`, `mlbId`, `tsdbId`) so downstream tools can pass the canonical `team_name` string that service methods accept without re-resolving.

The `team_name` parameter across tools accepts a fuzzy display name (e.g. "Mariners", "Seattle Seahawks", "Man United") — the service layer normalizes to the provider's ID internally. Agents can either call `sports_find_team` first for disambiguation or pass a name directly.

### Source provenance in every output record

Every `NormalizedGame`, `NormalizedTeam`, and `NormalizedStanding` carries a `source` field (`'espn' | 'mlbstats' | 'thesportsdb'`). This lets agents and humans assess data freshness and authority without needing to know the routing logic. ESPN scores are unofficial aggregations; MLB StatsAPI is the authoritative official source; TheSportsDB is crowd-contributed metadata.

### ESPN 400 on bad league slug, not 404

Live-probed: `site.api.espn.com/apis/site/v2/sports/football/BADLEAGUE/scoreboard` returns HTTP 400 (not 404). Error handler must treat `400` responses as `ValidationError` on the user's league input (unknown league), not as `ServiceUnavailable`.

---

## API Reference

### ESPN Site API (undocumented, keyless)

Base: `https://site.api.espn.com`

| Endpoint | Pattern | Live-verified |
|:---------|:--------|:-------------|
| Scoreboard | `GET /apis/site/v2/sports/{sport}/{league}/scoreboard[?dates=YYYYMMDD]` | ✓ NFL, NBA, NHL, soccer EPL/MLS |
| Schedule (team) | `GET /apis/site/v2/sports/{sport}/{league}/teams/{teamId}/schedule[?season=YYYY]` | ✓ NFL team 26, NBA team 16 — returns full season; `date_from`/`date_to` filtering is MCP-side |
| Teams list | `GET /apis/site/v2/sports/{sport}/{league}/teams` | ✓ NFL (32 teams) |
| Team detail | `GET /apis/site/v2/sports/{sport}/{league}/teams/{teamId}` | ✓ NFL team 26 |
| Team roster | `GET /apis/site/v2/sports/{sport}/{league}/teams/{teamId}/roster` | ✓ NFL team 26 (grouped by position: `athletes[].position`, `athletes[].items[]`) |
| Standings | `GET /apis/v2/sports/{sport}/{league}/standings[?season=YYYY&type=2]` | ✓ NFL, soccer EPL |

Response shape (scoreboard):
- `events[].shortName` — `"SEA @ NYY"` format
- `events[].competitions[].competitors[]` — `homeAway`, `score`, `winner` bool, `team.displayName`
- `events[].status.type.state` — `"pre"` / `"in"` / `"post"`
- `events[].status.type.name` — `"STATUS_SCHEDULED"` / `"STATUS_IN_PROGRESS"` / `"STATUS_FULL_TIME"` etc.
- `events[].status.period` — game period/quarter/inning (0 when pre-game)
- `events[].status.displayClock` — `"2:34"` or `"90'+6'"`

Teams response:
- `sports[0].leagues[0].teams[].team` — `id`, `displayName`, `abbreviation`, `location`, `logos[]`

Standings response:
- `children[].standings.entries[].team` — `displayName`, `abbreviation`
- `children[].standings.entries[].stats[]` — name/value pairs: `wins`, `losses`, `winPercent` (NFL/NBA; absent in NHL which uses `points`), `points` (NHL/soccer), `playoffSeed`, `streak` (NBA/NHL; absent in NFL), `gamesBehind` — stat set varies by sport

Error shape: HTTP 400 on invalid league slug. Response body is HTML or empty.

### MLB StatsAPI (official, keyless)

Base: `https://statsapi.mlb.com/api/v1`

| Endpoint | Pattern | Live-verified |
|:---------|:--------|:-------------|
| Schedule | `GET /schedule?sportId=1&hydrate=team,linescore,decisions[&date=YYYY-MM-DD]` | ✓ 9 games 2026-06-04 |
| Standings | `GET /standings?leagueId=103,104&season=YYYY` | ✓ 6 division records |
| Teams | `GET /teams?sportId=1&season=YYYY` | ✓ 30 teams |
| Roster | `GET /teams/{teamId}/roster?season=YYYY&rosterType=active` | ✓ 26-man roster |

Schedule response:
- `dates[].games[].gamePk` — primary game ID
- `dates[].games[].status.abstractGameState` — `"Preview"` / `"Live"` / `"Final"`
- `dates[].games[].status.detailedState` — `"Scheduled"` / `"In Progress"` / `"Final"` etc.
- `dates[].games[].teams.home.score` / `.away.score` — integer scores
- `dates[].games[].linescore.currentInning` — current inning (1-based)
- `dates[].games[].linescore.inningHalf` — `"Top"` / `"Bottom"`

Standings response:
- `records[].division.nameShort` (may be null) — use `division.id` as fallback
- `records[].teamRecords[].team.name`, `.wins`, `.losses`, `.winningPercentage`, `.divisionRank`

### TheSportsDB (free tier, key `3`)

Base: `https://www.thesportsdb.com/api/v1/json/3`

| Endpoint | Pattern | Live-verified |
|:---------|:--------|:-------------|
| Team search | `GET /searchteams.php?t={name}` | ✓ 10 results for "Arsenal" |
| Player search | `GET /searchplayers.php?p={name}` | ✓ Shohei Ohtani |
| Player lookup | `GET /lookupplayer.php?id={idPlayer}` | ✓ full bio |
| Team lookup | `GET /lookupteam.php?id={idTeam}` | ✓ includes `idESPN` cross-ref |
| Events by date | `GET /eventsday.php?d=YYYY-MM-DD&l={leagueId}` | ✗ returns empty on free tier |

Error shape: returns `{"players": "Invalid Player ID passed"}` (HTTP 200, success body with error string) for bad player IDs. Must check `typeof response.players === 'string'` to detect errors. Same pattern for teams: `{"teams": null}`.

TheSportsDB `idESPN` on team records cross-references to the ESPN team ID — useful for matching across sources.

---

## Known Limitations

- **TheSportsDB free tier returns no live scores or standings.** `eventsday.php` reliably returns 0 events on the free tier even during active match days. Player and team metadata is the only reliable data from this source on key `3`.
- **ESPN is undocumented and unofficial.** Schema changes could break the service layer without warning. EspnService is isolated with explicit normalization so any shape change is contained to one file.
- **ESPN college data is limited.** Scoreboard works (99 events live-verified), but standings depth and team roster data vary by conference and season.
- **NHL standings: no `winPercent` stat.** NHL uses a points system (wins/OT losses/losses); the `winPercent` stat ESPN returns for NFL/NBA is absent from NHL standings entries. `NormalizedStanding.winningPercentage` will always be null for NHL; use `points` instead.
- **MLB StatsAPI division names can be null.** `records[].division.nameShort` was null in a live probe of the 2026 standings — use `division.id` to map to division names from the teams endpoint.
- **Time zone normalization requires care.** ESPN returns times in ISO 8601 UTC (`2026-06-06T00:30Z`). MLB returns `gameDate` in UTC ISO 8601 as well. `format()` should localize to a readable form using the venue's timezone hint when available.
- **No historical scores beyond ESPN's window.** ESPN's scoreboard only covers the current season's games accessible via date parameter. For deep historical data, neither ESPN nor TheSportsDB free tier is sufficient; MLB StatsAPI covers historical MLB schedules back to 1871.
