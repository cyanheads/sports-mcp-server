/**
 * @fileoverview ESPN Site API service — scoreboard, schedule, standings, and teams.
 * @module services/espn/espn-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { serviceUnavailable, validationError } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { withRetry } from '@cyanheads/mcp-ts-core/utils';
import type { NormalizedGame, NormalizedStanding, NormalizedTeam } from '../types.js';

const ESPN_BASE = 'https://site.api.espn.com';

/** Maps ESPN status state to normalized status. */
function mapEspnStatus(state: string, typeName: string): NormalizedGame['status'] {
  if (state === 'pre') return 'scheduled';
  if (state === 'in') return 'in-progress';
  if (state === 'post') {
    if (typeName.includes('POSTPONED')) return 'postponed';
    if (typeName.includes('CANCELLED')) return 'cancelled';
    return 'final';
  }
  return 'scheduled';
}

export class EspnService {
  private fetchJson<T>(url: string, ctx: Context): Promise<T> {
    return withRetry(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        let response: Response;
        try {
          response = await fetch(url, {
            signal: ctx.signal ?? controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (!response.ok) {
          throw serviceUnavailable(`ESPN returned HTTP ${response.status}`);
        }
        const text = await response.text();
        if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
          throw serviceUnavailable(
            'ESPN returned HTML instead of JSON — likely rate-limited or invalid endpoint.',
          );
        }
        try {
          return JSON.parse(text) as T;
        } catch {
          throw serviceUnavailable('ESPN returned non-JSON response.');
        }
      },
      {
        operation: 'EspnService.fetchJson',
        baseDelayMs: 1000,
        signal: ctx.signal,
      },
    );
  }

  /** Fetch live/final scoreboard for a sport/league, optionally filtered by date (YYYYMMDD). */
  async getScoreboard(
    sport: string,
    league: string,
    date: string | null,
    ctx: Context,
  ): Promise<NormalizedGame[]> {
    const dateParam = date ? `?dates=${date.replace(/-/g, '')}` : '';
    const url = `${ESPN_BASE}/apis/site/v2/sports/${sport}/${league}/scoreboard${dateParam}`;
    ctx.log.debug('ESPN scoreboard fetch', { sport, league, date });

    // ESPN returns 400 on bad league slug — treat as validation error
    let data: { events?: unknown[] };
    try {
      data = await this.fetchJson<{ events?: unknown[] }>(url, ctx);
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string };
      if (e?.code === -32602 || (e?.message ?? '').includes('400')) {
        throw validationError(`Unknown ESPN league: ${league}`, {
          reason: 'invalid_league',
          league,
        });
      }
      throw err;
    }

    return this.normalizeEvents(data?.events ?? [], sport, league);
  }

  private normalizeEvents(events: unknown[], _sport: string, _league: string): NormalizedGame[] {
    const games: NormalizedGame[] = [];
    for (const ev of events) {
      const e = ev as Record<string, unknown>;
      const competitions = (e.competitions as unknown[]) ?? [];
      const comp = competitions[0] as Record<string, unknown> | undefined;
      if (!comp) continue;

      const competitors = (comp.competitors as unknown[]) ?? [];
      let homeTeam: NormalizedGame['homeTeam'] | null = null;
      let awayTeam: NormalizedGame['awayTeam'] | null = null;

      for (const c of competitors) {
        const competitor = c as Record<string, unknown>;
        const team = competitor.team as Record<string, unknown>;
        const side = competitor.homeAway as string;
        // Score may be a plain string/number (scoreboard) or an object with displayValue (schedule).
        const rawScore = competitor.score;
        let scoreStr: string | null = null;
        if (rawScore != null) {
          if (typeof rawScore === 'object') {
            const scoreObj = rawScore as Record<string, unknown>;
            scoreStr =
              scoreObj.displayValue != null
                ? String(scoreObj.displayValue)
                : scoreObj.value != null
                  ? String(scoreObj.value)
                  : null;
          } else {
            scoreStr = String(rawScore);
          }
        }
        const entry = {
          id: `espn:${String(team?.id ?? '')}`,
          name: String(team?.displayName ?? team?.name ?? ''),
          abbreviation: String(team?.abbreviation ?? ''),
          score: scoreStr,
        };
        if (side === 'home') homeTeam = entry;
        else awayTeam = entry;
      }

      if (!homeTeam || !awayTeam) continue;

      // Status may live on e.status (scoreboard) or comp.status (schedule endpoint).
      const status =
        (e.status as Record<string, unknown> | undefined) ??
        (comp.status as Record<string, unknown> | undefined);
      const statusType = status?.type as Record<string, unknown> | undefined;
      const state = String(statusType?.state ?? 'pre');
      const typeName = String(statusType?.name ?? '');
      const period = typeof status?.period === 'number' ? status.period : null;
      const displayClock = status?.displayClock != null ? String(status.displayClock) : null;
      const startDate = String(comp.date ?? e.date ?? '');

      games.push({
        id: `espn:${String(e.id ?? '')}`,
        shortName: String(e.shortName ?? `${awayTeam.abbreviation} @ ${homeTeam.abbreviation}`),
        homeTeam,
        awayTeam,
        status: mapEspnStatus(state, typeName),
        period: period === 0 ? null : period,
        clock: displayClock,
        startTimeUtc: startDate,
        venue:
          (comp.venue as Record<string, unknown>)?.fullName != null
            ? String((comp.venue as Record<string, unknown>).fullName)
            : null,
        source: 'espn',
      });
    }
    return games;
  }

