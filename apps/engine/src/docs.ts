import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  briefTitle,
  buildTimeMap,
  cuesFromVoice,
  ownerStart,
  voiceSpans,
  type RecorderEvent,
  type Step,
  type Timeline,
} from '@studio/core';
import { renderMarkdown, scriptReadme, toSrt, toVtt, type DocStep } from '@studio/exporters';
import type { ProjectStore } from './projects';
import type { TimelineStore } from './timeline';
import { readEvents } from './timing';

const DocCache = z.object({
  steps: z.record(z.string(), z.object({ narration: z.string(), instruction: z.string() })).default({}),
});
type DocCache = z.infer<typeof DocCache>;

export interface DocResult {
  /** Files written, relative to the project folder. */
  files: string[];
  /** Things the user should know (e.g. instructions fell back to the narration). */
  notes: string[];
}

/**
 * The written outputs of an export: captions (SRT, VTT), `tutorial.md` with a still per step
 * (the frame before the step's action, its target boxed), and the script with a README. The
 * step instructions are the agent's rewrite of the narration (cached by narration in
 * `.studio/doc.json`); without the agent, the narration is used as is.
 */
export class DocWriter {
  private waiting = new Map<string, () => void>();

  constructor(
    private deps: {
      store: ProjectStore;
      timelines: TimelineStore;
      /** Sends the project's agent a message. */
      send(slug: string, text: string): Promise<void>;
      /** One frame of `timeline` at output time t (PNG). */
      render(slug: string, t: number, timeline: Timeline): Promise<Buffer>;
      /** How long to wait for the agent's rewrite. */
      agentTimeoutMs?: number;
    },
  ) {}

  private cacheFile(slug: string) {
    return path.join(this.deps.store.dir(slug), '.studio', 'doc.json');
  }

  private async cache(slug: string): Promise<DocCache> {
    try {
      return DocCache.parse(JSON.parse(await readFile(this.cacheFile(slug), 'utf8')));
    } catch {
      return { steps: {} };
    }
  }

  /** Saves the agent's instructions (the save_doc_instructions tool). */
  async save(slug: string, items: { stepId: string; instruction: string }[]): Promise<{ saved: number }> {
    const { timeline } = await this.deps.timelines.get(slug);
    const cache = await this.cache(slug);
    let saved = 0;
    for (const it of items) {
      const step = timeline.steps.find((s) => s.id === it.stepId);
      if (!step || !it.instruction.trim()) continue;
      cache.steps[step.id] = { narration: step.narration, instruction: it.instruction.trim() };
      saved++;
    }
    await mkdir(path.dirname(this.cacheFile(slug)), { recursive: true });
    await writeFile(this.cacheFile(slug), JSON.stringify(cache, null, 2) + '\n');
    this.waiting.get(slug)?.();
    return { saved };
  }

  /** Instructions for the steps: cached rewrites, else asks the agent once, else the narration. */
  async instructions(
    slug: string,
    steps: Step[],
    signal?: AbortSignal,
  ): Promise<{ text: Record<string, string>; note?: string }> {
    const fresh = (c: DocCache) =>
      steps.filter((s) => s.narration.trim() && c.steps[s.id]?.narration !== s.narration);
    let missing = fresh(await this.cache(slug));
    let note: string | undefined;
    if (missing.length) {
      const answered = new Promise<void>((resolve) => this.waiting.set(slug, resolve));
      try {
        await this.deps.send(slug, instructionRequest(missing));
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timedOut = await Promise.race([
          answered.then(() => false),
          new Promise<boolean>(
            (r) => (timer = setTimeout(() => r(true), this.deps.agentTimeoutMs ?? 180_000)),
          ),
          new Promise<boolean>((r) => signal?.addEventListener('abort', () => r(false), { once: true })),
        ]);
        clearTimeout(timer);
        if (timedOut)
          note = 'The agent did not rewrite the instructions in time; the narration is used instead.';
      } catch (e) {
        note = `The agent couldn't rewrite the instructions (${e instanceof Error ? e.message : String(e)}); the narration is used instead.`;
      } finally {
        this.waiting.delete(slug);
      }
      missing = fresh(await this.cache(slug));
      if (missing.length && !note)
        note = `${missing.length} step(s) kept their narration as the instruction.`;
    }
    const cache = await this.cache(slug);
    const text: Record<string, string> = {};
    for (const s of steps)
      text[s.id] =
        cache.steps[s.id]?.narration === s.narration ? cache.steps[s.id]!.instruction : s.narration;
    return note ? { text, note } : { text };
  }

