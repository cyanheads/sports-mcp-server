---
name: sports-mcp-server
description: "Live sports scores, schedules, standings, teams, and players across major leagues via free sports APIs."
version: 0.0.0
status: idea
category: external-data
hosted: false
subdomain: ""
port: 0
tools: 0
resources: 0
prompts: 0
rating: unrated
stars: 0
open_issues: 0
auth: none
framework: mcp-ts-core
core_version: ""
npm: "@cyanheads/sports-mcp-server"
created: 2026-05-30
error_handling: unaudited
response_enrichment: unaudited
needs_migration: false
pattern: multi-source aggregation
complexity: medium
api-deps: ESPN site API (keyless) + MLB StatsAPI (official, keyless) + TheSportsDB (free)
api-cost: free (keyless ESPN + MLB StatsAPI; TheSportsDB free public tier)
hostable: true
composes-with: wikidata-mcp-server, wikipedia-mcp-server, gdelt-mcp-server
---

# sports-mcp-server

Live and historical sports — scores, schedules, standings, teams, and rosters across major leagues (NFL, NBA, MLB, NHL, soccer, and more) by aggregating free sports APIs into one workflow. Keyless.

**Sports is the single most-followed area of life with zero fleet coverage.** The design is workflow-first: the agent asks "what's the score?" or "when do they play next?" and the server routes to the best free source per league internally — ESPN's site API (broad, keyless), MLB's official StatsAPI (deep baseball), and TheSportsDB (free, multi-sport metadata). The agent never picks a source.

**Audience:** Sports fans, fantasy players, bettors (informational), journalists, casual askers, agents answering "did the Mariners win?", "NBA standings", or "when's the next Arsenal match?"

## User Goals

- Get live or final scores for a league or team
- See a team's or league's upcoming and past schedule
- Check current standings / league table
- Look up a team (roster, recent form, info)
- Find a team or player by name

## API Surface

Multi-source, unified by workflow. Each league routes to the best free source; the agent sees one sports surface.

| Source | Strength | Auth |
|:-------|:---------|:-----|
| ESPN site API (`site.api.espn.com`) | Broad coverage — NFL/NBA/NHL/soccer/college scoreboards, standings, teams | keyless (undocumented) |
| MLB StatsAPI (`statsapi.mlb.com`) | Deep, official baseball — schedule, standings, teams, live game data | keyless (official) |
| TheSportsDB (`thesportsdb.com`) | Multi-sport metadata, logos, team/player lookup, historical | free public tier |

Each source has its own league/team/event ID system — the service layer normalizes to a common shape (team, league, event, score, status) so tools return consistent records.

## Tool Surface (sketch)

```
sports_get_scores    — scores for a league (optionally a date or team): each game with
                       home/away teams, score, status (scheduled | in-progress | final),
                       period/clock, and start time. Routes NFL/NBA/NHL/soccer → ESPN,
                       MLB → StatsAPI. "Did the Mariners win?"

sports_get_schedule  — upcoming and past fixtures for a team or league over a date
                       range: opponent, home/away, date/time, venue, result if played.
                       "When does Arsenal play next?"

sports_get_standings — current standings / league table for a league (and season):
                       team, W-L (or pts), rank, division/conference, streak.

sports_find_team     — resolve a team name to its canonical record + source IDs across
                       providers. Returns team id(s), full name, league, logo, venue.
                       Disambiguation step before team-scoped queries.

sports_get_team      — team detail: roster/squad, recent results, next fixtures, venue,
                       and metadata. "Show me the Lakers' roster and last 5 games."

sports_find_player   — resolve a player name to their canonical record + source IDs via
                       TheSportsDB. Returns player id, full name, team, position, nationality,
                       thumbnail. Disambiguation step before player-scoped queries.

sports_get_player    — player detail: bio, current team, position, nationality, born date,
                       career thumbnail, and social handles (TheSportsDB). "Tell me about
                       Shohei Ohtani."
```

## Design Notes

- Medium complexity — not the APIs individually (each is simple) but the **multi-source normalization**: three providers with different league/team/event ID systems, different score/status shapes, and different coverage. The service layer maps each to a common model; tools never expose which source answered (though output carries provenance).
- **Route by league.** MLB → official StatsAPI (best baseball); NFL/NBA/NHL/soccer/college → ESPN; metadata/logos/lookup → TheSportsDB. Document the routing internally; the agent just names a league.
- ESPN's API is **undocumented/unofficial** — stable in practice but could change; isolate it behind the service layer and degrade gracefully (fall back to TheSportsDB) rather than hard-failing.
- **Live status is the value** — surface in-progress state (period, clock, possession) clearly, and timestamp it; a "score" without status is ambiguous.
- Time zones and season boundaries are recurring footguns — normalize game times to UTC + a local hint, and require/echo the season for standings.
- Composes with `wikidata`/`wikipedia` (team/player history, championships, bios), `gdelt` (news coverage around a big game or trade).
- Moonshot: a "follow my teams" workflow — given a set of teams, return today's scores, next fixtures, and standings deltas in one digest.
- README one-liner: "Scores, schedules, and standings across major leagues — one tool surface over free sports APIs."