  /** Fetch the full season schedule for a team and return normalized games. */
  async getTeamSchedule(
    sport: string,
    league: string,
    teamId: string,
    season: string | null,
    ctx: Context,
  ): Promise<NormalizedGame[]> {
    const seasonParam = season ? `?season=${season}` : '';
    const url = `${ESPN_BASE}/apis/site/v2/sports/${sport}/${league}/teams/${teamId}/schedule${seasonParam}`;
    ctx.log.debug('ESPN team schedule fetch', { sport, league, teamId, season });

    const data = await this.fetchJson<{ events?: unknown[] }>(url, ctx);
    return this.normalizeEvents(data?.events ?? [], sport, league);
  }

  /** Fetch the list of all teams in a sport/league. */
  async getTeams(sport: string, league: string, ctx: Context): Promise<NormalizedTeam[]> {
    const url = `${ESPN_BASE}/apis/site/v2/sports/${sport}/${league}/teams`;
    ctx.log.debug('ESPN teams fetch', { sport, league });

    const data = await this.fetchJson<{ sports?: unknown[] }>(url, ctx);
    const sports = data?.sports ?? [];
    const leagueData = (sports[0] as Record<string, unknown>)?.leagues;
    const leagues = (leagueData as unknown[]) ?? [];
    const leagueObj = leagues[0] as Record<string, unknown> | undefined;
    const teams = (leagueObj?.teams as unknown[]) ?? [];

    return teams.map((t) => {
      const entry = t as Record<string, unknown>;
      const team = entry.team as Record<string, unknown>;
      const logos = (team.logos as unknown[]) ?? [];
      const logo = (logos[0] as Record<string, unknown>)?.href;
      return {
        id: `espn:${String(team.id ?? '')}`,
        espnId: String(team.id ?? ''),
        mlbId: null,
        tsdbId: null,
        name: String(team.name ?? ''),
        abbreviation: String(team.abbreviation ?? ''),
        location: String(team.location ?? ''),
        displayName: String(team.displayName ?? ''),
        league,
        logoUrl: logo ? String(logo) : null,
        venueId: null,
        venueName: null,
        source: 'espn' as const,
      };
    });
  }

  /** Fetch team detail (metadata + links). */
  async getTeamDetail(
    sport: string,
    league: string,
    teamId: string,
    ctx: Context,
  ): Promise<NormalizedTeam | null> {
    const url = `${ESPN_BASE}/apis/site/v2/sports/${sport}/${league}/teams/${teamId}`;
    ctx.log.debug('ESPN team detail fetch', { sport, league, teamId });

    const data = await this.fetchJson<{ team?: unknown }>(url, ctx);
    const team = data?.team as Record<string, unknown> | undefined;
    if (!team) return null;

    const logos = (team.logos as unknown[]) ?? [];
    const logo = (logos[0] as Record<string, unknown>)?.href;

    return {
      id: `espn:${String(team.id ?? '')}`,
      espnId: String(team.id ?? ''),
      mlbId: null,
      tsdbId: null,
      name: String(team.name ?? ''),
      abbreviation: String(team.abbreviation ?? ''),
      location: String(team.location ?? ''),
      displayName: String(team.displayName ?? ''),
      league,
      logoUrl: logo ? String(logo) : null,
      venueId: null,
      venueName: null,
      source: 'espn' as const,
    };
  }

