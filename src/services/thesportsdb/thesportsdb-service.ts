/**
 * @fileoverview TheSportsDB service — player and team metadata on the free public tier.
 * @module services/thesportsdb/thesportsdb-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import {
  McpError,
  requestCancelled,
  serviceUnavailable,
  timeout,
} from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { httpErrorFromResponse, withRetry } from '@cyanheads/mcp-ts-core/utils';
import { getServerConfig } from '../../config/server-config.js';
import type { NormalizedPlayer, NormalizedTeam } from '../types.js';

const TSDB_BASE = 'https://www.thesportsdb.com/api/v1/json';

export class TheSportsDbService {
  private get baseUrl(): string {
    return `${TSDB_BASE}/${getServerConfig().theSportsDbApiKey}`;
  }

  private fetchJson<T>(url: string, ctx: Context): Promise<T> {
    return withRetry(
      async ({ signal, remainingMs }) => {
        // The API key is a path segment; fetchWithTimeout logs paths before a caller can redact them.
        const controller = new AbortController();
        const timeoutMs = Math.min(10_000, remainingMs);
        const timeoutReason = new DOMException('TheSportsDB attempt timed out.', 'TimeoutError');
        const timer = setTimeout(() => controller.abort(timeoutReason), timeoutMs);
        const combined = AbortSignal.any([signal, controller.signal]);
        try {
          const response = await fetch(url, { signal: combined });
          if (!response.ok) {
            const error = await httpErrorFromResponse(response, {
              service: 'TheSportsDB',
              includeUrl: false,
            });
            // The HTTP helper tolerates unreadable bodies; an abort still ends this attempt.
            combined.throwIfAborted();
            const key = getServerConfig().theSportsDbApiKey;
            const scrub = (value: string) => value.replaceAll(key, '[redacted]');
            throw new McpError(
              error.code,
              scrub(error.message),
              Object.fromEntries(
                Object.entries(error.data ?? {}).map(([name, value]) => [
                  name,
                  typeof value === 'string' ? scrub(value) : value,
                ]),
              ),
            );
          }
          const text = await response.text();
          combined.throwIfAborted();
          if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
            throw serviceUnavailable(
              'TheSportsDB returned HTML instead of JSON — likely rate-limited.',
            );
          }
          try {
            return JSON.parse(text) as T;
          } catch {
            throw serviceUnavailable('TheSportsDB returned non-JSON response.');
          }
        } catch (error: unknown) {
          if (signal.aborted) {
            if (signal.reason?.name === 'TimeoutError') {
              throw timeout('TheSportsDB request reached its external deadline.', {
                errorSource: 'FetchSignalTimeout',
              });
            }
            throw requestCancelled('TheSportsDB request was cancelled.', {
              errorSource: 'FetchAborted',
            });
          }
          if (controller.signal.aborted) {
            throw timeout('TheSportsDB request timed out.', { errorSource: 'FetchTimeout' });
          }
          if (error instanceof McpError) throw error;
          // Native errors and their causes may carry the credential-bearing URL.
          throw serviceUnavailable('TheSportsDB network request failed.');
        } finally {
          clearTimeout(timer);
        }
      },
      {
        operation: 'TheSportsDbService.fetchJson',
        baseDelayMs: 500,
        signal: ctx.signal,
        deadlineMs: 30_000,
      },
    );
  }

  /** Search for teams by name. Returns null results for null teams field. */
  async searchTeams(name: string, ctx: Context): Promise<NormalizedTeam[]> {
    const url = `${this.baseUrl}/searchteams.php?t=${encodeURIComponent(name)}`;
    ctx.log.debug('TSDB team search', { name });

    const data = await this.fetchJson<{ teams?: unknown[] | null }>(url, ctx);
    if (!data.teams) return [];

    return data.teams.map((t) => this.normalizeTeam(t as Record<string, unknown>));
  }

  /** Lookup a team by its TSDB ID. */
  async lookupTeam(tsdbId: string, ctx: Context): Promise<NormalizedTeam | null> {
    const url = `${this.baseUrl}/lookupteam.php?id=${encodeURIComponent(tsdbId)}`;
    ctx.log.debug('TSDB team lookup', { tsdbId });

    const data = await this.fetchJson<{ teams?: unknown[] | null }>(url, ctx);
    if (!data.teams || data.teams.length === 0) return null;
    return this.normalizeTeam(data.teams[0] as Record<string, unknown>);
  }

  private normalizeTeam(t: Record<string, unknown>): NormalizedTeam {
    return {
      id: `tsdb:${String(t.idTeam ?? '')}`,
      espnId:
        t.idESPN != null && String(t.idESPN) !== '' && String(t.idESPN) !== '0'
          ? String(t.idESPN)
          : null,
      mlbId: null,
      tsdbId: String(t.idTeam ?? ''),
      name: String(t.strTeam ?? ''),
      abbreviation: String(t.strTeamShort ?? ''),
      location: String(t.strLocation ?? t.strCountry ?? ''),
      displayName: String(t.strTeam ?? ''),
      league: String(t.strLeague ?? ''),
      logoUrl:
        t.strTeamBadge != null && String(t.strTeamBadge) !== '' ? String(t.strTeamBadge) : null,
      venueId: t.idVenue != null ? String(t.idVenue) : null,
      venueName: t.strStadium != null && String(t.strStadium) !== '' ? String(t.strStadium) : null,
      source: 'thesportsdb' as const,
    };
  }

  /** Search for players by name. */
  async searchPlayers(name: string, ctx: Context): Promise<NormalizedPlayer[]> {
    const url = `${this.baseUrl}/searchplayers.php?p=${encodeURIComponent(name)}`;
    ctx.log.debug('TSDB player search', { name });

    const data = await this.fetchJson<{ player?: unknown[] | null }>(url, ctx);
    if (!data.player) return [];

    return data.player.map((p) => this.normalizePlayer(p as Record<string, unknown>));
  }

  /** Lookup a player by their TSDB numeric ID. */
  async lookupPlayer(playerId: string, ctx: Context): Promise<NormalizedPlayer | null> {
    const url = `${this.baseUrl}/lookupplayer.php?id=${encodeURIComponent(playerId)}`;
    ctx.log.debug('TSDB player lookup', { playerId });

    const data = await this.fetchJson<{ players?: unknown[] | string | null }>(url, ctx);

    // Detect the HTTP 200 error pattern: {"players": "Invalid Player ID passed"}
    if (typeof data.players === 'string') return null;
    if (!data.players || (data.players as unknown[]).length === 0) return null;

    return this.normalizePlayer((data.players as unknown[])[0] as Record<string, unknown>);
  }

  private normalizePlayer(p: Record<string, unknown>): NormalizedPlayer {
    const birthDate = p.dateBorn != null && String(p.dateBorn) !== '' ? String(p.dateBorn) : null;
    return {
      id: `tsdb:${String(p.idPlayer ?? '')}`,
      tsdbId: String(p.idPlayer ?? ''),
      espnId: null,
      name: String(p.strPlayer ?? ''),
      team: p.strTeam != null && String(p.strTeam) !== '' ? String(p.strTeam) : null,
      position:
        p.strPosition != null && String(p.strPosition) !== '' ? String(p.strPosition) : null,
      nationality:
        p.strNationality != null && String(p.strNationality) !== ''
          ? String(p.strNationality)
          : null,
      birthDate,
      height: p.strHeight != null && String(p.strHeight) !== '' ? String(p.strHeight) : null,
      weight: p.strWeight != null && String(p.strWeight) !== '' ? String(p.strWeight) : null,
      description:
        p.strDescriptionEN != null && String(p.strDescriptionEN) !== ''
          ? String(p.strDescriptionEN)
          : null,
      thumbnailUrl: p.strThumb != null && String(p.strThumb) !== '' ? String(p.strThumb) : null,
      source: 'thesportsdb' as const,
    };
  }
}

// --- Init/accessor pattern ---

let _service: TheSportsDbService | undefined;

export function initTheSportsDbService(_config: AppConfig, _storage: StorageService): void {
  _service = new TheSportsDbService();
}

export function getTheSportsDbService(): TheSportsDbService {
  if (!_service)
    throw new Error(
      'TheSportsDbService not initialized — call initTheSportsDbService() in setup()',
    );
  return _service;
}
