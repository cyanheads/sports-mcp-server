/**
 * @fileoverview Deterministic single-team selection shared by team and schedule tools.
 * @module services/team-resolver
 */
import type { NormalizedTeam } from './types.js';

/** Prefer exact full names/abbreviations, otherwise retain every partial-name candidate. */
export function teamCandidates(teams: NormalizedTeam[], selector: string): NormalizedTeam[] {
  const query = selector.trim().toLowerCase();
  const exact = teams.filter(
    (team) => team.displayName.toLowerCase() === query || team.abbreviation.toLowerCase() === query,
  );
  return exact.length
    ? exact
    : teams.filter(
        (team) =>
          team.name.toLowerCase().includes(query) ||
          team.displayName.toLowerCase().includes(query) ||
          team.location.toLowerCase().includes(query),
      );
}

/** Candidate details fit both the structured error and the recovery message. */
export function ambiguityDetails(candidates: NormalizedTeam[]) {
  const records = candidates.map((team) => ({
    name: team.displayName,
    abbreviation: team.abbreviation,
    id: team.id,
  }));
  return {
    candidates: records,
    recovery: {
      hint: `Choose an exact full name or abbreviation: ${records.map((team) => `${team.name} (${team.abbreviation}) [${team.id}]`).join('; ')}.`,
    },
  };
}
