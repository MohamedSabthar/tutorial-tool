import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { RecorderEvent } from '@studio/core';
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

export const StepTiming = z.object({
  id: z.string(),
  title: z.string(),
  /** Seconds the step will take when recorded: product time measured in the dry run plus pacing. */
  recorded: z.number(),
  /** Clicks, typed fields and key presses. */
  actions: z.number(),
  /** Product waits of WAIT seconds or more, in order: what came before, and how long. */
  waits: z.array(z.object({ after: z.string(), seconds: z.number() })),
});
export type StepTiming = z.infer<typeof StepTiming>;

export const TimingFile = z.object({ at: z.number(), steps: z.array(StepTiming) });
export type TimingFile = z.infer<typeof TimingFile>;

/**
 * How long each step of a dry run will take when it is recorded. A dry run moves the pointer
 * instantly, types in one go and skips holds, so its step times are the product's own time (and
 * Playwright's). Recording adds the human pacing back: a pointer move per click (as long as the
 * recorder's own moves), typing at 14 characters a second, the pause after each action and every
 * hold. Gaps between actions are measured, so a slow product shows up as waits.
 */
export function estimateTimings(events: RecorderEvent[]): StepTiming[] {
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
      recorded: r1(end.t - s.t + extra),
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
