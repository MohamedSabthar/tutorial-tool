import { findCue, type Pace } from '@studio/core';
import { scriptOutline } from './scriptOutline';

/** The script that last passed a full dry run, normalised (see normalizeScript). */
export const DRY_SCRIPT = '.studio/dry-script.txt';

/**
 * A script with its cues and hold lengths taken out (and comments and spacing ignored): two
 * scripts that normalise the same do the same things on screen, only paced differently.
 */
export function normalizeScript(text: string): string {
  return text
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/tut\.cue\(\s*(['"`])(?:(?!\1).)*\1\s*\)\s*;?/g, '')
    .replace(/,?\s*\bcue:\s*(['"`])(?:(?!\1).)*\1/g, '')
    .replace(/,\s*\{\s*\}\s*\)/g, ')')
    .replace(/tut\.hold\(\s*\d+\s*\)/g, 'tut.hold(#)')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * What the recorder would reject about the script's cues, without running it: each cue must be
 * a word (or phrase) of its step's voiced line, after the previous cue of that step. Empty when
 * every cue is fine.
 */
export function cueProblems(text: string, pace: Pace): string[] {
  const problems: string[] = [];
  for (const [id, { cues }] of Object.entries(scriptOutline(text))) {
    if (!cues.length) continue;
    const line = pace.steps[id];
    if (!line) {
      problems.push(`${id} has cues but no voiced line`);
      continue;
    }
    let next = 0;
    for (const cue of cues) {
      const i = findCue(line.words, cue, next);
      if (i < 0)
        problems.push(`${id}: cue "${cue}" isn't in its line${next ? ' after the previous cue' : ''}`);
      else next = i + 1;
    }
  }
  return problems;
}
