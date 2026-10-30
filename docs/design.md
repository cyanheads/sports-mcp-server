# sports-mcp-server — Design

## MCP Surface

### Tools

Eight read-only tools are registered.

| Name | Description | Key Inputs | Annotations | Errors (reason → code, when) |
|:-----|:------------|:-----------|:------------|:-----------------------------|
| `sports_get_scores` | Live and final scores for a league (or optionally scoped to a team) on a given date. Returns each game with home/away teams, current score, status, period/clock, and UTC start time. Routes NFL/NBA/NHL/soccer → ESPN; MLB → StatsAPI. | `league` (enum), `date?` (YYYY-MM-DD), `team_name?`, `limit?`, `offset?` | `readOnlyHint: true`, `openWorldHint: true` | No games returns `games: []` with an informational `reason`; upstream failures retain HTTP classification |
| `sports_get_game` | Game metadata, period scores, team totals, provider top performers, and scoring-play pages. | `league`, `game_id` (espn: or mlb: numeric), `offset?`, `limit?` | `readOnlyHint: true`, `openWorldHint: true` | `game_not_found` → `NotFound`, explicit missing/wrong-league event; `incompatible_game_source` → `ValidationError`, MLB ID with another league |
| `sports_get_schedule` | Upcoming and past fixtures for a team or league. Dated requests acquire up to seven provider-calendar days, then page the games; no-bound ESPN team requests merge current-season phases and soccer fixtures. | `league` (enum), `team_name?`, `date_from?` (YYYY-MM-DD), `date_to?` (YYYY-MM-DD), `limit?`, `offset?` | `readOnlyHint: true`, `openWorldHint: true` | `team_not_found` → `NotFound`, when team_name resolves to no record; `ambiguous_team` → `ValidationError`, when several teams match |
| `sports_get_standings` | Current standings or league table for a league and season. Returns rank and group, W/L, NHL OTL, soccer/NHL points, division rank, streak, and games behind. | `league` (enum), `season?` (YYYY), `limit?`, `offset?` | `readOnlyHint: true`, `openWorldHint: true` | `season_not_found` → `NotFound`, when an explicit season is empty or cannot be verified from served metadata; omitted season returns empty standings with an off-season notice |
| `sports_find_team` | Resolve a team name or partial name to canonical records and merged ESPN/MLB/TheSportsDB IDs. Team-scoped tools also accept names directly. | `query`, `league?` | `readOnlyHint: true`, `openWorldHint: true` | `no_match` → `NotFound`, when every source succeeds without matches; `sources_unavailable` → `ServiceUnavailable`, when no matches survive an optional outage |
| `sports_get_team` | Team detail: active roster (or squad), latest 5 completed results, next 3 future scheduled fixtures, venue, and team metadata. Combines multiple source calls internally. | `league` (enum), `team_name` | `readOnlyHint: true`, `openWorldHint: true` | `team_not_found` → `NotFound`, when team_name resolves to no record; `ambiguous_team` → `ValidationError`, when several teams match |
| `sports_find_player` | Resolve a player name to their canonical record via TheSportsDB. Returns player ID, full name, current team, position, nationality, birth date, and thumbnail URL. Disambiguation step before player-scoped queries. | `query`, `sport?` | `readOnlyHint: true`, `openWorldHint: true` | `no_match` → `NotFound`, when no player matches the query |
| `sports_get_player` | Player detail: bio, current team, position, nationality, birth date, height/weight, career description, and media thumbnail (TheSportsDB). | `player_id` (tsdb: prefixed or raw numeric) | `readOnlyHint: true`, `openWorldHint: true` | `player_not_found` → `NotFound`, when TheSportsDB returns HTTP 200 with `{"players": "Invalid Player ID passed"}` — must detect this shape explicitly |

### Resources

