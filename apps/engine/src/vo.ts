import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildTimeMap,
  ownerStart,
  RpcError,
  SCENE_LEAD_IN,
  SCENE_LINE_GAP,
  VoiceLine,
  type Pronunciation,
  type TimedWord,
  type ExplainerScene,
  type Step,
  type Timeline,
} from '@studio/core';
import { withCaptions } from './captions';
import type { ProjectStore } from './projects';
import type { Author, TimelineStore } from './timeline';
import type { TtsService } from './tts';
import { voiceLine } from './pronunciations';

/** Seconds of the step shown before its line starts. */
export const LEAD_IN = 0.25;
/** Waveform peaks per second of audio. */
export const PEAK_RATE = 50;

export interface VoiceoverResult {
  /** Lines written (one per step with narration). */
  lines: { stepId: string; duration: number; cached: boolean }[];
  skipped: { stepId: string; reason: string }[];
  /** Total seconds of voice-over. */
  seconds: number;
  /** Timing fit run right after (output length before and after). */
  fit?: { before: number; after: number; holds: number; spedUp: number };
  /**
   * Set when the lines were saved but the timing fit after them failed: picture and voice are
   * out of sync until it is fixed.
   */
  fitError?: string;
}

/** Runs after new lines land (the timing fit), in the same undo group. */
export type AfterVoice = (
  slug: string,
  opts: { author: Author; group: string | null },
) => Promise<{ before: number; after: number; steps: { hold: number; saved: number }[] }>;

/**
 * The voice-over: one line per recorded step, synthesized from the step's narration with the
 * brief's voice and written to the timeline as one patch (so one undo removes it).
 */
export class Voiceover {
  constructor(
    private deps: {
      store: ProjectStore;
      timelines: TimelineStore;
      tts: Pick<TtsService, 'synthesize'>;
      /** How product terms are spoken (the workspace's pronunciations.json). */
      pronunciations?: () => Promise<Pronunciation[]>;
      after?: AfterVoice;
    },
  ) {}

  async generate(
    slug: string,
    opts: { stepIds?: string[]; author?: Author; group?: string | null } = {},
  ): Promise<VoiceoverResult> {
    const voiceId = await this.deps.store.voiceFor(slug);
    if (!voiceId) throw new RpcError('Choose a voice in the brief first.', 'bad_request');
    const { timeline } = await this.deps.timelines.get(slug);
    const explainers = timeline.scenes.filter((s): s is ExplainerScene => s.kind === 'explainer');
    if (!timeline.steps.length && !explainers.length)
      throw new RpcError('There are no recorded steps or explainers to voice yet.', 'bad_request');
    const wanted = opts.stepIds?.length ? new Set(opts.stepIds) : null;
    const unknown =
      opts.stepIds?.filter(
        (id) => !timeline.steps.some((s) => s.id === id) && !explainers.some((e) => e.id === id),
      ) ?? [];
    if (unknown.length)
      throw new RpcError(`No step or scene ${unknown.join(', ')} in the timeline.`, 'not_found');

    const narrated = timeline.steps.filter((s) => s.narration.trim());
    const rules = (await this.deps.pronunciations?.().catch(() => [])) ?? [];
    const result: VoiceoverResult = { lines: [], skipped: [], seconds: 0 };
    const fresh = new Map<string, VoiceLine>();
    const freshScenes = new Map<string, VoiceLine[]>();
    for (const step of timeline.steps) {
      if (wanted && !wanted.has(step.id)) continue;
      if (!step.narration.trim()) {
        result.skipped.push({ stepId: step.id, reason: 'no narration' });
        continue;
      }
      const i = narrated.indexOf(step);
      const prev = narrated[i - 1]?.narration;
      const next = narrated[i + 1]?.narration;
      const { words, ...req } = voiceLine(step.narration.trim(), rules, { prev, next });
      const r = await this.deps.tts.synthesize(slug, { ...req, voiceId });
      fresh.set(step.id, lineFor(step, r, words(r.alignment)));
      result.lines.push({ stepId: step.id, duration: r.duration, cached: r.cached });
    }

    // Explainers: each narration line in turn, one after the other inside the scene.
    for (const scene of explainers) {
      if (wanted && !wanted.has(scene.id)) continue;
      const texts = scene.narration.map((x) => x.trim()).filter(Boolean);
      if (!texts.length) {
        result.skipped.push({ stepId: scene.id, reason: 'no narration' });
        continue;
      }
      const lines: VoiceLine[] = [];
      let at = SCENE_LEAD_IN;
      for (const [i, text] of texts.entries()) {
        const { words, ...req } = voiceLine(text, rules, { prev: texts[i - 1], next: texts[i + 1] });
        const r = await this.deps.tts.synthesize(slug, { ...req, voiceId });
        lines.push(
          VoiceLine.parse({
            id: `vo-${scene.id}-${i}`,
            owner: scene.id,
            text,
            audio: r.audio,
            start: Math.round(at * 1000) / 1000,
            duration: Math.round(r.duration * 1000) / 1000,
            words: words(r.alignment),
          }),
        );
        result.lines.push({ stepId: scene.id, duration: r.duration, cached: r.cached });
        at += r.duration + SCENE_LINE_GAP;
      }
      freshScenes.set(scene.id, lines);
    }

    // Keep hand-written lines, and lines of steps and scenes that weren't regenerated; replace the rest.
    const voice = [
      ...timeline.voice.filter(
        (v) =>
          v.manual ||
          (!fresh.has(v.owner) &&
            !freshScenes.has(v.owner) &&
            !(wanted === null && isStepLine(v, timeline.steps))),
      ),
      ...fresh.values(),
      ...[...freshScenes.values()].flat(),
    ];
    if (fresh.size || freshScenes.size || voice.length !== timeline.voice.length)
      await this.deps.timelines.patch(slug, [{ op: 'replace', path: '/voice', value: voice }], {
        author: opts.author ?? 'user',
        group: opts.group ?? null,
        label: 'Generate voice-over',
      });
    result.seconds = Math.round(result.lines.reduce((n, l) => n + l.duration, 0) * 100) / 100;
    if (this.deps.after && (fresh.size || freshScenes.size) && timeline.takes.length) {
      try {
        const f = await this.deps.after(slug, { author: opts.author ?? 'user', group: opts.group ?? null });
        result.fit = {
          before: f.before,
          after: f.after,
          holds: f.steps.filter((s) => s.hold > 0).length,
          spedUp: f.steps.filter((s) => s.saved > 0.5).length,
        };
      } catch (e) {
        // The lines are saved; say so, and that the fit (and so the sync) didn't happen.
        result.fitError = e instanceof Error ? e.message : String(e);
      }
    }
    return result;
  }

