import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { TimingFile, type RecorderEvent, type StepTiming } from '@studio/core';
import { moveDuration, type Pt } from '@studio/recorder/node';

/** A gap with no input at least this long is the product working (a build, a start-up). */
export const WAIT = 2;
/** Recorded pacing the dry run skips (see tut.ts): pauses after a click, a typed field, a key. */
const CLICK_PAUSE = 0.35;
const TYPE_PAUSE = 0.3;
const KEY_PAUSE = 0.25;
/** Human typing speed, with the longer pauses at spaces and punctuation. */
const TYPE_CPS = 14 / 1.1;

type Act = Extract<RecorderEvent, { kind: 'click' | 'type' | 'key' | 'hold' }>;

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * How long each step of a dry run will take when it is recorded. A dry run moves the pointer
 * instantly, types in one go and skips holds, so its step times are the product's own time (and
 * Playwright's). Recording adds the human pacing back: a pointer move per click (as long as the
 * recorder's own moves), typing at 14 characters a second, the pause after each action and every
 * hold. Gaps between actions are measured, so a slow product shows up as waits.
 */
export function estimateTimings(events: RecorderEvent[], factor = 1): StepTiming[] {
  const start = events.find((e) => e.kind === 'marker' && e.name === 'start');
  const scale = start?.kind === 'marker' && typeof start.data?.scale === 'number' ? start.data.scale : 1;
  const out: StepTiming[] = [];
  let pointer: Pt = { x: 0, y: 0 };
  for (const s of events) {
    if (s.kind !== 'step-start') continue;
    const end = events.find((e) => e.kind === 'step-end' && e.stepId === s.stepId);
    if (!end) continue;
    const own = events.filter(
      (e): e is Act =>
        (e.kind === 'click' || e.kind === 'type' || e.kind === 'key' || e.kind === 'hold') &&
        e.stepId === s.stepId,
    );
    let extra = 0;
    let actions = 0;
    const waits: StepTiming['waits'] = [];
    let last = s.t;
    let lastLabel = 'the step starts';
    for (const e of own) {
      if (e.kind === 'hold') {
        extra += e.duration;
        continue;
      }
      // In a dry run a typed field's event comes before the text goes in; the gap before it is
      // the product's.
      const gap = e.t - last;
      if (gap >= WAIT) waits.push({ after: lastLabel, seconds: r1(gap) });
      actions++;
      if (e.kind === 'click' || e.kind === 'type') {
        const box = e.bbox;
        const p = { x: (box.x + box.w / 2) / scale, y: (box.y + box.h / 2) / scale };
        extra += moveDuration(pointer, p) / 1000 + CLICK_PAUSE;
        pointer = p;
      }
      if (e.kind === 'type') extra += e.text.length / TYPE_CPS + TYPE_PAUSE;
      if (e.kind === 'key') extra += KEY_PAUSE;
      last = e.t;
      lastLabel =
        e.kind === 'click'
          ? `clicking ${e.target}`
          : e.kind === 'type'
            ? `typing into ${e.target}`
            : `pressing ${e.key}`;
    }
    if (end.t - last >= WAIT) waits.push({ after: lastLabel, seconds: r1(end.t - last) });
    out.push({
      id: s.stepId,
      title: s.title,
      recorded: r1((end.t - s.t + extra) * factor),
      actions,
      waits,
    });
  }
  return out;
}

const file = (projectDir: string) => path.join(projectDir, '.studio', 'timing.json');

/** Saves the step timings of the latest passing dry run. */
export async function saveTimings(projectDir: string, steps: StepTiming[]): Promise<void> {
  await mkdir(path.dirname(file(projectDir)), { recursive: true });
  await writeFile(file(projectDir), JSON.stringify({ at: Date.now(), steps }, null, 2) + '\n');
}

/** The step timings of the latest passing dry run, or null. */
export async function readTimings(projectDir: string): Promise<TimingFile | null> {
  try {
    return TimingFile.parse(JSON.parse(await readFile(file(projectDir), 'utf8')));
  } catch {
    return null;
  }
}

