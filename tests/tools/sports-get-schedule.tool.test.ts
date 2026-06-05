/**
 * @fileoverview Tests for sports_get_schedule tool.
 * @module tests/tools/sports-get-schedule.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedGame, NormalizedTeam } from '@/services/types.js';

vi.mock('@/services/espn/espn-service.js', () => ({
  getEspnService: vi.fn(),
}));
vi.mock('@/services/mlb/mlb-service.js', () => ({
  getMlbService: vi.fn(),
}));

import { sportsGetSchedule } from '@/mcp-server/tools/definitions/sports-get-schedule.tool.js';
import { getEspnService } from '@/services/espn/espn-service.js';
import { getMlbService } from '@/services/mlb/mlb-service.js';

function makeGame(overrides: Partial<NormalizedGame> = {}): NormalizedGame {
  return {
    id: 'espn:500',
    shortName: 'SEA @ DAL',
    homeTeam: { id: 'espn:6', name: 'Dallas Cowboys', abbreviation: 'DAL', score: null },
    awayTeam: { id: 'espn:26', name: 'Seattle Seahawks', abbreviation: 'SEA', score: null },
    status: 'scheduled',
    period: null,
    clock: null,
    startTimeUtc: '2026-09-01T18:00:00Z',
    venue: 'AT&T Stadium',
    source: 'espn',
    ...overrides,
  };
}

function makeTeam(overrides: Partial<NormalizedTeam> = {}): NormalizedTeam {
  return {
    id: 'espn:26',
    espnId: '26',
    mlbId: null,
    tsdbId: null,
    name: 'Seahawks',
    abbreviation: 'SEA',
    location: 'Seattle',
    displayName: 'Seattle Seahawks',
    league: 'nfl',
    logoUrl: null,
    venueId: null,
    venueName: null,
    source: 'espn',
    ...overrides,
  };
}

describe('sportsGetSchedule', () => {
  const mockEspnSvc = {
    getTeams: vi.fn(),
    getTeamSchedule: vi.fn(),
    getScoreboard: vi.fn(),
  };
  const mockMlbSvc = {
    getTeams: vi.fn(),
    getSchedule: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEspnService).mockReturnValue(mockEspnSvc as ReturnType<typeof getEspnService>);
    vi.mocked(getMlbService).mockReturnValue(mockMlbSvc as ReturnType<typeof getMlbService>);
  });

  it('returns league-wide ESPN scoreboard when no team_name given', async () => {
    const game = makeGame();
    mockEspnSvc.getScoreboard.mockResolvedValue([game]);

    const ctx = createMockContext({ errors: sportsGetSchedule.errors });
    const input = sportsGetSchedule.input.parse({ league: 'nfl' });
    const result = await sportsGetSchedule.handler(input, ctx);

    expect(result.games).toHaveLength(1);
    expect(result.league).toBe('nfl');
    expect(mockEspnSvc.getScoreboard).toHaveBeenCalled();
  });

  it('filters to team schedule when team_name given (ESPN path)', async () => {
    const team = makeTeam();
    const game = makeGame();
    mockEspnSvc.getTeams.mockResolvedValue([team]);
    mockEspnSvc.getTeamSchedule.mockResolvedValue([game]);

    const ctx = createMockContext({ errors: sportsGetSchedule.errors });
    const input = sportsGetSchedule.input.parse({ league: 'nfl', team_name: 'Seahawks' });
    const result = await sportsGetSchedule.handler(input, ctx);

    expect(result.games).toHaveLength(1);
    expect(result.teamFilter).toBe('Seahawks');
    expect(mockEspnSvc.getTeamSchedule).toHaveBeenCalledWith('football', 'nfl', '26', null, ctx);
  });

  it('throws team_not_found when no ESPN team matches', async () => {
    mockEspnSvc.getTeams.mockResolvedValue([makeTeam()]);

    const ctx = createMockContext({ errors: sportsGetSchedule.errors });
    const input = sportsGetSchedule.input.parse({ league: 'nfl', team_name: 'NOMATCH' });

    await expect(sportsGetSchedule.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'team_not_found' },
    });
  });

  it('applies date_from / date_to filter', async () => {
    const earlyGame = makeGame({ startTimeUtc: '2026-05-01T18:00:00Z' });
    const lateGame = makeGame({ id: 'espn:501', startTimeUtc: '2026-09-15T18:00:00Z' });
    mockEspnSvc.getScoreboard.mockResolvedValue([earlyGame, lateGame]);

    const ctx = createMockContext({ errors: sportsGetSchedule.errors });
    const input = sportsGetSchedule.input.parse({
      league: 'nfl',
      date_from: '2026-09-01',
      date_to: '2026-12-31',
    });
    const result = await sportsGetSchedule.handler(input, ctx);

    expect(result.games).toHaveLength(1);
    expect(result.games[0].id).toBe('espn:501');
    expect(result.dateFrom).toBe('2026-09-01');
    expect(result.dateTo).toBe('2026-12-31');
  });

  it('routes MLB without team_name to mlb service today schedule', async () => {
    mockMlbSvc.getSchedule.mockResolvedValue([]);

    const ctx = createMockContext({ errors: sportsGetSchedule.errors });
    const input = sportsGetSchedule.input.parse({ league: 'mlb' });
    const result = await sportsGetSchedule.handler(input, ctx);

    expect(mockMlbSvc.getSchedule).toHaveBeenCalled();
    expect(result.games).toHaveLength(0);
  });

  it('formats output completely', () => {
    const result = {
      games: [makeGame({ status: 'final', period: 4, clock: '0:00' })],
      league: 'nfl',
      teamFilter: 'Seahawks',
      totalReturned: 1,
    };
    const blocks = sportsGetSchedule.format!(result);
    expect(blocks[0].type).toBe('text');
    const text = blocks[0].text;
    expect(text).toContain('espn:500');
    expect(text).toContain('SEA');
    expect(text).toContain('DAL');
    expect(text).toContain('final');
    expect(text).toContain('espn');
  });
});
