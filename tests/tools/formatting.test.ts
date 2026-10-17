/**
 * @fileoverview Characterizes all eight formatters and their structured/text field parity.
 * @module tests/tools/formatting.test
 */

import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import type { AnyToolDefinition } from '@cyanheads/mcp-ts-core/tools';
import { describe, expect, it } from 'vitest';
import {
  sportsFindPlayer,
  sportsFindTeam,
  sportsGetGame,
  sportsGetPlayer,
  sportsGetSchedule,
  sportsGetScores,
  sportsGetStandings,
  sportsGetTeam,
} from '@/mcp-server/tools/definitions/index.js';
import { inline } from '@/mcp-server/tools/formatting.js';

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
  group: 'American League West',
  overtimeLosses: null,
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
    tool: sportsGetGame,
    input: { league: 'mlb', game_id: 'espn:123' },
    output: {
      game,
      league: 'mlb',
      periodScores: [{ period: 1, label: 'First', homeScore: '0', awayScore: '1' }],
      teamStats: [{ team, statistics: [{ name: 'hits', label: 'Hits', value: '0' }] }],
      leaders: [
        {
          team,
          category: 'hits',
          label: 'Hits',
          player: { id: 'espn:42', name: 'A Player' },
          displayValue: '1',
        },
      ],
      scoringPlays: [
        {
          id: '1',
          period: 1,
          clock: 'Bottom',
          teamId: team.id,
          text: 'A scoring play.',
          homeScore: '0',
          awayScore: '1',
          participants: [{ id: 'espn:42', name: 'A Player' }],
        },
      ],
    },
    heading: '**MLB Scores — 2026-07-04** (league: mlb)',
  },
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
  it('renders markup as literal inline data without changing structured values', async () => {
    const marker = '<tag> & **bold** [link](url) `code` \\path ~~strike~~ ###';
    const escaped =
      '&lt;tag&gt; &amp; \\*\\*bold\\*\\* \\[link\\](url) \\`code\\` \\\\path \\~\\~strike\\~\\~ \\#\\#\\#';
    let slot = 0;
    function inject(value: unknown, key = ''): unknown {
      if (typeof value === 'string')
        return ['source', 'status', 'description'].includes(key)
          ? value
          : `${value} ${marker} slot${slot++}`;
      if (Array.isArray(value)) return value.map((v) => inject(v));
      if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, inject(v, k)]));
      return value;
    }
    const parsed = tool.output.parse(inject(output));
    const response = await runToolContract(
      { ...tool, enrichment: undefined, handler: async () => parsed },
      input,
    );
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toEqual(parsed);
    const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    expect(text).toContain(escaped);
    expect(text).not.toContain(marker);
    expect(text).not.toContain('&amp;lt;tag');
    for (const value of leaves(parsed).filter((value) => value.includes(marker))) {
      const literal = value.replace(marker, escaped);
      expect(text.includes(literal) || text.includes(literal.toUpperCase()), value).toBe(true);
    }
  });
  it('preserves ordinary text and every declared structured field', async () => {
    const parsed = tool.output.parse(output);
    const before = structuredClone(parsed);
    const response = await runToolContract(
      { ...tool, enrichment: undefined, handler: async () => parsed },
      input,
    );
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
    const response = await runToolContract(
      { ...tool, enrichment: undefined, handler: async () => parsed },
      input,
    );
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

it.each(['# forged', '- forged', '+ forged', '1. forged', '1) forged', '    forged', '\tforged'])(
  'keeps block punctuation in a game team name literal: %j',
  (name) => {
    const output = sportsGetGame.output.parse({
      ...cases[0]!.output,
      teamStats: [
        { team: { ...team, name }, statistics: [{ name: 'hits', label: 'Hits', value: '1' }] },
      ],
    });
    const text = sportsGetGame.format!(output)
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('\n');
    const line = text.split('\n').find((line) => line.endsWith('(SEA) [espn:26]'))!;
    expect(line).not.toMatch(/^(?: {0,3}(?:#+ |[-+] |\d+[.)] )| {4}|\t)/);
    expect(output.teamStats[0]!.team.name).toBe(name);
  },
);

it('preserves authored emphasis around whitespace at template joins', () => {
  expect(inline`**${' name '}**`).toBe('**&#32;name&#32;**');
  expect(inline`**${'\r\nname\r\n'}**`).toBe('**&#32;name&#32;**');
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

it('bounds inline escaping thread CPU across adversarial 64x spans', () => {
  const spans = [5000, 10000, 20000, 40000, 80000, 160000, 320000];
  for (const pattern of ['<>&*_[]`\\~', 'a\r\nb\rc\n<>&', '&lt;'.repeat(8)]) {
    const samples: number[] = [];
    for (const size of spans) {
      const value = pattern.repeat(Math.ceil(size / pattern.length)).slice(0, size);
      expect(inline`${value}`.length).toBeGreaterThan(0);
      const start = process.threadCpuUsage();
      for (let repeat = 0; repeat < 4; repeat++) expect(inline`${value}`.length).toBeGreaterThan(0);
      const cpu = process.threadCpuUsage(start);
      const micros = cpu.user + cpu.system;
      expect(micros).toBeLessThan(2_000_000);
      samples.push(micros);
    }
    expect(samples[6]! / Math.max(samples[0]!, 1)).toBeLessThan(256);
    console.info('inline thread CPU µs', JSON.stringify({ pattern, spans, samples }));
  }
});