/** One line per step for the agent: how long it runs and where the product makes it wait. */
export function timingLines(steps: StepTiming[]): string {
  return steps
    .map((s) => {
      const waits = s.waits.length
        ? `; product waits: ${s.waits.map((w) => `${w.seconds} s after ${w.after}`).join(', ')}`
        : '';
      return `- ${s.id} ${s.title}: about ${Math.round(s.recorded)} s on camera, ${s.actions} action${s.actions === 1 ? '' : 's'}${waits}`;
    })
    .join('\n');
}

/** How far the estimate was from a recording, for steps whose action outlasted their line. */
export interface TimingCheck {
  stepId: string;
  estimated: number;
  actual: number;
}

/**
 * Compares a recording's steps with the dry-run estimates. In a paced take a step lasts at
 * least its line, so only steps that ran longer than their line plus a second show how long
 * the action really took.
 */
export function checkTimings(
  estimates: StepTiming[],
  events: RecorderEvent[],
  lineSeconds: Record<string, number> = {},
): TimingCheck[] {
  const out: TimingCheck[] = [];
  for (const s of events) {
    if (s.kind !== 'step-start') continue;
    const end = events.find((e) => e.kind === 'step-end' && e.stepId === s.stepId);
    const est = estimates.find((x) => x.id === s.stepId);
    if (!end || !est || est.recorded < 3) continue;
    const actual = end.t - s.t;
    if (actual <= (lineSeconds[s.stepId] ?? 0) + 1) continue;
    out.push({ stepId: s.stepId, estimated: est.recorded, actual: r1(actual) });
  }
  return out;
}

/** Median of actual ÷ estimated over a workspace's recent recordings, kept within 0.7–1.6. */
export const CALIBRATION_KEEP = 40;
const calibrationFile = (workspaceRoot: string) =>
  path.join(workspaceRoot, '.studio', 'timing-calibration.json');

export async function readCalibration(workspaceRoot: string): Promise<{ ratios: number[]; factor: number }> {
  try {
    const ratios = z
      .object({ ratios: z.array(z.number().positive()) })
      .parse(JSON.parse(await readFile(calibrationFile(workspaceRoot), 'utf8'))).ratios;
    return { ratios, factor: calibrationFactor(ratios) };
  } catch {
    return { ratios: [], factor: 1 };
  }
}

export function calibrationFactor(ratios: number[]): number {
  if (ratios.length < 3) return 1;
  const sorted = [...ratios].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median = sorted.length % 2 ? sorted[Math.floor(mid)]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(Math.min(1.6, Math.max(0.7, median)) * 100) / 100;
}

/**
 * Adds a recording's checks to the workspace calibration. The checks compare with estimates
 * that already had the old factor applied, so their ratios are scaled back to raw ones.
 */
export async function recordCalibration(workspaceRoot: string, checks: TimingCheck[]): Promise<number> {
  const { ratios, factor } = await readCalibration(workspaceRoot);
  const next = [
    ...ratios,
    ...checks.map((c) => Math.round((c.actual / c.estimated) * factor * 1000) / 1000),
  ].slice(-CALIBRATION_KEEP);
  await mkdir(path.dirname(calibrationFile(workspaceRoot)), { recursive: true });
  await writeFile(calibrationFile(workspaceRoot), JSON.stringify({ ratios: next }, null, 2) + '\n');
  return calibrationFactor(next);
}

/** "estimate 12% short" style summary of a recording's checks, or null without any. */
export function checkLine(checks: TimingCheck[]): string | null {
  if (!checks.length) return null;
  const est = checks.reduce((n, c) => n + c.estimated, 0);
  const act = checks.reduce((n, c) => n + c.actual, 0);
  const off = Math.round(((act - est) / est) * 100);
  return Math.abs(off) < 5
    ? 'timing estimate on target'
    : `timing estimate ${Math.abs(off)}% ${off > 0 ? 'short' : 'long'}`;
}