  /** Writes the captions, the Markdown doc with stills, and the script with its README into output/. */
  async write(
    slug: string,
    opts: {
      /** Which outputs to write (all by default). */
      captions?: boolean;
      doc?: boolean;
      script?: boolean;
      onStep?: (message: string) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<DocResult> {
    const want = { captions: opts.captions ?? true, doc: opts.doc ?? true, script: opts.script ?? true };
    const dir = this.deps.store.dir(slug);
    const out = path.join(dir, 'output');
    await mkdir(out, { recursive: true });
    const { timeline } = await this.deps.timelines.get(slug);
    const tm = buildTimeMap(timeline);
    const files: string[] = [];
    const notes: string[] = [];

    // Captions: the timeline's cues (or cues from the voice-over when there are none).
    if (want.captions) {
      opts.onStep?.('captions');
      const cues = timeline.captions.length ? timeline.captions : cuesFromVoice(voiceSpans(timeline, tm));
      await writeFile(path.join(out, 'captions.srt'), toSrt(cues));
      await writeFile(path.join(out, 'captions.vtt'), toVtt(cues));
      files.push('output/captions.srt', 'output/captions.vtt');
    }
    if (want.doc) await this.writeDoc(slug, timeline, tm, files, notes, opts);
    if (opts.signal?.aborted) throw new Error('export cancelled');

    // The script, and how to re-record it.
    const script = path.join(dir, 'script.spec.ts');
    if (want.script && existsSync(script)) {
      opts.onStep?.('script');
      await copyFile(script, path.join(out, 'script.spec.ts'));
      await writeFile(path.join(out, 'README.md'), scriptReadme(slug));
      files.push('output/script.spec.ts', 'output/README.md');
    }
    return { files, notes };
  }

  /** `tutorial.md`: stills, then the agent's instructions. */
  private async writeDoc(
    slug: string,
    timeline: Timeline,
    tm: ReturnType<typeof buildTimeMap>,
    files: string[],
    notes: string[],
    opts: { onStep?: (message: string) => void; signal?: AbortSignal },
  ) {
    const dir = this.deps.store.dir(slug);
    const out = path.join(dir, 'output');
    const { project } = await this.deps.store.open(slug);
    const brief = await this.deps.store.readBrief(slug);

    // Stills: the moment before each step's action, with its target boxed.
    opts.onStep?.('stills');
    const take = timeline.takes.at(-1);
    const events = take ? await readEvents(dir, take.events).catch(() => [] as RecorderEvent[]) : [];
    await rm(path.join(out, 'images'), { recursive: true, force: true });
    await mkdir(path.join(out, 'images'), { recursive: true });
    const images = new Map<string, string>();
    for (const [i, step] of timeline.steps.entries()) {
      if (opts.signal?.aborted) throw new Error('export cancelled');
      const t = stillTime(timeline, tm, step, events);
      if (t === null) continue;
      const rel = `images/step-${String(i + 1).padStart(2, '0')}.jpg`;
      try {
        const png = await this.deps.render(slug, t, stillTimeline(timeline, step, t));
        await writeFile(path.join(out, rel), await toJpeg(png));
        images.set(step.id, rel);
        files.push(`output/${rel}`);
      } catch (e) {
        notes.push(`No still for "${step.title}": ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Instructions, then the doc.
    opts.onStep?.('instructions');
    const { text, note } = await this.instructions(slug, timeline.steps, opts.signal);
    if (opts.signal?.aborted) throw new Error('export cancelled');
    if (note) notes.push(note);
    const steps: DocStep[] = timeline.steps.map((s) => ({
      title: s.title,
      instruction: text[s.id] ?? s.narration,
      ...(images.has(s.id) ? { image: images.get(s.id)! } : {}),
    }));
    const video = `${slug}.mp4`;
    await writeFile(
      path.join(out, 'tutorial.md'),
      renderMarkdown({
        title: (brief.goal.trim() && briefTitle(brief.goal)) || project.title,
        intro: brief.goal.trim(),
        ...(existsSync(path.join(out, video)) ? { video } : {}),
        ...(existsSync(path.join(out, 'captions.vtt')) ? { captions: 'captions.vtt' } : {}),
        steps,
      }),
    );
    files.push('output/tutorial.md');
  }
}

/** The agent message asking for the rewrite (answered with save_doc_instructions). */
export function instructionRequest(steps: Step[]): string {
  return [
    '[Export · doc] Export is writing the Markdown version of this tutorial. Rewrite each step\'s narration below as a short written instruction for a reader following along: imperative, one or two sentences, the UI element to use in **bold**, no "we" and no mention of the video.',
    'Call save_doc_instructions once with every step, then end your turn. Do not change the timeline or any files.',
    '',
    JSON.stringify(
      steps.map((s) => ({ stepId: s.id, title: s.title, narration: s.narration })),
      null,
      2,
    ),
  ].join('\n');
}

/** Output time for a step's still: just before its first click or typing, else early in the step. */
export function stillTime(
  tl: Timeline,
  tm: ReturnType<typeof buildTimeMap>,
  step: Step,
  events: RecorderEvent[],
): number | null {
  const action = events.find(
    (e): e is Extract<RecorderEvent, { kind: 'click' | 'type' }> =>
      (e.kind === 'click' || e.kind === 'type') && e.stepId === step.id,
  );
  if (action) {
    const at = tm.toOutput(step.take, Math.max(step.from, action.t - 0.3))[0];
    if (at !== undefined) return Math.round(at * 1000) / 1000;
  }
  const start = ownerStart(tl, tm, step.id);
  if (start === null) return null;
  return Math.round((start + Math.min(1, (step.to - step.from) / 2)) * 1000) / 1000;
}

/** The timeline for a still: no captions (the doc has the text), and a box on the step's target. */
export function stillTimeline(tl: Timeline, step: Step, t: number): Timeline {
  const overlays = tl.overlays.filter((o) => o.component !== 'core:Captions');
  if (step.bbox)
    overlays.push({
      id: 'doc-still-box',
      component: 'core:Box',
      start: Math.max(0, t - 1),
      end: t + 1,
      layer: 50,
      anchor: { stepId: step.id, target: 'primary' },
      props: {},
      author: 'auto',
    });
  return { ...tl, overlays };
}

/** A 1600 px wide JPEG for the doc. */
function toJpeg(png: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'ffmpeg',
      [
        '-v',
        'error',
        '-f',
        'png_pipe',
        '-i',
        '-',
        '-vf',
        'scale=1600:-2',
        '-q:v',
        '3',
        '-f',
        'image2pipe',
        '-vcodec',
        'mjpeg',
        '-',
      ],
      { encoding: 'buffer', maxBuffer: 32 << 20 },
      (err, stdout, stderr) => (err ? reject(new Error(String(stderr) || err.message)) : resolve(stdout)),
    );
    child.stdin?.end(png);
  });
}
