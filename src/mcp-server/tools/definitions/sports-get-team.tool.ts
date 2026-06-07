/**
 * @fileoverview sports_get_team tool — team detail with roster, recent results, and next fixtures.
 * @module mcp-server/tools/definitions/sports-get-team.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { fetchWithTimeout, withRetry } from '@cyanheads/mcp-ts-core/utils';
import { getEspnService } from '@/services/espn/espn-service.js';
import { getMlbService } from '@/services/mlb/mlb-service.js';
import { LEAGUE_ROUTES } from '@/services/types.js';

const LEAGUE_ENUM = z.enum([
  'nfl',
  'nba',
  'mlb',
  'nhl',
  'epl',
  'mls',
  'laliga',
  'bundesliga',
  'seriea',
  'ligue1',
  'ucl',
  'ncaaf',
  'ncaab',
]);

export const sportsGetTeam = tool('sports_get_team', {
  description:
    'Team detail: active roster, last 5 results, next 3 upcoming fixtures, venue, and team metadata. ' +
    'Combines team detail, roster, and schedule data. Use sports_find_team first to confirm the correct team name.',

  annotations: { readOnlyHint: true, openWorldHint: true },

  input: z.object({
    league: LEAGUE_ENUM.describe(
      'League identifier. Supported: nfl, nba, mlb, nhl, epl, mls, laliga, bundesliga, seriea, ligue1, ucl, ncaaf, ncaab.',
    ),
    team_name: z
      .string()
      .max(200, 'Team name must be 200 characters or fewer.')
      .describe('Team name, abbreviation, or city. Fuzzy matched against ESPN/MLB team list.'),
  }),

  output: z.object({
    team: z
      .object({
        id: z.string().describe('Primary source-prefixed team ID, e.g. espn:26 or mlb:136.'),
        espnId: z.string().nullable().describe('ESPN numeric team ID, or null if not in ESPN.'),
        mlbId: z.number().nullable().describe('MLB StatsAPI team ID, or null if not an MLB team.'),
        tsdbId: z.string().nullable().describe('TheSportsDB team ID, or null if not found.'),
        name: z.string().describe('Team short name, e.g. "Seahawks".'),
        abbreviation: z.string().describe('Team abbreviation, e.g. "SEA".'),
        location: z.string().describe('Team city or region, e.g. "Seattle".'),
        displayName: z.string().describe('Full display name, e.g. "Seattle Seahawks".'),
        league: z.string().describe('League this team plays in, e.g. "nfl".'),
        logoUrl: z.string().nullable().describe('Team logo or badge URL, or null if unavailable.'),
        venueName: z
          .string()
          .nullable()
          .describe('Home venue or stadium name, or null if unavailable.'),
        source: z
          .enum(['espn', 'mlbstats', 'thesportsdb'])
          .describe('Data source that provided this team record.'),
      })
      .describe('Team metadata.'),
    roster: z
      .array(
        z
          .object({
            name: z.string().describe('Player full name.'),
            position: z.string().describe('Player position.'),
            jersey: z.string().nullable().describe('Jersey number, or null if unavailable.'),
          })
          .describe('A roster player entry.'),
      )
      .describe('Active roster.'),
    recentResults: z
      .array(
        z
          .object({
            id: z.string().describe('Source-prefixed game ID, e.g. espn:401872656.'),
            shortName: z.string().describe('Short matchup string, e.g. "SEA @ DAL".'),
            status: z
              .enum(['scheduled', 'in-progress', 'final', 'postponed', 'cancelled'])
              .describe('Game status.'),
            homeTeam: z
              .object({
                id: z.string().describe('Source-prefixed team ID.'),
                name: z.string().describe('Full team name.'),
                abbreviation: z.string().describe('Team abbreviation, e.g. "SEA".'),
                score: z.string().nullable().describe('Final score, null if not played yet.'),
              })
              .describe('Home team and score.'),
            awayTeam: z
              .object({
                id: z.string().describe('Source-prefixed team ID.'),
                name: z.string().describe('Full team name.'),
                abbreviation: z.string().describe('Team abbreviation, e.g. "DAL".'),
                score: z.string().nullable().describe('Final score, null if not played yet.'),
              })
              .describe('Away team and score.'),
            startTimeUtc: z.string().describe('Game start time in UTC ISO 8601.'),
            source: z
              .enum(['espn', 'mlbstats'])
              .describe('Data source that provided this game record.'),
          })
          .describe('A recent completed game result.'),
      )
      .describe('Last up to 5 completed games for this team.'),
    upcomingFixtures: z
      .array(
        z
          .object({
            id: z.string().describe('Source-prefixed game ID, e.g. espn:401872656.'),
            shortName: z.string().describe('Short matchup string, e.g. "SEA @ DAL".'),
            status: z
              .enum(['scheduled', 'in-progress', 'final', 'postponed', 'cancelled'])
              .describe('Game status.'),
            homeTeam: z
              .object({
                id: z.string().describe('Source-prefixed team ID.'),
                name: z.string().describe('Full team name.'),
                abbreviation: z.string().describe('Team abbreviation, e.g. "SEA".'),
                score: z
                  .string()
                  .nullable()
                  .describe('Score if the game is in progress, otherwise null.'),
              })
              .describe('Home team.'),
            awayTeam: z
              .object({
                id: z.string().describe('Source-prefixed team ID.'),
                name: z.string().describe('Full team name.'),
                abbreviation: z.string().describe('Team abbreviation, e.g. "DAL".'),
                score: z
                  .string()
                  .nullable()
                  .describe('Score if the game is in progress, otherwise null.'),
              })
              .describe('Away team.'),
            startTimeUtc: z.string().describe('Game start time in UTC ISO 8601.'),
            source: z
              .enum(['espn', 'mlbstats'])
              .describe('Data source that provided this game record.'),
          })
          .describe('An upcoming scheduled game.'),
      )
      .describe('Next up to 3 upcoming scheduled games for this team.'),
  }),

  errors: [
    {
      reason: 'team_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No team matched the provided team_name in the specified league.',
      recovery: 'Use sports_find_team to resolve the team name to a canonical record first.',
    },
  ],

  async handler(input, ctx) {
    // biome-ignore lint/style/noNonNullAssertion: Zod enum guarantees input.league is always a key in LEAGUE_ROUTES
    const route = LEAGUE_ROUTES[input.league]!;
    ctx.log.info('Fetching team detail', { league: input.league, team: input.team_name });
    const q = input.team_name.toLowerCase();
    const now = new Date().toISOString().slice(0, 10);

    if (route.mlbLeagueId) {
      const teams = await getMlbService().getTeams(null, ctx);
      const team = teams.find(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.displayName.toLowerCase().includes(q) ||
          t.abbreviation.toLowerCase() === q,
      );
      if (!team?.mlbId)
        throw ctx.fail('team_not_found', `No MLB team matching "${input.team_name}".`, {
          ...ctx.recoveryFor('team_not_found'),
        });

      const rosterRaw = await getMlbService().getTeamRoster(team.mlbId, null, ctx);
      const roster = rosterRaw.map((p) => ({
        name: p.name,
        position: p.position,
        jersey: p.jerseyNumber,
      }));

      const allGames = await getMlbService().getSchedule(null, ctx);
      // We need more history — fetch schedule directly with a wider range
      const fromDate = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
      const toDate = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);

      const schedUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&hydrate=team,linescore&teamId=${team.mlbId}&startDate=${fromDate}&endDate=${toDate}`;
      const schedData = await withRetry(
        async () => {
          const res = await fetchWithTimeout(schedUrl, 10_000, ctx, { signal: ctx.signal });
          return res.json() as Promise<{ dates?: unknown[] }>;
        },
        { operation: 'mlb-team-sched-for-get-team', context: ctx, baseDelayMs: 1000 },
      );

      const teamGames = [];
      for (const d of schedData?.dates ?? []) {
        const dateObj = d as Record<string, unknown>;
        for (const g of (dateObj.games as unknown[]) ?? []) {
          const game = g as Record<string, unknown>;
          const gameTeams = game.teams as Record<string, unknown> | undefined;
          const homeRaw = gameTeams?.home as Record<string, unknown> | undefined;
          const awayRaw = gameTeams?.away as Record<string, unknown> | undefined;
          const homeTeam = homeRaw?.team as Record<string, unknown> | undefined;
          const awayTeam = awayRaw?.team as Record<string, unknown> | undefined;
          const statusObj = game.status as Record<string, unknown> | undefined;
          const absState = String(statusObj?.abstractGameState ?? 'Preview');
          const detState = String(statusObj?.detailedState ?? 'Scheduled');
          const homeAbbr = String(homeTeam?.abbreviation ?? '');
          const awayAbbr = String(awayTeam?.abbreviation ?? '');
          teamGames.push({
            id: `mlb:${String(game.gamePk ?? '')}`,
            shortName: `${awayAbbr} @ ${homeAbbr}`,
            status: (absState === 'Live'
              ? 'in-progress'
              : absState === 'Final'
                ? detState.includes('Postponed')
                  ? 'postponed'
                  : 'final'
                : 'scheduled') as 'scheduled' | 'in-progress' | 'final' | 'postponed' | 'cancelled',
            homeTeam: {
              id: `mlb:${String(homeTeam?.id ?? '')}`,
              name: String(homeTeam?.name ?? ''),
              abbreviation: homeAbbr,
              score: homeRaw?.score != null ? String(homeRaw.score) : null,
            },
            awayTeam: {
              id: `mlb:${String(awayTeam?.id ?? '')}`,
              name: String(awayTeam?.name ?? ''),
              abbreviation: awayAbbr,
              score: awayRaw?.score != null ? String(awayRaw.score) : null,
            },
            startTimeUtc: String(game.gameDate ?? ''),
            source: 'mlbstats' as const,
          });
        }
      }

      // Append today's games from allGames (prevents missing today)
      const todayGames = allGames.filter(
        (g) =>
          g.startTimeUtc.slice(0, 10) === now &&
          (g.homeTeam.id === `mlb:${team.mlbId}` || g.awayTeam.id === `mlb:${team.mlbId}`),
      );
      for (const tg of todayGames) {
        if (!teamGames.find((g) => g.id === tg.id)) teamGames.push(tg);
      }

      const recentResults = teamGames.filter((g) => g.status === 'final').slice(-5);
      const upcomingFixtures = teamGames.filter((g) => g.status === 'scheduled').slice(0, 3);

      return { team, roster, recentResults, upcomingFixtures };
    }

    // ESPN path
    const espnTeams = await getEspnService().getTeams(route.espnSport, route.espnLeague, ctx);
    const team = espnTeams.find(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.displayName.toLowerCase().includes(q) ||
        t.abbreviation.toLowerCase() === q ||
        t.location.toLowerCase().includes(q),
    );
    if (!team)
      throw ctx.fail(
        'team_not_found',
        `No team matching "${input.team_name}" in ${input.league}.`,
        {
          ...ctx.recoveryFor('team_not_found'),
        },
      );

    const teamId = team.espnId ?? team.id.replace('espn:', '');

    const [detailResult, rosterRaw, allGames] = await Promise.all([
      getEspnService().getTeamDetail(route.espnSport, route.espnLeague, teamId, ctx),
      getEspnService().getTeamRoster(route.espnSport, route.espnLeague, teamId, ctx),
      getEspnService().getTeamSchedule(route.espnSport, route.espnLeague, teamId, null, ctx),
    ]);

    const teamDetail = detailResult ?? team;
    const roster = rosterRaw.map((p) => ({ name: p.name, position: p.position, jersey: p.jersey }));

    const recentResults = allGames
      .filter((g) => g.status === 'final' && g.startTimeUtc.slice(0, 10) <= now)
      .slice(-5);
    const upcomingFixtures = allGames
      .filter((g) => g.status === 'scheduled' && g.startTimeUtc.slice(0, 10) >= now)
      .slice(0, 3);

    return { team: teamDetail, roster, recentResults, upcomingFixtures };
  },

  format: (result) => {
    const t = result.team;
    const lines: string[] = [
      `# ${t.displayName} (${t.name})`,
      `**Abbrev:** ${t.abbreviation} | **Location:** ${t.location} | **League:** ${t.league}`,
      `**Venue:** ${t.venueName ?? 'N/A'} | **Source:** ${t.source}`,
      `**IDs:** primary=${t.id} espn=${t.espnId ?? 'N/A'} mlb=${t.mlbId ?? 'N/A'} tsdb=${t.tsdbId ?? 'N/A'}`,
      t.logoUrl ? `**Logo:** ${t.logoUrl}` : '',
      '',
      `## Roster (${result.roster.length} players)`,
    ];

    for (const p of result.roster) {
      lines.push(`- ${p.jersey ? `#${p.jersey} ` : ''}**${p.name}** (${p.position})`);
    }

    lines.push('', '## Last 5 Results');
    if (result.recentResults.length === 0) {
      lines.push('_No recent results available._');
    } else {
      for (const g of result.recentResults) {
        lines.push(`**${g.shortName}** [${g.id}] — ${g.status} | Start: ${g.startTimeUtc}`);
        lines.push(
          `  Away: ${g.awayTeam.name} (${g.awayTeam.abbreviation}) [${g.awayTeam.id}] ${g.awayTeam.score ?? '—'}`,
        );
        lines.push(
          `  Home: ${g.homeTeam.name} (${g.homeTeam.abbreviation}) [${g.homeTeam.id}] ${g.homeTeam.score ?? '—'}`,
        );
        lines.push(`  Source: ${g.source}`);
      }
    }

    lines.push('', '## Upcoming Fixtures');
    if (result.upcomingFixtures.length === 0) {
      lines.push('_No upcoming fixtures available._');
    } else {
      for (const g of result.upcomingFixtures) {
        lines.push(`**${g.shortName}** [${g.id}] — ${g.status} | Start: ${g.startTimeUtc}`);
        lines.push(
          `  Away: ${g.awayTeam.name} (${g.awayTeam.abbreviation}) [${g.awayTeam.id}] ${g.awayTeam.score ?? '—'}`,
        );
        lines.push(
          `  Home: ${g.homeTeam.name} (${g.homeTeam.abbreviation}) [${g.homeTeam.id}] ${g.homeTeam.score ?? '—'}`,
        );
        lines.push(`  Source: ${g.source}`);
      }
    }

    return [{ type: 'text' as const, text: lines.filter(Boolean).join('\n') }];
  },
});