`skill://sports-guide/SKILL.md` serves the agent guide for fixture completeness, game recaps, standings comparisons, and player identity checks. The SDK also registers the `skill://{+path}` resource template. Sports data remains tool-based because it is live and time-sensitive.

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
- All game start times returned as UTC strings in structured and formatted output
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
| MLB | `baseball/mlb` | ✓ (primary) | partial | StatsAPI for scores, schedules, standings, and team detail; ESPN contributes to team search |
| NHL | `hockey/nhl` | — | partial | ESPN primary |
| EPL (soccer) | `soccer/eng.1` | — | `133604` league | ESPN primary |
| MLS | `soccer/usa.1` | — | partial | ESPN primary |
| College football | `football/college-football` | — | — | FBS scoreboards (`groups=80`); team lookup uses ESPN's broader inventory |
| Other soccer (Liga, Bundesliga, etc.) | varies (`soccer/esp.1`, `soccer/ger.1`, …) | — | partial | ESPN; league slugs documented below |
| College basketball | `basketball/mens-college-basketball` | — | — | Men's Division I scoreboards (`groups=50`), complete team inventory |

**Soccer league slugs (verified working):**
- EPL: `eng.1`
- La Liga: `esp.1`
- Bundesliga: `ger.1`
- Serie A: `ita.1`
- Ligue 1: `fra.1`
- Champions League: `uefa.champions`
- MLS: `usa.1`

**TheSportsDB limitations:** free key `3` limits player and team searches to one record. Search notices state that results may be incomplete; `totalFound` counts returned records, and mixed team-search notices apply only to successful TheSportsDB contributions. Arbitrary configured keys are not assigned a guessed tier. Player bio (`strDescriptionEN`) and media (`strThumb`, `strFanart1`) remain metadata; live scores and standings use ESPN/MLB.

---

## Services

| Service | Wraps | Used By |
|:--------|:------|:--------|
| `EspnService` | ESPN site API (`site.api.espn.com`) | `sports_get_scores`, `sports_get_game`, `sports_get_schedule`, `sports_get_standings`, `sports_find_team`, `sports_get_team` |
| `MlbService` | MLB StatsAPI (`statsapi.mlb.com`) | `sports_get_scores` (MLB), `sports_get_game` (MLB), `sports_get_schedule` (MLB), `sports_get_standings` (MLB), `sports_get_team` (MLB), `sports_find_team` |
| `TheSportsDbService` | TheSportsDB (`thesportsdb.com/api/v1/json/3/`) | `sports_find_team`, `sports_find_player`, `sports_get_player` |

Each service owns its own HTTP fetch, error mapping, and retry config. Tools compose across services internally; the service boundary is invisible to agents.

Every fetch-and-parse operation has 10-second attempts and a 30-second retry budget, including backoff and honored `Retry-After` delays. Fast transient failures can make four attempts. The two inline MLB schedule fetches follow the same rule. This is a per-operation budget; a composite tool can make several operations. Caller cancellation interrupts both body reads and backoff.

ESPN and MLB use the framework's `fetchWithTimeout` and HTTP status classification. TheSportsDB uses native fetch with combined cancellation/deadline signals and a timer held through body consumption: its API key is a URL path segment, which the shared fetch helper logs. Its HTTP errors use `httpErrorFromResponse` with a logical service name and no URL, with the configured key scrubbed from bounded diagnostics. Raw native network-error text and causes are not retained because they can contain that URL.

