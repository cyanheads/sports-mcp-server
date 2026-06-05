/**
 * @fileoverview Shared normalized domain types for sports data aggregation.
 * @module services/types
 */

/** Routing configuration for a league: which ESPN path and MLB league IDs to use. */
export interface LeagueRoute {
  espnLeague: string;
  espnSport: string;
  mlbLeagueId: number[] | null;
}

/** A normalized game record from any source. */
export interface NormalizedGame {
  awayTeam: { id: string; name: string; abbreviation: string; score: string | null };
  clock: string | null;
  homeTeam: { id: string; name: string; abbreviation: string; score: string | null };
  id: string;
  period: number | null;
  shortName: string;
  source: 'espn' | 'mlbstats';
  startTimeUtc: string;
  status: 'scheduled' | 'in-progress' | 'final' | 'postponed' | 'cancelled';
  venue: string | null;
}

/** A normalized team record from any source. */
export interface NormalizedTeam {
  abbreviation: string;
  displayName: string;
  espnId: string | null;
  id: string;
  league: string;
  location: string;
  logoUrl: string | null;
  mlbId: number | null;
  name: string;
  source: 'espn' | 'mlbstats' | 'thesportsdb';
  tsdbId: string | null;
  venueId: string | null;
  venueName: string | null;
}

/** A normalized standings entry for a team in a league. */
export interface NormalizedStanding {
  divisionRank: string | null;
  gamesBehind: string | null;
  losses: number;
  points: number | null;
  rank: number;
  source: 'espn' | 'mlbstats';
  streak: string | null;
  team: { id: string; name: string; abbreviation: string };
  ties: number | null;
  winningPercentage: string | null;
  wins: number;
}

/** A normalized player record from TheSportsDB. */
export interface NormalizedPlayer {
  birthDate: string | null;
  description: string | null;
  espnId: string | null;
  height: string | null;
  id: string;
  name: string;
  nationality: string | null;
  position: string | null;
  source: 'thesportsdb';
  team: string | null;
  thumbnailUrl: string | null;
  tsdbId: string;
  weight: string | null;
}

/** League routing table — maps league enum values to ESPN/MLB routing info. */
export const LEAGUE_ROUTES: Record<string, LeagueRoute> = {
  nfl: { espnSport: 'football', espnLeague: 'nfl', mlbLeagueId: null },
  nba: { espnSport: 'basketball', espnLeague: 'nba', mlbLeagueId: null },
  mlb: { espnSport: 'baseball', espnLeague: 'mlb', mlbLeagueId: [103, 104] },
  nhl: { espnSport: 'hockey', espnLeague: 'nhl', mlbLeagueId: null },
  epl: { espnSport: 'soccer', espnLeague: 'eng.1', mlbLeagueId: null },
  mls: { espnSport: 'soccer', espnLeague: 'usa.1', mlbLeagueId: null },
  laliga: { espnSport: 'soccer', espnLeague: 'esp.1', mlbLeagueId: null },
  bundesliga: { espnSport: 'soccer', espnLeague: 'ger.1', mlbLeagueId: null },
  seriea: { espnSport: 'soccer', espnLeague: 'ita.1', mlbLeagueId: null },
  ligue1: { espnSport: 'soccer', espnLeague: 'fra.1', mlbLeagueId: null },
  ucl: { espnSport: 'soccer', espnLeague: 'uefa.champions', mlbLeagueId: null },
  ncaaf: { espnSport: 'football', espnLeague: 'college-football', mlbLeagueId: null },
  ncaab: { espnSport: 'basketball', espnLeague: 'mens-college-basketball', mlbLeagueId: null },
};

export const SUPPORTED_LEAGUES = Object.keys(LEAGUE_ROUTES) as [string, ...string[]];
