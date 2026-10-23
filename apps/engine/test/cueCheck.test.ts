import { describe, expect, it } from 'vitest';
import { Pace } from '@studio/core';
import { cueProblems, normalizeScript } from '../src/pipeline/cueCheck';
import { modelFor } from '../src/pipeline/machine';

const dry = `
await tut.step('s1', 'Open', async () => {
  // Opens the catalogue.
  await openArtifacts(ctx);
  await tut.hold(800);
});
await tut.step('s2', 'Create', async () => {
  await tut.click(create, { description: 'Create' });
  await tut.click(save);
});`;

// After narration and alignment: cues added, a hold changed, a comment added.
const cued = `
await tut.step('s1', 'Open', async () => {
  tut.cue('Add Artifact');
  await openArtifacts(ctx);
  await tut.hold(1500);
});
await tut.step('s2', 'Create', async () => {
  // Lands on the word.
  await tut.click(create, { description: 'Create', cue: 'Create' });
  await tut.click(save, { cue: 'save it' });
});`;

const pace = Pace.parse({
  leadIn: 0.25,
  clickGap: 0.6,
  tail: 0.35,
  steps: {
    s1: {
      text: 'Click Add Artifact.',
      duration: 1,
      words: [
        { w: 'Click', start: 0, end: 0.2 },
        { w: 'Add', start: 0.3, end: 0.5 },
        { w: 'Artifact.', start: 0.5, end: 0.9 },
      ],
    },
    s2: {
      text: 'Create it, then save it.',
      duration: 2,
      words: ['Create', 'it,', 'then', 'save', 'it.'].map((w, i) => ({
        w,
        start: i * 0.3,
        end: i * 0.3 + 0.25,
      })),
    },
  },
});

describe('checking cues without running the product', () => {
  it('sees a script that only gained cues and changed holds as the same script', () => {
    expect(normalizeScript(cued)).toBe(normalizeScript(dry));
    expect(normalizeScript(cued.replace('tut.click(save', 'tut.click(cancel'))).not.toBe(
      normalizeScript(dry),
    );
  });

  it('finds cues that are not words of their line, in order', () => {
    expect(cueProblems(cued, pace)).toEqual([]);
    expect(cueProblems(cued.replace("cue: 'save it'", "cue: 'Publish'"), pace)).toEqual([
      's2: cue "Publish" isn\'t in its line after the previous cue',
    ]);
    // A cue before an earlier one in the line is out of order.
    const swapped = cued
      .replace("cue: 'Create'", "cue: 'save it'")
      .replace("{ cue: 'save it' }", "{ cue: 'Create' }");
    expect(cueProblems(swapped, pace)).toHaveLength(1);
  });

  it('puts research and repairs on Opus and the writing on Sonnet when balanced', () => {
    expect(modelFor('plan', 'balanced')).toBe('claude-opus-5-5');
    expect(modelFor('repair', 'balanced')).toBe('claude-opus-5-5');
    expect(modelFor('narrate', 'balanced')).toBe('claude-sonnet-5-5');
    expect(modelFor('qa', 'balanced')).toBe('claude-sonnet-5-5');
    expect(modelFor('plan', 'sonnet')).toBe('claude-sonnet-5-5');
    expect(modelFor('narrate', 'opus')).toBe('claude-opus-5-5');
  });
});
