/**
 * @fileoverview Tests for sports_find_player tool.
 * @module tests/tools/sports-find-player.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedPlayer } from '@/services/types.js';

vi.mock('@/services/thesportsdb/thesportsdb-service.js', () => ({
  getTheSportsDbService: vi.fn(),
}));

import { sportsFindPlayer } from '@/mcp-server/tools/definitions/sports-find-player.tool.js';
import { getTheSportsDbService } from '@/services/thesportsdb/thesportsdb-service.js';

function makePlayer(overrides: Partial<NormalizedPlayer> = {}): NormalizedPlayer {
  return {
    id: 'tsdb:34185573',
    tsdbId: '34185573',
    espnId: null,
    name: 'Shohei Ohtani',
    team: 'Los Angeles Dodgers',
    position: 'Designated Hitter',
    nationality: 'Japanese',
    birthDate: '1994-07-05',
    height: '6\'4"',
    weight: '210 lbs',
    description: 'Two-way star pitcher and hitter.',
    thumbnailUrl: 'https://example.com/ohtani.jpg',
    source: 'thesportsdb',
    ...overrides,
  };
}

describe('sportsFindPlayer', () => {
  const mockTsdbSvc = { searchPlayers: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTheSportsDbService).mockReturnValue(
      mockTsdbSvc as ReturnType<typeof getTheSportsDbService>,
    );
  });

  it('returns matching players from TheSportsDB', async () => {
    const player = makePlayer();
    mockTsdbSvc.searchPlayers.mockResolvedValue([player]);

    const ctx = createMockContext({ errors: sportsFindPlayer.errors });
    const input = sportsFindPlayer.input.parse({ query: 'Shohei Ohtani' });
    const result = await sportsFindPlayer.handler(input, ctx);

    expect(result.players).toHaveLength(1);
    expect(result.players[0].name).toBe('Shohei Ohtani');
    expect(result.players[0].id).toBe('tsdb:34185573');
    expect(result.totalFound).toBe(1);
  });

  it('throws no_match when TheSportsDB returns empty results', async () => {
    mockTsdbSvc.searchPlayers.mockResolvedValue([]);

    const ctx = createMockContext({ errors: sportsFindPlayer.errors });
    const input = sportsFindPlayer.input.parse({ query: 'ZZZNONEXISTENT' });

    await expect(sportsFindPlayer.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'no_match' },
    });
  });

  it('handles sparse payload — player with no team or nationality', async () => {
    const sparsePlayer = makePlayer({
      team: null,
      nationality: null,
      position: null,
      birthDate: null,
      thumbnailUrl: null,
    });
    mockTsdbSvc.searchPlayers.mockResolvedValue([sparsePlayer]);

    const ctx = createMockContext({ errors: sportsFindPlayer.errors });
    const input = sportsFindPlayer.input.parse({ query: 'Ohtani' });
    const result = await sportsFindPlayer.handler(input, ctx);

    expect(result.players[0].team).toBeNull();
    expect(result.players[0].nationality).toBeNull();
  });

  it('formats output completely', () => {
    const result = {
      players: [
        {
          id: 'tsdb:34185573',
          tsdbId: '34185573',
          name: 'Shohei Ohtani',
          team: 'Los Angeles Dodgers',
          position: 'DH',
          nationality: 'Japanese',
          birthDate: '1994-07-05',
          thumbnailUrl: 'https://example.com/ohtani.jpg',
          source: 'thesportsdb' as const,
        },
      ],
      query: 'Shohei Ohtani',
      totalFound: 1,
    };
    const blocks = sportsFindPlayer.format!(result);
    expect(blocks[0].type).toBe('text');
    const text = blocks[0].text;
    expect(text).toContain('Shohei Ohtani');
    expect(text).toContain('tsdb:34185573');
    expect(text).toContain('34185573');
    expect(text).toContain('thesportsdb');
    expect(text).toContain('Japanese');
  });
});
