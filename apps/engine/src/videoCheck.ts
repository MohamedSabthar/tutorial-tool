import { buildTimeMap, voiceSpans, type RecorderEvent, type Timeline } from '@studio/core';
import { contactSheet } from './overlayCheck';
import { CUE_TOLERANCE, leftoversLine } from './pace';
import type { HeadlessStage } from './render';

/** The longest caption line a viewer reads comfortably, and the shortest time it's on screen. */
const CAPTION_CHARS = 42;
const CAPTION_MIN_S = 0.8;
/** Silence after a line, at normal speed, that a viewer notices (seconds). */
const SILENCE_S = 3;
/** Fast-forward after a line longer than this is worth narrating or cutting (seconds). */
const FAST_FORWARD_S = 12;
/** Frames per contact sheet (3 a row). */
const SHEET = 12;

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

export interface VideoCheckResult {
  /** Problems found without looking: voice overlaps, silences, cue drift, leftovers, captions. */
  issues: string[];
  /** The frames rendered, in order, with what each shows. */
  frames: { t: number; label: string }[];
  /** Contact sheets of those frames (JPEG), up to 12 frames each. */
  sheets: Buffer[];
}

/**
 * Final QA of the rendered video: what can be checked from the timeline and the take's events,
 * plus composited frames (overlays, captions, camera) at the start and end of every step and at
 * every click, for the agent to look at.
 */
export async function checkVideo(opts: {
  slug: string;
  timeline: Timeline;
  events: RecorderEvent[];
  stage: Pick<HeadlessStage, 'render'>;
}): Promise<VideoCheckResult> {
  const tl = opts.timeline;
  const tm = buildTimeMap(tl);
  const take = tl.takes.at(-1);
  const out = (t: number) => (take ? (tm.toOutput(take.id, t)[0] ?? null) : null);
  const issues: string[] = [];

  // Voice: every narrated step has a line, and no line runs into the next step.
  const spans = voiceSpans(tl, tm);
  const starts = tl.steps
    .map((s) => ({ s, at: tm.toOutput(s.take, s.from)[0] ?? null }))
    .filter((x): x is { s: (typeof tl.steps)[number]; at: number } => x.at !== null)
    .sort((a, b) => a.at - b.at);
  for (const [i, { s }] of starts.entries()) {
    const span = spans.find((x) => x.line.owner === s.id);
    if (s.narration.trim() && !span)
      issues.push(`${s.id}: has narration but no voice line (regenerate the voice-over)`);
    const next = starts[i + 1]?.at ?? tm.duration;
    if (span && span.end > next + 0.05)
      issues.push(
        `${s.id}: its voice runs ${(span.end - next).toFixed(2)} s into the next step (at ${fmt(next)})`,
      );
    // The picture running on after the line in silence: at normal speed, or fast-forwarded.
    if (span && next - span.end > SILENCE_S) {
      let fast = 0;
      for (const g of tm.segments) {
        if (g.segment.kind !== 'speed' || g.segment.rate < 2) continue;
        fast += Math.max(0, Math.min(g.end, next) - Math.max(g.start, span.end));
      }
      const still = next - span.end - fast;
      if (still > SILENCE_S)
        issues.push(
          `${s.id}: ${still.toFixed(1)} s with no voice after its line (${fmt(span.end)}–${fmt(next)}); fit the timing again, or narrate what happens there`,
        );
      if (fast > FAST_FORWARD_S)
        issues.push(
          `${s.id}: ${fast.toFixed(1)} s fast-forwarded after its line (from ${fmt(span.end)}); narrate it, or cut what the viewer doesn't need to see`,
        );
    }
  }

  // Clicks off their words, and anything left open at a step's end.
  for (const e of opts.events)
    if ((e.kind === 'click' || e.kind === 'key') && e.cue && Math.abs(e.t - e.cue.at) > CUE_TOLERANCE)
      issues.push(
        `${e.stepId}: "${e.cue.word}" ${e.t > e.cue.at ? 'late' : 'early'} by ${Math.round(Math.abs(e.t - e.cue.at) * 1000)} ms`,
      );
  const left = leftoversLine(opts.events);
  if (left) issues.push(left);

  // Captions a viewer can read.
  if (tl.showCaptions)
    for (const c of tl.captions) {
      const lines = c.text.split('\n');
      if (lines.length > 2 || lines.some((l) => l.length > CAPTION_CHARS))
        issues.push(
          `caption at ${fmt(c.start)} is too long to read ("${c.text.replace(/\n/g, ' / ').slice(0, 60)}")`,
        );
      if (c.end - c.start < CAPTION_MIN_S)
        issues.push(`caption at ${fmt(c.start)} is on screen for only ${(c.end - c.start).toFixed(2)} s`);
    }

  // Frames to look at: each step's start and end, and every click and key press.
  const frames: { t: number; label: string }[] = [];
  for (const { s, at } of starts) {
    // A step that ends with the take has no output time at its very end: use just before it.
    const end = out(s.to) ?? out(Math.max(s.from, s.to - 0.05)) ?? at;
    frames.push({ t: Math.min(at + 0.4, end), label: `${s.id} start` });
    for (const e of opts.events) {
      if ((e.kind !== 'click' && e.kind !== 'key') || e.stepId !== s.id) continue;
      const t = out(e.t);
      if (t !== null)
        frames.push({
          t: t + 0.1,
          label: `${s.id} ${e.kind === 'click' ? `click ${e.target}` : `key ${e.key}`}`.slice(0, 40),
        });
    }
    frames.push({ t: Math.max(at, end - 0.3), label: `${s.id} end` });
  }
  frames.sort((a, b) => a.t - b.t);
  const rendered = await opts.stage.render(
    opts.slug,
    frames.map((f) => f.t),
  );
  for (const [i, r] of rendered.entries())
    for (const [id, message] of Object.entries(r.errors))
      issues.push(`at ${fmt(frames[i]!.t)}: ${id} failed to render: ${message}`);
  const sheets: Buffer[] = [];
  for (let i = 0; i < rendered.length; i += SHEET)
    sheets.push(
      await contactSheet(
        rendered
          .slice(i, i + SHEET)
          .map((r, j) => ({ png: r.png, label: `${frames[i + j]!.label}  ${fmt(frames[i + j]!.t)}` })),
      ),
    );
  return { issues, frames, sheets };
}