  /** Fetch roster for a team — returns players grouped by position. */
  async getTeamRoster(
    sport: string,
    league: string,
    teamId: string,
    ctx: Context,
  ): Promise<Array<{ position: string; name: string; jersey: string | null }>> {
    const url = `${ESPN_BASE}/apis/site/v2/sports/${sport}/${league}/teams/${teamId}/roster`;
    ctx.log.debug('ESPN roster fetch', { sport, league, teamId });

    const data = await this.fetchJson<{ athletes?: unknown[] }>(url, ctx);
    const athletes = data?.athletes ?? [];
    const result: Array<{ position: string; name: string; jersey: string | null }> = [];

    for (const group of athletes) {
      const g = group as Record<string, unknown>;
      const position = String(g.position ?? g.displayName ?? 'Unknown');
      const items = (g.items as unknown[]) ?? [];
      for (const item of items) {
        const player = item as Record<string, unknown>;
        const displayName = String(player.fullName ?? player.displayName ?? '');
        const jersey = player.jersey != null ? String(player.jersey) : null;
        result.push({ position, name: displayName, jersey });
      }
    }
    return result;
  }

  /** Fetch standings using the /apis/v2/ path (not /apis/site/v2/). */
  async getStandings(
    sport: string,
    league: string,
    season: string | null,
    ctx: Context,
  ): Promise<NormalizedStanding[]> {
    const params = new URLSearchParams();
    if (season) params.set('season', season);
    params.set('type', '2');
    const query = params.toString() ? `?${params.toString()}` : '';
    // Use /apis/v2/ — /apis/site/v2/standings returns empty children
    const url = `${ESPN_BASE}/apis/v2/sports/${sport}/${league}/standings${query}`;
    ctx.log.debug('ESPN standings fetch', { sport, league, season });

    const data = await this.fetchJson<{ children?: unknown[] }>(url, ctx);
    const children = data?.children ?? [];
    const standings: NormalizedStanding[] = [];

    for (const child of children) {
      const c = child as Record<string, unknown>;
      const standingsObj = c.standings as Record<string, unknown> | undefined;
      const entries = (standingsObj?.entries as unknown[]) ?? [];

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i] as Record<string, unknown>;
        const team = entry.team as Record<string, unknown> | undefined;
        const stats = (entry.stats as unknown[]) ?? [];

        const statMap: Record<string, string> = {};
        for (const stat of stats) {
          const s = stat as Record<string, unknown>;
          statMap[String(s.name ?? '')] = String(s.displayValue ?? s.value ?? '');
        }

        standings.push({
          rank: i + 1,
          team: {
            id: `espn:${String(team?.id ?? '')}`,
            name: String(team?.displayName ?? ''),
            abbreviation: String(team?.abbreviation ?? ''),
          },
          wins: Number(statMap.wins ?? 0) || 0,
          losses: Number(statMap.losses ?? 0) || 0,
          ties: statMap.ties != null ? Number(statMap.ties) || null : null,
          points: statMap.points != null ? Number(statMap.points) || null : null,
          winningPercentage: statMap.winPercent ?? statMap.winningPercentage ?? null,
          divisionRank: null,
          streak: statMap.streak ?? null,
          gamesBehind: statMap.gamesBehind ?? statMap.gamesBehindDivision ?? null,
          source: 'espn' as const,
        });
      }
    }
    return standings;
  }
}

// --- Init/accessor pattern ---

let _service: EspnService | undefined;

export function initEspnService(_config: AppConfig, _storage: StorageService): void {
  _service = new EspnService();
}

export function getEspnService(): EspnService {
  if (!_service) throw new Error('EspnService not initialized — call initEspnService() in setup()');
  return _service;
}
