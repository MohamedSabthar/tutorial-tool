import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RecorderEvent } from '@studio/core';
import {
  calibrationFactor,
  checkLine,
  checkTimings,
  estimateTimings,
  readCalibration,
  readTimings,
  recordCalibration,
  saveTimings,
  timingLines,
} from '../src/stepTiming';

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

  it('scales the estimate by the workspace calibration', () => {
    const [plain] = estimateTimings(events);
    const [scaled] = estimateTimings(events, 1.2);
    expect(scaled!.recorded).toBeCloseTo(plain!.recorded * 1.2, 0);
  });

  it('checks recordings against the estimate on steps longer than their line, and calibrates', async () => {
    const take = RecorderEvent.array().parse([
      { kind: 'step-start', t: 0, stepId: 's1', title: 'One' },
      { kind: 'step-end', t: 24, stepId: 's1' },
      { kind: 'step-start', t: 24, stepId: 's2', title: 'Two' },
      { kind: 'step-end', t: 30, stepId: 's2' },
    ]);
    const estimates = [
      { id: 's1', title: 'One', recorded: 20, actions: 5, waits: [] },
      { id: 's2', title: 'Two', recorded: 4, actions: 1, waits: [] },
    ];
    // s2 lasted as long as its 6 s line, so it says nothing about the action.
    const checks = checkTimings(estimates, take, { s1: 8, s2: 6 });
    expect(checks).toEqual([{ stepId: 's1', estimated: 20, actual: 24 }]);
    expect(checkLine(checks)).toBe('timing estimate 20% short');
    expect(checkLine([{ stepId: 's1', estimated: 20, actual: 20.5 }])).toBe('timing estimate on target');

    expect(calibrationFactor([1.2, 1.2])).toBe(1); // too few to trust
    expect(calibrationFactor([1.1, 1.3, 1.2])).toBe(1.2);
    expect(calibrationFactor([3, 3, 3])).toBe(1.6);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'calib-'));
    try {
      for (let i = 0; i < 3; i++) await recordCalibration(dir, checks);
      expect(await readCalibration(dir)).toEqual({ ratios: [1.2, 1.2, 1.2], factor: 1.2 });
      // Estimates made with the factor compare as raw ratios: 24 s against 24 s estimated is 1.2.
      await recordCalibration(dir, [{ stepId: 's1', estimated: 24, actual: 24 }]);
      expect((await readCalibration(dir)).ratios.at(-1)).toBe(1.2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
