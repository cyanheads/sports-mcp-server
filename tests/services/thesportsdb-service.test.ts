/**
 * @fileoverview TheSportsDB normalization and empty-result characterization.
 * @module tests/services/thesportsdb-service.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TheSportsDbService } from '@/services/thesportsdb/thesportsdb-service.js';

describe('TheSportsDbService', () => {
  beforeEach(() =>
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('Unexpected fetch');
      }),
    ),
  );
  afterEach(() => vi.unstubAllGlobals());

  it.each([{ teams: null }, {}, { teams: [] }])('preserves empty teams %j', async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(body));
    await expect(
      new TheSportsDbService().searchTeams('Sea & Sound', createMockContext()),
    ).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('t=Sea%20%26%20Sound'),
      expect.anything(),
    );
  });

  it.each([{ players: null }, {}, { players: [] }, { players: 'Invalid Player ID passed' }])(
    'preserves missing player %j',
    async (body) => {
      vi.mocked(fetch).mockResolvedValueOnce(Response.json(body));
      await expect(
        new TheSportsDbService().lookupPlayer('123', createMockContext()),
      ).resolves.toBeNull();
    },
  );

  it('normalizes sparse players without losing biography text', async () => {
    const description = 'First paragraph.\r\nSecond paragraph.';
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        players: [{ idPlayer: '12', strPlayer: 'Player', strDescriptionEN: description }],
      }),
    );
    await expect(new TheSportsDbService().lookupPlayer('12', createMockContext())).resolves.toEqual(
      {
        id: 'tsdb:12',
        tsdbId: '12',
        espnId: null,
        name: 'Player',
        team: null,
        position: null,
        nationality: null,
        birthDate: null,
        height: null,
        weight: null,
        description,
        thumbnailUrl: null,
        source: 'thesportsdb',
      },
    );
  });

  it('normalizes team IDs and sparse metadata', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        teams: [{ idTeam: '42', idESPN: '0', strTeam: 'Team', strCountry: 'Country' }],
      }),
    );
    await expect(new TheSportsDbService().lookupTeam('42', createMockContext())).resolves.toEqual({
      id: 'tsdb:42',
      tsdbId: '42',
      espnId: null,
      mlbId: null,
      name: 'Team',
      displayName: 'Team',
      abbreviation: '',
      location: 'Country',
      league: '',
      logoUrl: null,
      venueId: null,
      venueName: null,
      source: 'thesportsdb',
    });
  });
});
