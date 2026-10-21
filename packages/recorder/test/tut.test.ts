import { describe, expect, it } from 'vitest';
import type { Locator, Page } from 'playwright';
import type { Pace, RecorderEvent } from '@studio/core';
import { StepFailedError, Tut } from '../src/tut';

/** Just enough of a Playwright page for tut: a mouse, a keyboard and fixed boxes. */
function fakePage(): Page {
  const body = { ariaSnapshot: async () => '' };
  const frame = { first: () => frame, frameLocator: () => frame, locator: () => body };
  return {
    viewportSize: () => ({ width: 1200, height: 800 }),
    mouse: { move: async () => {}, click: async () => {} },
    keyboard: { press: async () => {}, type: async () => {}, insertText: async () => {} },
    screenshot: async () => Buffer.alloc(0),
    locator: () => body,
    frameLocator: () => frame,
  } as unknown as Page;
}

function button(x: number): Locator {
  const loc = {
    first: () => loc,
    waitFor: async () => {},
    scrollIntoViewIfNeeded: async () => {},
    boundingBox: async () => ({ x, y: 100, width: 80, height: 24 }),
  };
  return loc as unknown as Locator;
}

const words = (text: string, gap: number) =>
  text.split(' ').map((w, i) => ({ w, start: i * gap, end: i * gap + gap * 0.8 }));

const pace: Pace = {
  leadIn: 0.25,
  clickGap: 0.6,
  tail: 0.35,
  steps: {
    s1: {
      text: 'Open the menu and choose Create now',
      duration: 1.4,
      words: words('Open the menu and choose Create now', 0.2),
    },
  },
};

const at = <K extends RecorderEvent['kind']>(events: RecorderEvent[], kind: K) =>
  events.filter((e): e is Extract<RecorderEvent, { kind: K }> => e.kind === kind);

describe('Tut pacing (voice-first recording)', () => {
  it('lands cued actions on their words and holds the step until its line is spoken', async () => {
    const tut = new Tut({ page: fakePage(), mode: 'record', scale: 1, pace });
    await tut.start();
    await tut.step('s1', 'Create it', async () => {
      await tut.click(button(100), { description: 'Menu', cue: 'menu' });
      tut.cue('Create');
      await tut.click(button(700), { description: 'Create' });
      await tut.press('Enter');
    });
    const [start] = at(tut.events, 'step-start');
    const [end] = at(tut.events, 'step-end');
    const clicks = at(tut.events, 'click');
    const line = start!.t + 0.25;
    expect(clicks.map((c) => c.cue?.word)).toEqual(['menu', 'Create']);
    // "menu" is word 2 and "Create" word 5 of the line, 0.2 s apart.
    expect(clicks[0]!.cue!.at).toBeCloseTo(line + 0.4, 2);
    expect(clicks[1]!.cue!.at).toBeCloseTo(line + 1.0, 2);
    for (const c of clicks) expect(Math.abs(c.t - c.cue!.at)).toBeLessThan(0.08);
    expect(at(tut.events, 'key')[0]!.cue).toBeUndefined();
    expect(end!.t).toBeGreaterThanOrEqual(line + 1.4 + 0.35 - 0.01);
  });

  it('fails the step when a cue is not in its narration, in dry runs too', async () => {
    const tut = new Tut({ page: fakePage(), mode: 'dry', scale: 1, pace });
    await tut.start();
    const run = tut.step('s1', 'Create it', async () => {
      await tut.click(button(100), { cue: 'Create' });
      tut.cue('menu'); // before "Create": out of order
    });
    await expect(run).rejects.toBeInstanceOf(StepFailedError);
    await expect(run).rejects.toThrow(/cue "menu" is not in the narration of step s1 after the previous cue/);
  });

  it('ignores cues without a pace and in steps without a line', async () => {
    const tut = new Tut({ page: fakePage(), mode: 'dry', scale: 1 });
    await tut.start();
    await tut.step('s9', 'Other', async () => {
      tut.cue('anything');
      await tut.click(button(100), { cue: 'whatever' });
    });
    expect(at(tut.events, 'click')[0]!.cue).toBeUndefined();
  });
});
