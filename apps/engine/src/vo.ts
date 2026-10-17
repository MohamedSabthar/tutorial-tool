import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RpcError, VoiceLine, wordsFromAlignment, type Step } from '@studio/core';
import type { ProjectStore } from './projects';
import type { Author, TimelineStore } from './timeline';
import type { TtsService } from './tts';

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
}

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
    },
  ) {}

  async generate(
    slug: string,
    opts: { stepIds?: string[]; author?: Author; group?: string | null } = {},
  ): Promise<VoiceoverResult> {
    const brief = await this.deps.store.readBrief(slug);
    if (!brief.voice) throw new RpcError('Choose a voice in the brief first.', 'bad_request');
    const { timeline } = await this.deps.timelines.get(slug);
    if (!timeline.steps.length)
      throw new RpcError('There are no recorded steps to voice yet.', 'bad_request');
    const wanted = opts.stepIds?.length ? new Set(opts.stepIds) : null;
    const unknown = opts.stepIds?.filter((id) => !timeline.steps.some((s) => s.id === id)) ?? [];
    if (unknown.length) throw new RpcError(`No step ${unknown.join(', ')} in the timeline.`, 'not_found');

    const narrated = timeline.steps.filter((s) => s.narration.trim());
    const result: VoiceoverResult = { lines: [], skipped: [], seconds: 0 };
    const fresh = new Map<string, VoiceLine>();
    for (const step of timeline.steps) {
      if (wanted && !wanted.has(step.id)) continue;
      if (!step.narration.trim()) {
        result.skipped.push({ stepId: step.id, reason: 'no narration' });
        continue;
      }
      const i = narrated.indexOf(step);
      const prev = narrated[i - 1]?.narration;
      const next = narrated[i + 1]?.narration;
      const r = await this.deps.tts.synthesize(slug, {
        text: step.narration.trim(),
        voiceId: brief.voice,
        ...(prev ? { previousText: prev } : {}),
        ...(next ? { nextText: next } : {}),
      });
      fresh.set(step.id, lineFor(step, r));
      result.lines.push({ stepId: step.id, duration: r.duration, cached: r.cached });
    }

    // Keep lines of steps that weren't regenerated (and explainer lines); replace the rest.
    const voice = [
      ...timeline.voice.filter(
        (v) => !fresh.has(v.owner) && !(wanted === null && isStepLine(v, timeline.steps)),
      ),
      ...fresh.values(),
    ];
    if (fresh.size || voice.length !== timeline.voice.length)
      await this.deps.timelines.patch(slug, [{ op: 'replace', path: '/voice', value: voice }], {
        author: opts.author ?? 'user',
        group: opts.group ?? null,
        label: 'Generate voice-over',
      });
    result.seconds = Math.round(result.lines.reduce((n, l) => n + l.duration, 0) * 100) / 100;
    return result;
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

function lineFor(
  step: Step,
  r: { audio: string; duration: number; alignment: { chars: string[]; starts: number[]; ends: number[] } },
): VoiceLine {
  return VoiceLine.parse({
    id: `vo-${step.id}`,
    owner: step.id,
    text: step.narration.trim(),
    audio: r.audio,
    start: LEAD_IN,
    duration: Math.round(r.duration * 1000) / 1000,
    // Word times are relative to the line's own start, like the audio.
    words: wordsFromAlignment(r.alignment),
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