The shared ESPN/MLB text reader holds an explicit attempt clock through body consumption, preserving timeout/cancellation classification when the framework captures an unfinished non-2xx body ([mcp-ts-core#604](https://github.com/cyanheads/mcp-ts-core/issues/604)).

Optional ESPN/MLB team-search sources and MLB standings abbreviation enrichment tolerate outages, disclosing bounded source/operation/reason/recovery entries in `unavailableSources` on both surfaces. Empty degraded searches return `sources_unavailable` instead of establishing a false `no_match`. They rethrow input-class rejections and cancellation, so an invalid request cannot become an apparently successful partial result.

---

## Config

| Env Var | Required | Description |
|:--------|:---------|:------------|
| `THESPORTSDB_API_KEY` | No | TheSportsDB API key. Defaults to `3`, whose team/player searches have a one-record limit. A premium key enables broader searches. |

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
  rank: number | null;
  group: string | null;
  team: { id: string; name: string; abbreviation: string };
  wins: number;
  losses: number;
  ties: number | null;
  overtimeLosses: number | null; // NHL
  points: number | null;         // soccer/NHL
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

### Game IDs resolve with an explicit league

Existing score, schedule, and team game IDs stay unchanged. `sports_get_game` requires their league because ESPN event IDs do not encode routing; cross-league probing adds latency and ambiguity. ESPN summaries supply metadata, period lines, team totals, nested game leaders, and scoring events from `scoringPlays`, scored `plays`, or soccer goal `keyEvents`. MLB uses the v1.1 live feed for inning lines, boxscore team totals and provider `topPerformers`, and scoring indexes into `allPlays`.

Played sections are empty for scheduled games: ESPN can supply season leaders and MLB pregame totals include aggregate rates. Full player boxscores and season statistics are outside this tool's scope. Missing values remain null; an unplayed MLB bottom inning is never synthesized as zero. Athlete names may be unavailable on provider scoring events. Explicit missing-event HTTP signatures map to `game_not_found`; unrelated rejections, outages, cancellation, and malformed success metadata keep their own error classification.

MLB boxscore team totals also contain cumulative rates during played games. Preserve the statistic keys and derive batting AVG/OBP/SLG/OPS and pitching ERA/WHIP from game counts, using outs for pitching arithmetic. OPS combines unrounded OBP and SLG. Missing operands or zero denominators produce null; faithful game counts and other game-scoped displays remain intact.

Only normalized scoring events are paged, with 20 events by default and a cap of 50. Metadata, period lines, totals, and leaders remain available on every page. Enrichment carries total/returned counts, zero-based served range, continuation, effective limit, and clipped-limit notices to both response surfaces. Each page refetches the summary/feed; changing live games are not an immutable snapshot.

### MLB routes to StatsAPI, everything else to ESPN

StatsAPI is the official MLB data source — it provides `gamePk`, detailed `linescore` with inning-by-inning runs/hits/errors, `decisions` (winning/losing pitcher), and a full roster endpoint. MLB scores, schedules, standings, and team detail use StatsAPI; `sports_find_team` also consults ESPN for cross-source IDs.

All other major leagues (NFL, NBA, NHL, soccer) have no comparable official free API with the depth ESPN provides. ESPN's site API is undocumented and unofficial but has been stable for years; it is isolated behind EspnService so any schema change is contained.

### TheSportsDB is metadata and player lookup only

The free tier (key `3`) does not provide live scores or complete standings. Its value is:
1. **Player search** — no other keyless source has multi-sport player search with bio, thumbnail, and cross-references
2. **Team cross-references** — `idESPN` field on team records enables matching TheSportsDB teams to ESPN IDs without a fuzzy name match
3. **Logo and media assets** — nonempty `strBadge` with legacy `strTeamBadge` fallback; `strThumb` for player thumbnails

Live event data from TheSportsDB (eventsday, eventslastleague) returns empty or unreliable results on the free tier — confirmed via live probe (0 events for EPL on 2026-06-04 despite active games).

### ESPN standings use `/apis/v2/` not `/apis/site/v2/`

Live-probed: `site.api.espn.com/apis/site/v2/sports/football/nfl/standings` returns `{"fullViewLink": ..., "children": []}` — the children array is empty. The correct path is `site.api.espn.com/apis/v2/sports/football/nfl/standings`, which returns `children` with `standings.entries` populated. Both the `site` path and the base path exist; the base path is canonical for standings.

Omit the type override because provider defaults expose soccer and college tables that `type=2` hides. Walk nested groups, preserving each ranking group's name. Explicit years must match root/group season metadata; missing metadata cannot justify relabeling returned current data. Overall stat identities take precedence over home/away/conference names; an explicit overall record supplies missing scalar totals.

Rank comes from an unsplit provider position (`rank`, otherwise `playoffSeed` in ESPN's default conference tables; MLB `divisionRank`). Invalid or missing positions remain null. Each group sorts ascending with stable ties and unranked rows last; array positions and wins never stand in for rank.

### `sports_find_team` returns cross-source IDs for disambiguation

`sports_find_team` merges known IDs (`espnId`, `mlbId`, `tsdbId`) and missing metadata for matching non-null provider IDs before matching display names. Existing populated metadata survives. These identify a record across providers. Team-scoped tools take `team_name` and resolve or filter it themselves; they do not accept these IDs as inputs.

Single-team tools prefer exact full display names and abbreviations, then require a unique partial name or location. Ambiguity returns canonical candidate names, abbreviations, and IDs; examples include "Mariners", "Seattle Seahawks", and "Manchester United". `sports_find_team` remains a multi-result search; score filters remain substring filters on the acquired slate.

### Source provenance in every output record

Every `NormalizedGame`, `NormalizedTeam`, and `NormalizedStanding` carries a `source` field (`'espn' | 'mlbstats' | 'thesportsdb'`). This lets agents and humans assess data freshness and authority without needing to know the routing logic. ESPN scores are unofficial aggregations; MLB StatsAPI is the authoritative official source; TheSportsDB is crowd-contributed metadata.

### HTTP status is authoritative; error text does not identify a bad league

Tool league enums reject unsupported slugs through the framework's `invalid_arguments` path. A supported ESPN league can also return HTTP 400 for a rejected scoreboard request; neither that status nor a message containing `400` proves an unknown league. Preserve 400 as `InvalidParams`, 422 as `ValidationError`, and 401/403/404 as their distinct codes. Scoreboard input rejections include recovery guidance to check supplied dates/bounds or omit them, without claiming ESPN identified a particular field. Transient statuses retry within the operation budget; 501 is non-retryable.

### Provider-calendar ranges remain authoritative

Schedule requests acquire at most seven provider-calendar days: one single-day scoreboard operation per ESPN day, or one inclusive MLB range. Single bounds mean one day. Provider membership remains authoritative, including games starting the next UTC day; a failed day fails the call rather than returning an apparently complete partial window. Omitted score dates use the US Eastern calendar day, including DST, without asserting that every provider uses that timezone.

Game pages default to 100 rows and cap at 200, with larger requests clamped and disclosed. Deduplicate IDs before sorting by provider day, UTC start, and ID. `availableGames` counts only the acquired window after team filtering, never the full requested range. `nextOffset` repeats the original bounds; `nextDateFrom` appears only after the final game page and retains the original requested end. Pages reacquire their window, so live results are not a snapshot.

No-bound league reads retain their provider default. ESPN no-bound team reads merge soccer results/fixtures or US sport phases using the provider season year (NBA can use the following year). Event and requested phase remain authoritative even when top-level phase metadata is stale. Recent results sort latest-first; scheduled upcoming fixtures sort earliest-first using the full start instant. MLB no-bound team schedules keep their 14-day history and 30-day lookahead; team summaries keep their 30-day history and lookahead.

### Scores and standings page the acquired league data

Scores and standings page the complete acquired slate after filtering and ordering, defaulting to 100 rows with a disclosed cap of 200. Each surface returns the available total, returned count, effective limit, offset, remaining-row flag and optional next offset. Past-end pages preserve the true total and carry an exhausted-page notice; empty-slate/filter and explicit-season semantics are decided before slicing. Standings pages retain group identity and source rank. Each request reacquires live provider data rather than creating a snapshot.

### Third-party text stays data

Inline provider fields (names, abbreviations, IDs, team/location/venue labels, dates, scores, streaks, URLs, and roster details) and echoed caller filters flatten CR/LF and escape HTML/inline Markdown in all eight formatters. Authored Markdown keeps its own line breaks. Player biographies are rendered in full inside a text fence longer than every embedded backtick run. Structured output remains verbatim. Server instructions explicitly identify provider content as data, never instructions; formatting does not attempt to prove or enforce model behavior.

---

## API Reference

### ESPN Site API (undocumented, keyless)

Base: `https://site.api.espn.com`

| Endpoint | Pattern | Live-verified |
|:---------|:--------|:-------------|
| Scoreboard | `GET /apis/site/v2/sports/{sport}/{league}/scoreboard[?dates=YYYYMMDD]`; basketball `groups=50`, football `groups=80` | NFL, NBA, NHL, soccer EPL/MLS; paired ranges are acquired one day at a time |
| Game summary | `GET /apis/site/v2/sports/{sport}/{league}/summary?event={eventId}` | Completed NFL/NBA/NHL/EPL and scheduled NFL; scoring sections vary by sport |
| Schedule (team) | `GET /apis/site/v2/sports/{sport}/{league}/teams/{teamId}/schedule[?season=YYYY&seasontype=N]`; soccer `fixture=true` | NFL, NBA, soccer; merged for no-bound team queries. Dated team queries use scoreboard membership |
| Teams list | `GET /apis/site/v2/sports/{sport}/{league}/teams`; college `limit=1000` | NFL and complete college inventories; scoreboard queries never reuse this limit |
| Team detail | `GET /apis/site/v2/sports/{sport}/{league}/teams/{teamId}` | ✓ NFL team 26 |
| Team roster | `GET /apis/site/v2/sports/{sport}/{league}/teams/{teamId}/roster` | Flat NBA/soccer athletes and grouped NFL/NHL items; positions come from each athlete, and explicitly inactive NFL groups are excluded |
| Standings | `GET /apis/v2/sports/{sport}/{league}/standings[?season=YYYY]` | Provider-default tables, including nested college groups |

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

Error shape varies: an HTTP 400 scoreboard response can be JSON such as `{"code":400,"message":"Failed to get events endpoint."}`. Bounded diagnostics retain the provider's response without inferring which parameter failed.

### MLB StatsAPI (official, keyless)

Base: `https://statsapi.mlb.com/api/v1`

| Endpoint | Pattern | Live-verified |
|:---------|:--------|:-------------|
| Schedule | `GET /schedule?sportId=1&hydrate=team,linescore,decisions` with `date=YYYY-MM-DD` or `startDate`/`endDate` | ✓ individual date and inclusive range |
| Game live feed | `GET https://statsapi.mlb.com/api/v1.1/game/{gamePk}/feed/live` | Completed and scheduled MLB; unplayed innings preserve omitted runs |
| Standings | `GET /standings?leagueId=103,104&season=YYYY&hydrate=division,league` | Historical division names hydrate within the existing standings request |
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
- `records[].division.name` — upstream ranking group; retain null if unavailable, never invent labels from IDs
- `records[].teamRecords[].team.name`, `.wins`, `.losses`, `.winningPercentage`, `.divisionRank`

### TheSportsDB (free tier, key `3`)

Base: `https://www.thesportsdb.com/api/v1/json/3`

| Endpoint | Pattern | Live-verified |
|:---------|:--------|:-------------|
| Team search | `GET /searchteams.php?t={name}` | Free key `3` has a one-record limit |
| Player search | `GET /searchplayers.php?p={name}` | ✓ Shohei Ohtani |
| Player lookup | `GET /lookupplayer.php?id={idPlayer}` | ✓ full bio |
| Team lookup | `GET /lookupteam.php?id={idTeam}` | ✓ includes `idESPN` cross-ref |
| Events by date | `GET /eventsday.php?d=YYYY-MM-DD&l={leagueId}` | ✗ returns empty on free tier |

Error shape: returns `{"players": "Invalid Player ID passed"}` (HTTP 200, success body with error string) for bad player IDs. Must check `typeof response.players === 'string'` to detect errors. Same pattern for teams: `{"teams": null}`.

TheSportsDB `idESPN` on team and player records supplies an ESPN cross-reference. Player normalization retains nonempty, nonzero values without name matching.

---

## Known Limitations

- **TheSportsDB free tier returns no live scores or standings.** `eventsday.php` reliably returns 0 events on the free tier even during active match days. Player and team metadata is the only reliable data from this source on key `3`.
- **ESPN is undocumented and unofficial.** Schema changes could break the service layer without warning. ESPN requests and normalization are isolated in `src/services/espn/`, including the game-summary normalizer.
- **College coverage is explicit.** Men's basketball scoreboards cover Division I; football scoreboards cover FBS. College team inventories can contain programs outside scoreboard scope; standings depth and roster data vary.
- **NHL standings: no `winPercent` stat.** NHL uses a points system (wins/OT losses/losses); the `winPercent` stat ESPN returns for NFL/NBA is absent from NHL standings entries. `NormalizedStanding.winningPercentage` will always be null for NHL; use `points` instead.
- **MLB StatsAPI division names can be null.** Hydrate division/league metadata for the requested season and preserve null when its name is unavailable.
- **Provider calendar dates can differ from UTC start dates.** Both output surfaces retain the provider's UTC start string. An MLB provider-applied date range retains late games even when their UTC start falls on the next day.
- **Historical coverage varies by provider.** ESPN date scoreboards include historical seasons, but deep-history availability is not guaranteed. TheSportsDB free tier does not supply scores; MLB StatsAPI covers historical MLB schedules back to 1871.
