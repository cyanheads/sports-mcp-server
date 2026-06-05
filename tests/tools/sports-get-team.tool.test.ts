/**
 * @fileoverview Tests for sports_get_team tool.
 * @module tests/tools/sports-get-team.tool.test
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

import { sportsGetTeam } from '@/mcp-server/tools/definitions/sports-get-team.tool.js';
import { getEspnService } from '@/services/espn/espn-service.js';
import { getMlbService } from '@/services/mlb/mlb-service.js';

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
    venueName: 'Lumen Field',
    source: 'espn',
    ...overrides,
  };
}

function makeGame(overrides: Partial<NormalizedGame> = {}): NormalizedGame {
  return {
    id: 'espn:500',
    shortName: 'SEA @ DAL',
    homeTeam: { id: 'espn:6', name: 'Dallas Cowboys', abbreviation: 'DAL', score: null },
    awayTeam: { id: 'espn:26', name: 'Seattle Seahawks', abbreviation: 'SEA', score: null },
    status: 'scheduled',
    period: null,
    clock: null,
    startTimeUtc: `${new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 16)}:00Z`,
    venue: 'AT&T Stadium',
    source: 'espn',
    ...overrides,
  };
}

describe('sportsGetTeam', () => {
  const mockEspnSvc = {
    getTeams: vi.fn(),
    getTeamDetail: vi.fn(),
    getTeamRoster: vi.fn(),
    getTeamSchedule: vi.fn(),
  };
  const mockMlbSvc = {
    getTeams: vi.fn(),
    getTeamRoster: vi.fn(),
    getSchedule: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEspnService).mockReturnValue(mockEspnSvc as ReturnType<typeof getEspnService>);
    vi.mocked(getMlbService).mockReturnValue(mockMlbSvc as ReturnType<typeof getMlbService>);
  });

  it('returns team detail with roster and fixtures (ESPN path)', async () => {
    const team = makeTeam();
    const upcomingGame = makeGame();
    mockEspnSvc.getTeams.mockResolvedValue([team]);
    mockEspnSvc.getTeamDetail.mockResolvedValue(team);
    mockEspnSvc.getTeamRoster.mockResolvedValue([
      { position: 'QB', name: 'Geno Smith', jersey: '7' },
    ]);
    mockEspnSvc.getTeamSchedule.mockResolvedValue([upcomingGame]);

    const ctx = createMockContext({ errors: sportsGetTeam.errors });
    const input = sportsGetTeam.input.parse({ league: 'nfl', team_name: 'Seahawks' });
    const result = await sportsGetTeam.handler(input, ctx);

    expect(result.team.name).toBe('Seahawks');
    expect(result.roster).toHaveLength(1);
    expect(result.roster[0].name).toBe('Geno Smith');
    expect(result.upcomingFixtures).toHaveLength(1);
  });

  it('throws team_not_found when ESPN team search yields nothing', async () => {
    mockEspnSvc.getTeams.mockResolvedValue([
      makeTeam({ name: 'Cowboys', displayName: 'Dallas Cowboys', abbreviation: 'DAL' }),
    ]);

    const ctx = createMockContext({ errors: sportsGetTeam.errors });
    const input = sportsGetTeam.input.parse({ league: 'nfl', team_name: 'NOMATCH_XYZ' });

    await expect(sportsGetTeam.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'team_not_found' },
    });
  });

  it('formats output completely', () => {
    const result = {
      team: {
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
        venueName: 'Lumen Field',
        source: 'espn' as const,
      },
      roster: [{ name: 'Geno Smith', position: 'QB', jersey: '7' }],
      recentResults: [],
      upcomingFixtures: [makeGame()],
    };
    const blocks = sportsGetTeam.format!(result);
    expect(blocks[0].type).toBe('text');
    const text = blocks[0].text;
    expect(text).toContain('Seattle Seahawks');
    expect(text).toContain('espn:26');
    expect(text).toContain('Geno Smith');
    expect(text).toContain('QB');
    expect(text).toContain('espn:500');
  });
});