  /**
   * A voice line written by hand, voiced and placed at output time `at` under the step (or
   * explainer) showing there. It is marked manual: regenerating the voice-over keeps it.
   */
  async addLine(slug: string, p: { text: string; at: number }, opts: { author?: Author } = {}) {
    const { timeline } = await this.deps.timelines.get(slug);
    const voiced = await this.voice(slug, p.text);
    const place = placeAt(timeline, p.at);
    const line = VoiceLine.parse({
      id: `vo-hand-${Date.now().toString(36)}`,
      ...place,
      ...voiced,
      manual: true,
    });
    await this.saveVoice(slug, timeline, [...timeline.voice, line], opts, 'Add voice line');
    return { line };
  }

  /** Rewrites a line's text (voiced again) and/or moves it to output time `at`; it becomes manual. */
  async editLine(
    slug: string,
    p: { id: string; text?: string; at?: number },
    opts: { author?: Author } = {},
  ) {
    const { timeline } = await this.deps.timelines.get(slug);
    const old = timeline.voice.find((v) => v.id === p.id);
    if (!old) throw new RpcError(`There is no voice line ${p.id}.`, 'not_found');
    const text = p.text?.trim();
    const voiced = text && text !== old.text ? await this.voice(slug, text) : {};
    const place = p.at !== undefined ? placeAt(timeline, p.at) : {};
    const line = VoiceLine.parse({ ...old, ...voiced, ...place, manual: true });
    const voice = timeline.voice.map((v) => (v.id === p.id ? line : v));
    await this.saveVoice(slug, timeline, voice, opts, text ? 'Edit voice line' : 'Move voice line');
    return { line };
  }

  async removeLine(slug: string, p: { id: string }, opts: { author?: Author } = {}) {
    const { timeline } = await this.deps.timelines.get(slug);
    if (!timeline.voice.some((v) => v.id === p.id))
      throw new RpcError(`There is no voice line ${p.id}.`, 'not_found');
    const voice = timeline.voice.filter((v) => v.id !== p.id);
    await this.saveVoice(slug, timeline, voice, opts, 'Delete voice line');
  }

