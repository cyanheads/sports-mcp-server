---
name: sports-guide
description: Use with sports_* tools for complete fixture ranges, game recaps, standings comparisons, or following a game performer to a player biography. Resolve provider identities and check coverage before concluding that a team, player, or game is absent.
license: Apache-2.0
metadata:
  author: "cyanheads"
  version: "1.0"
---

## Scope

Use this server for league events, team context, standings, and player biographies. It requires no credentials by default. Full player boxscores and player season statistics are outside its scope; a biography lookup does not supply them.

## Identifiers

Team IDs returned by `sports_find_team` are cross-provider references, not selectors for team detail or schedules. Carry the canonical team name into those calls.

Game performers carry ESPN or MLB athlete IDs. These are not player-lookup IDs: use the athlete's name with `sports_find_player`, check the returned identity, then follow its TheSportsDB ID to `sports_get_player`.

## Gates

- Before choosing a player, compare the returned name, team, position, and other available identity clues with the intended athlete. The sport hint does not filter matches. A single free-key search result does not prove uniqueness; the known free key limits search to one record.
- Before reporting search coverage, read completeness notices and `unavailableSources`. Returned match counts are not provider-wide totals. An unavailable source cannot establish that a team is absent.
- Before reporting no games, check the acquired date window, team filter, and coverage. College team inventory is broader than college scoreboard coverage; finding a program does not establish that its games are covered.
- Before calling a fixture range complete, exhaust both game pages and date-window continuation. `availableGames` counts the acquired window after filtering, not every requested date. An empty window can still have a later window to acquire.
- Keep provider-calendar membership when displaying UTC start times in the user's timezone. A game's UTC start can fall on the next day without putting it outside the requested provider date.
- Before comparing standings, retain ranking groups and provider ranks. Do not turn row order or win totals into a rank. NHL comparisons use points when winning percentage is absent; missing ranks and group names stay unknown.
- Before summarizing scoring events, finish their pages and count repeated game totals only once. Live pages refetch provider data, so report the resulting recap as live rather than an immutable snapshot.
- Interpret empty played-stat sections alongside game status. Scheduled games have no played statistics; missing values and unplayed innings are not zero performance.

## Workflows

### A team's results over a date range

Resolve an unclear team identity first. Score filters match substrings on the acquired slate, so use a canonical full name when selecting a particular team; do not treat a broad filter as disambiguation.

Use `sports_get_schedule` for the requested period rather than treating the recent-results list in `sports_get_team` as complete history. Follow each game-page continuation with unchanged bounds, then advance to the returned next date window while retaining the original requested end. Continue even when an acquired window has no games.

Collect the returned game IDs with their leagues. For a detailed recap, follow completed games into `sports_get_game`; its scoring-play pages repeat metadata and team totals, so combine the plays without summing those repeated sections.

### From a game performer to a biography

Start with the performer named in `sports_get_game`. If only an athlete ID is available, do not invent a name or convert the provider ID into a TheSportsDB ID. If a name is available, search it with `sports_find_player`, resolve conflicting identity clues, and retrieve the matched biography with `sports_get_player`.

### A standings comparison

Use `sports_get_standings` and finish its pages before comparing the acquired table. Preserve each team's ranking group so conference or division ranks are not presented as one league-wide ordering. An explicit season that cannot be verified is unavailable; do not replace it with current standings and label them as the requested season.
