# ESPN calendar fixtures

`game-detail/` contains immutable ESPN summary and MLB v1.1 live-feed HTTP captures for completed NFL/NBA/NHL/EPL/MLB games, scheduled NFL/MLB games, and missing/wrong-league events. Each capture retains the actual status and body. Tests parse those bodies at the fetch boundary, including all 108 NBA scoring events and the omitted home runs in MLB's unplayed ninth inning.

`espn-calendar.json` preserves selected fields from direct ESPN HTTP 200 captures: scoreboard events, team schedule events, season metadata, and team identities. Score objects retain `displayValue` and `value`; omitted venue fields exercise sparse records. College inventory fixtures retain Washington, Gonzaga, and Montana records. Professional inventories retain their captured candidates.

Football `ncaaf-fbs` uses `groups=80` without a scoreboard limit; basketball `ncaab-all-plain` uses `groups=50`. The football default and FBS captures each contain 46 events; the Division I basketball slate contains 116. Fixtures also preserve NFL event `401872980`, Arsenal results/fixtures, and Lakers preseason/regular-season records with provider year 2027 and stale top-level phase metadata.

`runtime-probe.cjs` reports the actual Node executable and PID when preloaded by documented start-command tests. It leaves server startup intact.

`college-default-inventories.json` preserves the default 50-team lists. `college-inventory-ids.json` preserves all IDs from independent `limit=1000` and `limit=2000` captures: 762 football records and 362 basketball records. Their exact sequences agree. Inventory tests project unneeded metadata out while retaining every captured ID.
