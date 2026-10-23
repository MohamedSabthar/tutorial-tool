import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RecorderEvent } from '@studio/core';
import { estimateTimings, readTimings, saveTimings, timingLines } from '../src/stepTiming';

const bbox = { x: 400, y: 300, w: 80, h: 40 };

describe('dry-run step timings', () => {
  // A dry run: no pointer travel, typing in one go, a 1.5 s hold, a 9 s build after Create.
  const events = RecorderEvent.array().parse([
    { kind: 'marker', t: 0, name: 'start', data: { mode: 'dry', scale: 2 } },
    { kind: 'step-start', t: 0, stepId: 's1', title: 'Create it' },
    { kind: 'click', t: 0.4, stepId: 's1', x: 440, y: 320, target: 'Create', bbox },
    { kind: 'type', t: 9.6, stepId: 's1', text: 'math-tutor', target: 'Name', bbox },
    { kind: 'hold', t: 9.7, stepId: 's1', duration: 1.5 },
    { kind: 'key', t: 9.8, stepId: 's1', key: 'Enter' },
    { kind: 'step-end', t: 10, stepId: 's1' },
  ]);

  it('adds the pacing a dry run skips and finds the product waits', () => {
    const [s1] = estimateTimings(events);
    expect(s1).toMatchObject({ id: 's1', actions: 3, waits: [{ after: 'clicking Create', seconds: 9.2 }] });
    // 10 s measured + two pointer moves and pauses + 10 characters typed + the hold + a key.
    expect(s1!.recorded).toBeGreaterThan(10 + 1.5 + 10 / 14);
    expect(s1!.recorded).toBeLessThan(16);
    expect(timingLines([s1!])).toMatch(
      /^- s1 Create it: about 1\d s on camera, 3 actions; product waits: 9\.2 s after clicking Create$/,
    );
  });

  it('keeps the latest timings with the project', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'timing-'));
    try {
      expect(await readTimings(dir)).toBeNull();
      await saveTimings(dir, estimateTimings(events));
      expect((await readTimings(dir))!.steps[0]!.id).toBe('s1');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
