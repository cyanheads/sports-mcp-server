/**
 * @fileoverview Tests for sports_get_player tool.
 * @module tests/tools/sports-get-player.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedPlayer } from '@/services/types.js';

vi.mock('@/services/thesportsdb/thesportsdb-service.js', () => ({
  getTheSportsDbService: vi.fn(),
}));

import { sportsGetPlayer } from '@/mcp-server/tools/definitions/sports-get-player.tool.js';
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

describe('sportsGetPlayer', () => {
  const mockTsdbSvc = { lookupPlayer: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTheSportsDbService).mockReturnValue(
      mockTsdbSvc as ReturnType<typeof getTheSportsDbService>,
    );
  });

  it.each(['', '   '])('rejects blank player_id %j', (player_id) => {
    expect(sportsGetPlayer.input.safeParse({ player_id }).success).toBe(false);
  });

  it('returns player detail for a valid tsdb:-prefixed ID', async () => {
    const player = makePlayer();
    mockTsdbSvc.lookupPlayer.mockResolvedValue(player);

    const ctx = createMockContext({ errors: sportsGetPlayer.errors });
    const input = sportsGetPlayer.input.parse({ player_id: 'tsdb:34185573' });
    const result = await sportsGetPlayer.handler(input, ctx);

    expect(result.player.name).toBe('Shohei Ohtani');
    expect(result.player.id).toBe('tsdb:34185573');
    // Verify prefix was stripped when calling the service
    expect(mockTsdbSvc.lookupPlayer).toHaveBeenCalledWith('34185573', ctx);
  });

  it('accepts raw numeric ID without prefix', async () => {
    const player = makePlayer();
    mockTsdbSvc.lookupPlayer.mockResolvedValue(player);

    const ctx = createMockContext({ errors: sportsGetPlayer.errors });
    const input = sportsGetPlayer.input.parse({ player_id: '34185573' });
    await sportsGetPlayer.handler(input, ctx);

    expect(mockTsdbSvc.lookupPlayer).toHaveBeenCalledWith('34185573', ctx);
  });

  it('throws player_not_found when service returns null (invalid ID pattern)', async () => {
    // Simulates the HTTP 200 with {"players": "Invalid Player ID passed"} case
    mockTsdbSvc.lookupPlayer.mockResolvedValue(null);

    const ctx = createMockContext({ errors: sportsGetPlayer.errors });
    const input = sportsGetPlayer.input.parse({ player_id: 'tsdb:99999999' });

    await expect(sportsGetPlayer.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'player_not_found' },
    });
  });

  it('handles sparse player — missing optional fields', async () => {
    const sparsePlayer = makePlayer({
      height: null,
      weight: null,
      description: null,
      thumbnailUrl: null,
      espnId: null,
    });
    mockTsdbSvc.lookupPlayer.mockResolvedValue(sparsePlayer);

    const ctx = createMockContext({ errors: sportsGetPlayer.errors });
    const input = sportsGetPlayer.input.parse({ player_id: 'tsdb:34185573' });
    const result = await sportsGetPlayer.handler(input, ctx);

    expect(result.player.height).toBeNull();
    expect(result.player.description).toBeNull();
  });

  it('formats output completely', () => {
    const result = {
      player: {
        id: 'tsdb:34185573',
        tsdbId: '34185573',
        espnId: null,
        name: 'Shohei Ohtani',
        team: 'Los Angeles Dodgers',
        position: 'DH',
        nationality: 'Japanese',
        birthDate: '1994-07-05',
        height: '6\'4"',
        weight: '210 lbs',
        description: 'Two-way star.',
        thumbnailUrl: 'https://example.com/ohtani.jpg',
        source: 'thesportsdb' as const,
      },
    };
    const blocks = sportsGetPlayer.format!(result);
    expect(blocks[0].type).toBe('text');
    const text = blocks[0].text;
    expect(text).toContain('Shohei Ohtani');
    expect(text).toContain('tsdb:34185573');
    expect(text).toContain('34185573');
    expect(text).toContain('thesportsdb');
    expect(text).toContain('Los Angeles Dodgers');
    expect(text).toContain('Two-way star');
  });

  it('preserves a long biography on structured and formatted consumption paths', async () => {
    const description = 'A'.repeat(1001);
    mockTsdbSvc.lookupPlayer.mockResolvedValue(makePlayer({ description }));

    const ctx = createMockContext({ errors: sportsGetPlayer.errors });
    const input = sportsGetPlayer.input.parse({ player_id: 'tsdb:34185573' });
    const result = await sportsGetPlayer.handler(input, ctx);
    const blocks = sportsGetPlayer.format!(result);

    expect(result.player.description).toBe(description);
    expect(blocks[0].text).toContain(description);
    expect(blocks[0].text).not.toContain(`${'A'.repeat(1000)}…`);
  });
});
