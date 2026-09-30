/**
 * @fileoverview Characterizes all seven formatters and their structured/text field parity.
 * @module tests/tools/formatting.test
 */

import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import type { AnyToolDefinition } from '@cyanheads/mcp-ts-core/tools';
import { describe, expect, it } from 'vitest';
import {
  sportsFindPlayer,
  sportsFindTeam,
  sportsGetPlayer,
  sportsGetSchedule,
  sportsGetScores,
  sportsGetStandings,
  sportsGetTeam,
} from '@/mcp-server/tools/definitions/index.js';

const team = {
  id: 'espn:26',
  espnId: '26',
  mlbId: 136,
  tsdbId: '42',
  name: 'Mariners',
  abbreviation: 'SEA',
  location: 'Seattle',
  displayName: 'Seattle Mariners',
  league: 'mlb',
  logoUrl: 'https://example.com/logo.png',
  venueName: 'T-Mobile Park',
  source: 'espn',
};
const player = {
  id: 'tsdb:12',
  tsdbId: '12',
  espnId: '17',
  name: 'A Player',
  team: 'Seattle Mariners',
  position: 'Pitcher',
  nationality: 'Japanese',
  birthDate: '1990-01-02',
  height: '190 cm',
  weight: '90 kg',
  description: 'A full biography.',
  thumbnailUrl: 'https://example.com/player.png',
  source: 'thesportsdb',
};
const game = {
  id: 'espn:123',
  shortName: 'SEA @ NYY',
  homeTeam: { id: 'espn:10', name: 'New York Yankees', abbreviation: 'NYY', score: '4' },
  awayTeam: { id: 'espn:26', name: 'Seattle Mariners', abbreviation: 'SEA', score: '3' },
  status: 'final',
  period: 9,
  clock: 'Bottom',
  startTimeUtc: '2026-07-04T23:00:00Z',
  venue: 'Yankee Stadium',
  source: 'espn',
};
const standing = {
  rank: 2,
  team: { id: 'mlb:136', name: 'Seattle Mariners', abbreviation: 'SEA' },
  wins: 90,
  losses: 72,
  ties: 1,
  points: 91,
  winningPercentage: '.555',
  divisionRank: '2',
  streak: 'W3',
  gamesBehind: '1.5',
  source: 'mlbstats',
};

const cases: Array<{
  tool: AnyToolDefinition;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  heading: string;
}> = [
  {
    tool: sportsFindPlayer,
    input: { query: 'Player' },
    output: { players: [player], query: 'Player', totalFound: 1 },
    heading: '**Player Search: "Player"** — 1 result(s)',
  },
  {
    tool: sportsFindTeam,
    input: { query: 'Seattle' },
    output: { teams: [team], query: 'Seattle', totalFound: 1 },
    heading: '**Team Search: "Seattle"** — 1 result(s)',
  },
  { tool: sportsGetPlayer, input: { player_id: '12' }, output: { player }, heading: '# A Player' },
  {
    tool: sportsGetTeam,
    input: { league: 'mlb', team_name: 'Seattle' },
    output: {
      team,
      roster: [{ name: 'A Player', position: 'P', jersey: '7' }],
      recentResults: [game],
      upcomingFixtures: [{ ...game, status: 'scheduled' }],
    },
    heading: '# Seattle Mariners (Mariners)',
  },
  {
    tool: sportsGetScores,
    input: { league: 'mlb' },
    output: { games: [game], date: '2026-07-04', league: 'mlb' },
    heading: '**MLB Scores — 2026-07-04** (league: mlb)',
  },
  {
    tool: sportsGetSchedule,
    input: { league: 'mlb' },
    output: {
      games: [game],
      league: 'mlb',
      teamFilter: 'Seattle',
      dateFrom: '2026-07-04',
      dateTo: '2026-07-05',
      totalReturned: 1,
    },
    heading: '**MLB Schedule** (league: mlb) — Seattle (2026-07-04 → 2026-07-05)',
  },
  {
    tool: sportsGetStandings,
    input: { league: 'mlb' },
    output: { standings: [standing], league: 'mlb', season: '2026', source: 'mlbstats' },
    heading: '**MLB 2026 Standings** (league: mlb, source: mlbstats)',
  },
];

function leaves(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (value && typeof value === 'object') return Object.values(value).flatMap(leaves);
  return [];
}

function multiline(value: unknown, key = ''): unknown {
  if (typeof value === 'string')
    return ['source', 'status', 'description'].includes(key)
      ? value
      : `${value}\r\nforged\rheading\nend`;
  if (Array.isArray(value)) return value.map((item) => multiline(item));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, multiline(item, name)]),
    );
  return value;
}

describe.each(cases)('$tool.name formatting', ({ tool, input, output, heading }) => {
  it('preserves ordinary text and every declared structured field', async () => {
    const parsed = tool.output.parse(output);
    const before = structuredClone(parsed);
    const response = await runToolContract({ ...tool, handler: async () => parsed }, input);
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toEqual(before);
    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n');
    expect(text.split('\n')[0]).toBe(heading);
    for (const value of leaves(before)) expect(text).toContain(value);
    expect(parsed).toEqual(before);
  });

  it('flattens CR/LF in every inline slot while structured values stay verbatim', async () => {
    const parsed = tool.output.parse(multiline(output));
    const before = structuredClone(parsed);
    const response = await runToolContract({ ...tool, handler: async () => parsed }, input);
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toEqual(before);
    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n');
    expect(text).not.toContain('\r');
    expect(text).not.toMatch(/\nforged|\nheading|\nend/);
    for (const value of leaves(before)) expect(text).toContain(value.replace(/\r\n|[\r\n]/g, ' '));
    expect(parsed).toEqual(before);
  });
});

it('fences the entire biography with a delimiter longer than embedded fences', async () => {
  const description =
    'Start\r\n```\n# forged heading\n````````\r~~quoted~~\n' + 'Full biography '.repeat(1000);
  const output = sportsGetPlayer.output.parse({ player: { ...player, description } });
  const response = await runToolContract(
    { ...sportsGetPlayer, handler: async () => output },
    { player_id: '12' },
  );
  expect(response.structuredContent).toMatchObject({ player: { description } });
  const text = response.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n');
  expect(text).toContain(`\n\`\`\`\`\`\`\`\`\`text\n${description}\n\`\`\`\`\`\`\`\`\`\n`);
});
