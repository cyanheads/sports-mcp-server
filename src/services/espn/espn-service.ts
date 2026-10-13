/**
 * @fileoverview ESPN Site API service — scoreboard, schedule, standings, and teams.
 * @module services/espn/espn-service
 */

import { type Context, z } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import {
  JsonRpcErrorCode,
  McpError,
  notFound,
  serviceUnavailable,
} from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { withRetry } from '@cyanheads/mcp-ts-core/utils';
import { addCalendarDays } from '../date-window.js';
import { fetchProviderText } from '../fetch-provider-text.js';
import type { GameDetail, NormalizedGame, NormalizedStanding, NormalizedTeam } from '../types.js';
import { normalizeEspnGameDetail } from './espn-game-detail.js';

const ESPN_BASE = 'https://site.api.espn.com';

const SummaryMetadata = z.looseObject({
  header: z.looseObject({
    id: z.string(),
    competitions: z
      .array(
        z.looseObject({
          date: z.string().min(1),
          competitors: z
            .array(
              z.looseObject({
                homeAway: z.enum(['home', 'away']),
                team: z.looseObject({ id: z.string().min(1) }),
              }),
            )
            .length(2),
          status: z.looseObject({ type: z.looseObject({ state: z.enum(['pre', 'in', 'post']) }) }),
        }),
      )
      .min(1),
  }),
  gameInfo: z
    .looseObject({
      venue: z.looseObject({ fullName: z.string().optional() }).nullable().optional(),
    })
    .nullable()
    .optional(),
});

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
  /** Resolve a source event ID through the caller's league, without cross-league inference. */
  async getGame(sport: string, league: string, eventId: string, ctx: Context): Promise<GameDetail> {
    let payload: unknown;
    try {
      payload = await this.fetchJson(
        `${ESPN_BASE}/apis/site/v2/sports/${sport}/${league}/summary?event=${eventId}`,
        ctx,
      );
    } catch (error: unknown) {
      if (
        !ctx.signal.aborted &&
        error instanceof McpError &&
        (error.code === JsonRpcErrorCode.InvalidParams || error.code === JsonRpcErrorCode.NotFound)
      ) {
        const body = String(error.data?.body ?? '');
        // The captured missing-event signature is bounded by HTTP diagnostic capture.
        if (
          body.includes(`/sports/${sport}/leagues/${league}/events/${eventId}`) &&
          (body.includes('status=400') || body.includes('status=404'))
        ) {
          throw notFound(
            'No game exists for this ID in the requested league.',
            { reason: 'game_not_found' },
            { cause: error },
          );
        }
      }
      throw error;
    }
    const parsed = SummaryMetadata.safeParse(payload);
    if (!parsed.success || parsed.data.header.id !== eventId)
      throw serviceUnavailable('ESPN summary returned missing or mismatched game identity.');
    const data = parsed.data;
    const sides = data.header.competitions[0]?.competitors.map((competitor) => competitor.homeAway);
    if (!sides?.includes('home') || !sides.includes('away'))
      throw serviceUnavailable('ESPN summary is missing opposing team metadata.');
    const game = this.normalizeEvents([data.header], sport, league)[0];
    if (!game?.startTimeUtc) throw serviceUnavailable('ESPN summary is missing game metadata.');
    const venue = data.gameInfo?.venue;
    if (venue?.fullName) game.venue = venue.fullName;
    return normalizeEspnGameDetail(data, game);
  }

  private fetchJson<T>(url: string, ctx: Context): Promise<T> {
    return withRetry(
      async (attempt) => {
        const text = await fetchProviderText(url, ctx, attempt);
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
        deadlineMs: 30_000,
      },
    );
  }

  /** Fetch live/final scoreboard for a sport/league, optionally filtered by date (YYYYMMDD). */
  getScoreboard(
    sport: string,
    league: string,
    date: string | null,
    ctx: Context,
  ): Promise<NormalizedGame[]> {
    ctx.log.debug('ESPN scoreboard fetch', { sport, league, date });

    return this.fetchScoreboard(sport, league, date ? date.replace(/-/g, '') : null, ctx);
  }

  /** Fetch a bounded inclusive range using authoritative single-day scoreboard membership. */
  async getScoreboardRange(
    sport: string,
    league: string,
    dateFrom: string,
    dateTo: string,
    ctx: Context,
  ): Promise<NormalizedGame[]> {
    ctx.log.debug('ESPN scoreboard range fetch', { sport, league, dateFrom, dateTo });
    const games: NormalizedGame[] = [];
    for (let day = dateFrom; day <= dateTo; day = addCalendarDays(day, 1)) {
      ctx.signal.throwIfAborted();
      const slate = await this.getScoreboard(sport, league, day, ctx);
      games.push(...slate.map((game) => ({ ...game, providerDate: day })));
      if (day === dateTo) break;
    }
    return games;
  }

  private async fetchScoreboard(
    sport: string,
    league: string,
    dates: string | null,
    ctx: Context,
  ): Promise<NormalizedGame[]> {
    const params = new URLSearchParams();
    if (dates) params.set('dates', dates);
    if (league === 'mens-college-basketball') params.set('groups', '50');
    if (league === 'college-football') params.set('groups', '80');
    const dateParam = params.size ? `?${params}` : '';
    const url = `${ESPN_BASE}/apis/site/v2/sports/${sport}/${league}/scoreboard${dateParam}`;

    let data: { events?: unknown[] };
    try {
      data = await this.fetchJson<{ events?: unknown[] }>(url, ctx);
    } catch (err: unknown) {
      if (
        !ctx.signal.aborted &&
        err instanceof McpError &&
        (err.code === JsonRpcErrorCode.InvalidParams ||
          err.code === JsonRpcErrorCode.ValidationError)
      ) {
        throw new McpError(
          err.code,
          err.message,
          {
            ...err.data,
            recovery: {
              hint: 'ESPN rejected the scoreboard request. Check any supplied date, date_from, and date_to values; try omitting them to request the default scoreboard.',
            },
          },
          { cause: err },
        );
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

  /** Merge the provider season's soccer results/fixtures or US sport phases, then order games. */
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

    const data = await this.fetchJson<{
      events?: unknown[];
      season?: { year?: number; type?: number };
    }>(url, ctx);
    const games = this.normalizeEvents(data?.events ?? [], sport, league);
    if (sport === 'soccer') {
      const params = new URLSearchParams({ fixture: 'true' });
      if (season) params.set('season', season);
      const fixtures = await this.fetchJson<{ events?: unknown[] }>(
        `${url.split('?')[0]}?${params}`,
        ctx,
      );
      games.push(...this.normalizeEvents(fixtures?.events ?? [], sport, league));
    } else if (data?.season?.year != null || season) {
      const year = season ?? String(data.season?.year);
      const includedPhases = new Set(
        (data.events ?? []).map((event) => {
          const record = event as Record<string, unknown>;
          return (record.seasonType as { type?: number } | undefined)?.type;
        }),
      );
      /** Top-level phase metadata can remain preseason on regular-season records. */
      for (const phase of [1, 2, 3]) {
        if (includedPhases.has(phase)) continue;
        ctx.signal.throwIfAborted();
        const params = new URLSearchParams({ season: year, seasontype: String(phase) });
        const phaseData = await this.fetchJson<{ events?: unknown[] }>(
          `${url.split('?')[0]}?${params}`,
          ctx,
        );
        games.push(...this.normalizeEvents(phaseData?.events ?? [], sport, league));
      }
    }
    return [...new Map(games.map((game) => [game.id, game])).values()].sort(
      (a, b) => a.startTimeUtc.localeCompare(b.startTimeUtc) || a.id.localeCompare(b.id),
    );
  }

  /** Fetch the list of all teams in a sport/league. */
  async getTeams(sport: string, league: string, ctx: Context): Promise<NormalizedTeam[]> {
    const inventory =
      league === 'college-football' || league === 'mens-college-basketball' ? '?limit=1000' : '';
    const url = `${ESPN_BASE}/apis/site/v2/sports/${sport}/${league}/teams${inventory}`;
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
    const venue = (team.franchise as { venue?: { id?: unknown; fullName?: unknown } } | undefined)
      ?.venue;

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
      venueId: venue?.id != null ? String(venue.id) : null,
      venueName: venue?.fullName != null ? String(venue.fullName) : null,
      source: 'espn' as const,
    };
  }

  /** Fetch active athletes from flat or position-grouped rosters. */
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
      if (
        league === 'nfl' &&
        ['injuredReserveOrOut', 'suspended', 'practiceSquad'].includes(String(g.position))
      )
        continue;
      const items = Array.isArray(g.items) ? g.items : [g];
      for (const item of items) {
        const player = item as Record<string, unknown>;
        const athletePosition = player.position as
          | { abbreviation?: string; displayName?: string; name?: string }
          | undefined;
        const position =
          athletePosition?.abbreviation ??
          athletePosition?.displayName ??
          athletePosition?.name ??
          'Unknown';
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
    const query = params.toString() ? `?${params.toString()}` : '';
    // Use /apis/v2/ — /apis/site/v2/standings returns empty children
    const url = `${ESPN_BASE}/apis/v2/sports/${sport}/${league}/standings${query}`;
    ctx.log.debug('ESPN standings fetch', { sport, league, season });

    const data = await this.fetchJson<Record<string, unknown>>(url, ctx);
    const standings: NormalizedStanding[] = [];
    let verified = true;
    const visit = (c: Record<string, unknown>, inheritedSeason: unknown): void => {
      ctx.signal.throwIfAborted();
      const standingsObj = c.standings as Record<string, unknown> | undefined;
      const entries = (standingsObj?.entries as unknown[]) ?? [];
      const ownSeason =
        typeof c.season === 'object' && c.season !== null
          ? (c.season as { year?: unknown }).year
          : c.season;
      const servedSeason = standingsObj?.season ?? ownSeason ?? inheritedSeason;
      if (
        season &&
        ((ownSeason != null && String(ownSeason) !== season) ||
          (standingsObj?.season != null && String(standingsObj.season) !== season) ||
          (entries.length > 0 && String(servedSeason) !== season))
      )
        verified = false;

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i] as Record<string, unknown>;
        const team = entry.team as Record<string, unknown> | undefined;
        const stats = (entry.stats as unknown[]) ?? [];

        const statMap: Record<string, string> = {};
        let overallRecord: RegExpMatchArray | null = null;
        for (const stat of stats) {
          const s = stat as Record<string, unknown>;
          if (typeof s.type === 'string' && s.type.includes('_')) continue;
          if (s.type === 'total' && s.name === 'overall') {
            overallRecord = String(s.summary ?? s.displayValue ?? '').match(
              /^(\d+)-(\d+)(?:-\d+)?$/,
            );
          }
          statMap[String(s.name ?? '')] = String(s.displayValue ?? s.value ?? '');
        }

        standings.push({
          rank: i + 1,
          group: c.name != null ? String(c.name) : null,
          team: {
            id: `espn:${String(team?.id ?? '')}`,
            name: String(team?.displayName ?? ''),
            abbreviation: String(team?.abbreviation ?? ''),
          },
          wins: Number(statMap.wins ?? overallRecord?.[1] ?? 0) || 0,
          losses: Number(statMap.losses ?? overallRecord?.[2] ?? 0) || 0,
          ties: statMap.ties != null ? Number(statMap.ties) : null,
          overtimeLosses:
            league === 'nhl' && statMap.otLosses != null ? Number(statMap.otLosses) : null,
          points:
            (sport === 'soccer' || league === 'nhl') && statMap.points != null
              ? Number(statMap.points)
              : null,
          winningPercentage: statMap.winPercent ?? statMap.winningPercentage ?? null,
          divisionRank: null,
          streak: statMap.streak ?? null,
          gamesBehind: statMap.gamesBehind ?? statMap.gamesBehindDivision ?? null,
          source: 'espn' as const,
        });
      }
      for (const child of (c.children as Record<string, unknown>[] | undefined) ?? [])
        visit(child, servedSeason);
    };
    visit(data, undefined);
    return verified ? standings : [];
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
