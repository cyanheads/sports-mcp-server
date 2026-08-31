/**
 * @fileoverview MLB StatsAPI service — schedule, standings, teams, and rosters.
 * @module services/mlb/mlb-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { withRetry } from '@cyanheads/mcp-ts-core/utils';
import type { NormalizedGame, NormalizedStanding, NormalizedTeam } from '../types.js';

const MLB_BASE = 'https://statsapi.mlb.com/api/v1';

/** Maps MLB abstractGameState to normalized status. */
function mapMlbStatus(abstractState: string, detailedState: string): NormalizedGame['status'] {
  if (abstractState === 'Live') return 'in-progress';
  if (abstractState === 'Final') {
    if (detailedState.includes('Postponed')) return 'postponed';
    if (detailedState.includes('Cancelled')) return 'cancelled';
    return 'final';
  }
  return 'scheduled';
}

export class MlbService {
  private fetchJson<T>(url: string, ctx: Context): Promise<T> {
    return withRetry(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        let response: Response;
        try {
          response = await fetch(url, { signal: ctx.signal ?? controller.signal });
        } finally {
          clearTimeout(timer);
        }
        if (!response.ok) {
          throw serviceUnavailable(`MLB StatsAPI returned HTTP ${response.status}`);
        }
        const text = await response.text();
        if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
          throw serviceUnavailable('MLB StatsAPI returned HTML instead of JSON.');
        }
        try {
          return JSON.parse(text) as T;
        } catch {
          throw serviceUnavailable('MLB StatsAPI returned non-JSON response.');
        }
      },
      {
        operation: 'MlbService.fetchJson',
        baseDelayMs: 1000,
        signal: ctx.signal,
      },
    );
  }

  /** Fetch schedule for a given date (YYYY-MM-DD). Null date returns today. */
  getSchedule(date: string | null, ctx: Context): Promise<NormalizedGame[]> {
    const dateParam = date ? `&date=${date}` : '';
    const url = `${MLB_BASE}/schedule?sportId=1&hydrate=team,linescore,decisions${dateParam}`;
    ctx.log.debug('MLB schedule fetch', { date });

    return this.fetchSchedule(url, ctx);
  }

  /** Fetch an inclusive league-wide schedule range in YYYY-MM-DD format. */
  getScheduleRange(dateFrom: string, dateTo: string, ctx: Context): Promise<NormalizedGame[]> {
    const url = `${MLB_BASE}/schedule?sportId=1&hydrate=team,linescore,decisions&startDate=${dateFrom}&endDate=${dateTo}`;
    ctx.log.debug('MLB schedule range fetch', { dateFrom, dateTo });

    return this.fetchSchedule(url, ctx);
  }

  private async fetchSchedule(url: string, ctx: Context): Promise<NormalizedGame[]> {
    const data = await this.fetchJson<{ dates?: unknown[] }>(url, ctx);
    const dates = data?.dates ?? [];
    const games: NormalizedGame[] = [];

    for (const d of dates) {
      const dateObj = d as Record<string, unknown>;
      const gameList = (dateObj.games as unknown[]) ?? [];

      for (const g of gameList) {
        const game = g as Record<string, unknown>;
        const teams = game.teams as Record<string, unknown> | undefined;
        const homeRaw = teams?.home as Record<string, unknown> | undefined;
        const awayRaw = teams?.away as Record<string, unknown> | undefined;
        const homeTeamRaw = homeRaw?.team as Record<string, unknown> | undefined;
        const awayTeamRaw = awayRaw?.team as Record<string, unknown> | undefined;

        const status = game.status as Record<string, unknown> | undefined;
        const abstractState = String(status?.abstractGameState ?? 'Preview');
        const detailedState = String(status?.detailedState ?? 'Scheduled');

        const linescore = game.linescore as Record<string, unknown> | undefined;
        const currentInning =
          linescore?.currentInning != null ? Number(linescore.currentInning) : null;
        const inningHalf = linescore?.inningHalf != null ? String(linescore.inningHalf) : null;

        const homeScore = homeRaw?.score != null ? String(homeRaw.score) : null;
        const awayScore = awayRaw?.score != null ? String(awayRaw.score) : null;

        const homeAbbr = String(homeTeamRaw?.abbreviation ?? homeTeamRaw?.teamCode ?? '');
        const awayAbbr = String(awayTeamRaw?.abbreviation ?? awayTeamRaw?.teamCode ?? '');

        games.push({
          id: `mlb:${String(game.gamePk ?? '')}`,
          shortName: `${awayAbbr} @ ${homeAbbr}`,
          homeTeam: {
            id: `mlb:${String(homeTeamRaw?.id ?? '')}`,
            name: String(homeTeamRaw?.name ?? ''),
            abbreviation: homeAbbr,
            score: homeScore,
          },
          awayTeam: {
            id: `mlb:${String(awayTeamRaw?.id ?? '')}`,
            name: String(awayTeamRaw?.name ?? ''),
            abbreviation: awayAbbr,
            score: awayScore,
          },
          status: mapMlbStatus(abstractState, detailedState),
          period: currentInning,
          clock: inningHalf,
          startTimeUtc: String(game.gameDate ?? ''),
          venue:
            (game.venue as Record<string, unknown>)?.name != null
              ? String((game.venue as Record<string, unknown>).name)
              : null,
          source: 'mlbstats' as const,
        });
      }
    }
    return games;
  }

  /** Fetch all MLB teams for a season. */
  async getTeams(season: string | null, ctx: Context): Promise<NormalizedTeam[]> {
    const seasonParam = season ? `&season=${season}` : '';
    const url = `${MLB_BASE}/teams?sportId=1${seasonParam}`;
    ctx.log.debug('MLB teams fetch', { season });

    const data = await this.fetchJson<{ teams?: unknown[] }>(url, ctx);
    const teams = data?.teams ?? [];

    return teams.map((t) => {
      const team = t as Record<string, unknown>;
      return {
        id: `mlb:${String(team.id ?? '')}`,
        espnId: null,
        mlbId: typeof team.id === 'number' ? team.id : null,
        tsdbId: null,
        name: String(team.teamName ?? team.name ?? ''),
        abbreviation: String(team.abbreviation ?? ''),
        location: String(team.locationName ?? team.franchiseName ?? ''),
        displayName: String(team.name ?? ''),
        league: 'mlb',
        logoUrl: null,
        venueId:
          (team.venue as Record<string, unknown>)?.id != null
            ? String((team.venue as Record<string, unknown>).id)
            : null,
        venueName:
          (team.venue as Record<string, unknown>)?.name != null
            ? String((team.venue as Record<string, unknown>).name)
            : null,
        source: 'mlbstats' as const,
      };
    });
  }

  /** Fetch standings for a season (defaults to current year). */
  async getStandings(season: string | null, ctx: Context): Promise<NormalizedStanding[]> {
    const yr = season ?? new Date().getFullYear().toString();
    const url = `${MLB_BASE}/standings?leagueId=103,104&season=${yr}`;
    ctx.log.debug('MLB standings fetch', { season: yr });

    // Fetch teams in parallel to build an id→abbreviation map.
    // The standings endpoint omits team abbreviation; the teams endpoint has it.
    const [data, teamsData] = await Promise.all([
      this.fetchJson<{ records?: unknown[] }>(url, ctx),
      this.fetchJson<{ teams?: unknown[] }>(`${MLB_BASE}/teams?sportId=1`, ctx).catch(() => ({
        teams: [] as unknown[],
      })),
    ]);

    const abbrevMap = new Map<string, string>();
    for (const t of teamsData?.teams ?? []) {
      const team = t as Record<string, unknown>;
      if (team.id != null && team.abbreviation != null) {
        abbrevMap.set(String(team.id), String(team.abbreviation));
      }
    }

    const records = data?.records ?? [];
    const standings: NormalizedStanding[] = [];

    for (const rec of records) {
      const record = rec as Record<string, unknown>;
      const teamRecords = (record.teamRecords as unknown[]) ?? [];

      for (const tr of teamRecords) {
        const t = tr as Record<string, unknown>;
        const team = t.team as Record<string, unknown> | undefined;
        const teamId = String(team?.id ?? '');

        standings.push({
          rank: typeof t.divisionRank === 'string' ? parseInt(t.divisionRank, 10) || 0 : 0,
          team: {
            id: `mlb:${teamId}`,
            name: String(team?.name ?? ''),
            abbreviation: abbrevMap.get(teamId) ?? String(team?.abbreviation ?? ''),
          },
          wins: typeof t.wins === 'number' ? t.wins : parseInt(String(t.wins ?? '0'), 10) || 0,
          losses:
            typeof t.losses === 'number' ? t.losses : parseInt(String(t.losses ?? '0'), 10) || 0,
          ties: null,
          points: null,
          winningPercentage: t.winningPercentage != null ? String(t.winningPercentage) : null,
          divisionRank: t.divisionRank != null ? String(t.divisionRank) : null,
          streak:
            (t.streak as Record<string, unknown>)?.streakCode != null
              ? String((t.streak as Record<string, unknown>).streakCode)
              : null,
          gamesBehind: t.gamesBack != null ? String(t.gamesBack) : null,
          source: 'mlbstats' as const,
        });
      }
    }
    return standings;
  }

  /** Fetch active roster for a team. */
  async getTeamRoster(
    teamId: number,
    season: string | null,
    ctx: Context,
  ): Promise<Array<{ name: string; position: string; jerseyNumber: string | null }>> {
    const seasonParam = season ? `&season=${season}` : '';
    const url = `${MLB_BASE}/teams/${teamId}/roster?rosterType=active${seasonParam}`;
    ctx.log.debug('MLB roster fetch', { teamId, season });

    const data = await this.fetchJson<{ roster?: unknown[] }>(url, ctx);
    const roster = data?.roster ?? [];

    return roster.map((p) => {
      const player = p as Record<string, unknown>;
      const person = player.person as Record<string, unknown> | undefined;
      const pos = player.position as Record<string, unknown> | undefined;
      return {
        name: String(person?.fullName ?? ''),
        position: String(pos?.abbreviation ?? pos?.name ?? ''),
        jerseyNumber: player.jerseyNumber != null ? String(player.jerseyNumber) : null,
      };
    });
  }
}

// --- Init/accessor pattern ---

let _service: MlbService | undefined;

export function initMlbService(_config: AppConfig, _storage: StorageService): void {
  _service = new MlbService();
}

export function getMlbService(): MlbService {
  if (!_service) throw new Error('MlbService not initialized — call initMlbService() in setup()');
  return _service;
}