  /** Voices one hand-written line with the project's voice and pronunciations. */
  private async voice(slug: string, text: string) {
    const clean = text.trim();
    if (!clean) throw new RpcError('Write the line first.', 'bad_request');
    const voiceId = await this.deps.store.voiceFor(slug);
    if (!voiceId) throw new RpcError('Choose a voice in the brief first.', 'bad_request');
    const rules = (await this.deps.pronunciations?.().catch(() => [])) ?? [];
    const { words, ...req } = voiceLine(clean, rules, {});
    const r = await this.deps.tts.synthesize(slug, { ...req, voiceId });
    return {
      text: clean,
      audio: r.audio,
      duration: Math.round(r.duration * 1000) / 1000,
      words: words(r.alignment),
    };
  }

  /** Saves the voice with captions rebuilt from it, as one undo step. */
  private async saveVoice(
    slug: string,
    timeline: Timeline,
    voice: VoiceLine[],
    opts: { author?: Author },
    label: string,
  ) {
    const next = withCaptions({ ...timeline, voice });
    await this.deps.timelines.patch(
      slug,
      [
        { op: 'replace', path: '/voice', value: voice },
        { op: 'replace', path: '/captions', value: next.captions },
      ],
      { author: opts.author ?? 'user', group: null, label },
    );
  }

  /** Waveform peaks (0–1, PEAK_RATE per second) of a project audio file, cached next to it. */
  async peaks(slug: string, audio: string): Promise<{ rate: number; peaks: number[] }> {
    const dir = this.deps.store.dir(slug);
    const file = path.resolve(dir, audio);
    if (!file.startsWith(path.join(dir, 'audio') + path.sep) || !file.endsWith('.mp3'))
      throw new RpcError('peaks are only computed for audio/*.mp3', 'bad_request');
    const cache = file.replace(/\.mp3$/, '.peaks.json');
    try {
      return JSON.parse(await readFile(cache, 'utf8')) as { rate: number; peaks: number[] };
    } catch {
      // Not computed yet.
    }
    const samples = await decodeMono(file, PEAK_RATE * 80);
    const peaks: number[] = [];
    for (let i = 0; i < samples.length; i += 80) {
      let m = 0;
      for (let j = i; j < Math.min(i + 80, samples.length); j++) m = Math.max(m, Math.abs(samples[j]!));
      peaks.push(Math.round(Math.min(1, m) * 100) / 100);
    }
    const out = { rate: PEAK_RATE, peaks };
    await writeFile(cache, JSON.stringify(out));
    return out;
  }
}

const isStepLine = (v: VoiceLine, steps: Step[]) => steps.some((s) => s.id === v.owner);

/**
 * The owner and start for a line at output time `at`: the step or explainer that begins last
 * at or before it (lines are stored relative to their owner, so they move with it).
 */
function placeAt(tl: Timeline, at: number): { owner: string; start: number } {
  const tm = buildTimeMap(tl);
  const owners = [
    ...tl.steps.map((s) => s.id),
    ...tl.scenes.filter((s) => s.kind === 'explainer').map((s) => s.id),
  ]
    .map((id) => ({ id, start: ownerStart(tl, tm, id) }))
    .filter((o): o is { id: string; start: number } => o.start !== null && o.start <= at + 1e-3)
    .sort((a, b) => b.start - a.start);
  const owner = owners[0];
  if (!owner)
    throw new RpcError('There is no step or explainer at that time to attach the line to.', 'bad_request');
  return { owner: owner.id, start: Math.round(Math.max(0, at - owner.start) * 1000) / 1000 };
}

function lineFor(step: Step, r: { audio: string; duration: number }, words: TimedWord[]): VoiceLine {
  return VoiceLine.parse({
    id: `vo-${step.id}`,
    owner: step.id,
    text: step.narration.trim(),
    audio: r.audio,
    start: LEAD_IN,
    duration: Math.round(r.duration * 1000) / 1000,
    // Word times are relative to the line's own start, like the audio (written words).
    words,
  });
}

/** Decodes audio to mono 32-bit float samples at `rate` Hz with ffmpeg. */
function decodeMono(file: string, rate: number): Promise<Float32Array> {
  return new Promise((resolve, reject) =>
    execFile(
      'ffmpeg',
      ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'],
      { encoding: 'buffer', maxBuffer: 64 << 20 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(String(stderr) || err.message));
        const buf = stdout.buffer.slice(
          stdout.byteOffset,
          stdout.byteOffset + stdout.length - (stdout.length % 4),
        );
        resolve(new Float32Array(buf));
      },
    ),
  );
}
