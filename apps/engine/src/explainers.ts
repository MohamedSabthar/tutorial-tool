import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildTimeMap,
  ExplainerJob,
  RpcError,
  Storyboard,
  type Beat,
  type ExplainerScene,
  type TimelinePatch,
} from '@studio/core';
import type { ProjectStore } from './projects';
import type { TimelineStore } from './timeline';
import type { Catalog } from './agent/catalog';

interface Deps {
  store: ProjectStore;
  timelines: TimelineStore;
  catalog(slug: string): Promise<Catalog>;
  /** Inserts an explainer scene at output time `at` (with FreezeMorph in and out); returns its id. */
  insertScene(slug: string, at: number, component: string, props: Record<string, unknown>): Promise<string>;
  removeScene(slug: string, sceneId: string): Promise<void>;
  /** Sends a user-side message to the project's agent as a new run. */
  send(slug: string, text: string): Promise<void>;
  emit(slug: string): void;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Explainers made with the agent. `start` inserts a placeholder scene and asks for a storyboard;
 * the storyboard (beats with narration, visuals and rough frames from check_scene) waits for the
 * user; `approve` asks the agent to build it; the agent ends with `explainer_done`.
 */
export class Explainers {
  private jobs = new Map<string, ExplainerJob[]>();

  constructor(private deps: Deps) {}

  private file(slug: string) {
    return path.join(this.deps.store.dir(slug), '.studio', 'explainers.json');
  }

  async list(slug: string): Promise<ExplainerJob[]> {
    const cached = this.jobs.get(slug);
    if (cached) return cached;
    let list: ExplainerJob[] = [];
    try {
      list = ExplainerJob.array().parse(JSON.parse(await readFile(this.file(slug), 'utf8')));
    } catch {
      // None yet.
    }
    this.jobs.set(slug, list);
    return list;
  }

  private async save(slug: string, list: ExplainerJob[]) {
    this.jobs.set(slug, list);
    const f = this.file(slug);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(`${f}.tmp`, JSON.stringify(list, null, 2));
    await rename(`${f}.tmp`, f);
    this.deps.emit(slug);
  }

  async get(slug: string, sceneId: string): Promise<ExplainerJob> {
    const job = (await this.list(slug)).find((j) => j.sceneId === sceneId);
    if (!job) throw new RpcError(`no explainer job for scene "${sceneId}"`, 'not_found');
    return job;
  }

  private async update(slug: string, sceneId: string, patch: Partial<ExplainerJob>) {
    const list = await this.list(slug);
    await this.save(
      slug,
      list.map((j) => (j.sceneId === sceneId ? ExplainerJob.parse({ ...j, ...patch }) : j)),
    );
    return this.get(slug, sceneId);
  }

  /** Where the scene sits, in words, for the agent. */
  private async where(slug: string, sceneId: string): Promise<string> {
    const { timeline } = await this.deps.timelines.get(slug);
    const tm = buildTimeMap(timeline);
    const span = tm.scenes.find((s) => s.sceneId === sceneId);
    if (!span) return '';
    const steps = timeline.steps.map((s) => ({ s, at: tm.toOutput(s.take, s.from)[0] ?? Infinity }));
    const before = [...steps].reverse().find((x) => x.at < span.start);
    const after = steps.find((x) => x.at >= span.end - 1.5);
    return ` It is scene ${sceneId} at ${r2(span.start)}–${r2(span.end)} s${before ? `, after step "${before.s.title}"` : ''}${after ? ` and before "${after.s.title}"` : ''}.`;
  }

  /** The storyboard request (sent as a message, or returned by insert_explainer). */
  async storyboardInstruction(slug: string, job: ExplainerJob): Promise<string> {
    return [
      `[Explainer · storyboard] Make an explainer scene for: "${job.brief}".${await this.where(slug, job.sceneId)} A placeholder is in the timeline, with FreezeMorph transitions in and out.`,
      job.feedback ? `The user asked for these changes to the last storyboard:\n\n${job.feedback}` : '',
      [
        'Follow the explainer-authoring skill. Storyboard first, nothing detailed yet:',
        '1. Pick the approach: reuse a built-in or library scene where you can (list_scenes).',
        `2. save_storyboard({"sceneId": "${job.sceneId}", title, approach, beats: [{id, narration, visual}]}): 3–6 beats, one spoken narration line per beat (about 2.5 words per second).`,
        `3. set_explainer({"sceneId": "${job.sceneId}", component, props, narration, beats}) to a rough draft, then check_scene({"sceneId": "${job.sceneId}"}) for a rough frame per beat.`,
        'Stop there and end your turn: the user reviews the storyboard in the Studio before you build it.',
      ].join('\n'),
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private async buildInstruction(slug: string, job: ExplainerJob): Promise<string> {
    return [
      `[Explainer · build] The user approved the storyboard for scene ${job.sceneId} ("${job.brief}").${await this.where(slug, job.sceneId)}`,
      '```json\n' + JSON.stringify(job.storyboard, null, 2) + '\n```',
      [
        'Build it, following the explainer-authoring skill:',
        `1. set_explainer with the final component, props, narration (the storyboard's lines, as edited) and beats. Write scenes/<Name>.tsx only if no built-in or library scene can show it.`,
        `2. check_scene({"sceneId": "${job.sceneId}"}) until it passes and each beat's frame matches the storyboard.`,
        `3. generate_voiceover({"stepIds": ["${job.sceneId}"]}), then check_scene again (the beats now follow the voice). If the voice-over can't be generated (no voice chosen in the brief, or no ElevenLabs key), skip it: the beats follow the narration text until it is voiced. Say so in the summary.`,
        `Keep the FreezeMorph transitions. Finish with explainer_done({"sceneId": "${job.sceneId}", "summary": "<one or two sentences>"}).`,
      ].join('\n'),
    ].join('\n\n');
  }

  /**
   * Inserts a placeholder scene at `at` and opens a job. With `ask`, also sends the storyboard
   * request to the agent (from the timeline); without it the caller (insert_explainer) passes the
   * instruction on itself.
   */
  async start(slug: string, at: number, brief: string, ask: boolean): Promise<ExplainerJob> {
    const sceneId = await this.deps.insertScene(slug, at, 'core:CardDeck', {
      title: brief.length > 60 ? `${brief.slice(0, 57)}…` : brief,
      cards: [{ title: 'Storyboard in progress', text: 'The agent is planning this explainer.' }],
    });
    const job = ExplainerJob.parse({ sceneId, brief, status: 'storyboarding', createdAt: Date.now() });
    await this.save(slug, [...(await this.list(slug)), job]);
    if (ask) await this.deps.send(slug, await this.storyboardInstruction(slug, job));
    return job;
  }

  /** save_storyboard: stores it, puts its narration and beats on the scene, and opens the review. */
  async saveStoryboard(slug: string, sceneId: string, input: unknown): Promise<ExplainerJob> {
    const storyboard = Storyboard.parse(input);
    await this.get(slug, sceneId);
    await this.patchScene(slug, sceneId, {
      narration: storyboard.beats.map((b) => b.narration),
      beats: storyboard.beats.map((b, i) => ({ id: b.id, at: `vo:${i}` as const })),
    });
    return this.update(slug, sceneId, { storyboard, status: 'review', feedback: '' });
  }

  private async patchScene(slug: string, sceneId: string, fields: Partial<ExplainerScene>) {
    const { timeline } = await this.deps.timelines.get(slug);
    const i = timeline.scenes.findIndex((s) => s.id === sceneId && s.kind === 'explainer');
    if (i < 0) throw new RpcError(`no explainer scene "${sceneId}"`, 'not_found');
    const patch: TimelinePatch = Object.entries(fields).map(([k, value]) => ({
      op: 'replace' as const,
      path: `/scenes/${i}/${k}`,
      value,
    }));
    if (patch.length)
      await this.deps.timelines.patch(slug, patch, { author: 'agent', label: 'Edit explainer' });
  }

  /** set_explainer: the scene's component, props, narration and beats, validated. */
  async setScene(
    slug: string,
    sceneId: string,
    input: { component?: string; props?: Record<string, unknown>; narration?: string[]; beats?: Beat[] },
  ): Promise<string> {
    const { timeline } = await this.deps.timelines.get(slug);
    const scene = timeline.scenes.find(
      (s): s is ExplainerScene => s.id === sceneId && s.kind === 'explainer',
    );
    if (!scene) throw new RpcError(`no explainer scene "${sceneId}"`, 'not_found');
    const component = input.component ?? scene.component;
    const catalog = await this.deps.catalog(slug);
    const entry = catalog.entries.find((e) => e.id === component);
    if (!entry || entry.kind !== 'scene')
      throw new RpcError(
        `no scene component ${component}. Available: ${catalog.entries
          .filter((e) => e.kind === 'scene')
          .map((e) => e.id)
          .join(', ')}`,
        'bad_request',
      );
    if (entry.error) throw new RpcError(`${component} does not load: ${entry.error}`, 'bad_request');
    const props = input.props ?? (input.component && input.component !== scene.component ? {} : scene.props);
    const schema = catalog.schemas.get(component);
    const parsed = schema?.safeParse(props);
    if (parsed && !parsed.success)
      throw new RpcError(
        `props don't match ${component}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`,
        'bad_request',
      );
    await this.patchScene(slug, sceneId, {
      component,
      props,
      ...(input.narration ? { narration: input.narration } : {}),
      ...(input.beats ? { beats: input.beats } : {}),
    });
    const beatsNote = entry.beats?.length
      ? ` It animates on the beats ${entry.beats.join(', ')}${input.beats ? '' : ' (one per narration line)'}.`
      : '';
    return `Scene ${sceneId} now uses ${component}.${beatsNote} Check it with check_scene.`;
  }

  /** check_scene results during the storyboard: keep one frame per beat for the review cards. */
  async attachFrames(slug: string, sceneId: string, frames: { beat: string | null; png: Buffer }[]) {
    const job = (await this.list(slug)).find((j) => j.sceneId === sceneId);
    if (!job || (job.status !== 'storyboarding' && job.status !== 'review')) return;
    const dir = path.join(this.deps.store.dir(slug), '.studio', 'explainers', sceneId);
    await mkdir(dir, { recursive: true });
    const out: Record<string, string> = {};
    for (const f of frames) {
      if (!f.beat) continue;
      const rel = `.studio/explainers/${sceneId}/${f.beat}-${Date.now().toString(36)}.png`;
      await writeFile(path.join(this.deps.store.dir(slug), rel), f.png);
      out[f.beat] = rel;
    }
    if (Object.keys(out).length) await this.update(slug, sceneId, { frames: out });
  }

  /** The user edits a beat's narration on a storyboard card. */
  async editBeat(slug: string, sceneId: string, beatId: string, narration: string) {
    const job = await this.get(slug, sceneId);
    if (!job.storyboard) throw new RpcError('there is no storyboard yet', 'bad_request');
    const storyboard = Storyboard.parse({
      ...job.storyboard,
      beats: job.storyboard.beats.map((b) => (b.id === beatId ? { ...b, narration } : b)),
    });
    await this.patchScene(slug, sceneId, { narration: storyboard.beats.map((b) => b.narration) });
    return this.update(slug, sceneId, { storyboard });
  }

  async approve(slug: string, sceneId: string) {
    const job = await this.get(slug, sceneId);
    if (job.status !== 'review' || !job.storyboard)
      throw new RpcError('this storyboard is not waiting for review', 'bad_request');
    const next = await this.update(slug, sceneId, { status: 'building' });
    await this.deps.send(slug, await this.buildInstruction(slug, next));
    return next;
  }

  async revise(slug: string, sceneId: string, feedback: string) {
    await this.get(slug, sceneId);
    const next = await this.update(slug, sceneId, { status: 'storyboarding', feedback });
    await this.deps.send(slug, await this.storyboardInstruction(slug, next));
    return next;
  }

  async cancel(slug: string, sceneId: string) {
    await this.get(slug, sceneId);
    await this.deps.removeScene(slug, sceneId).catch(() => {});
    return this.update(slug, sceneId, { status: 'cancelled' });
  }

  async done(slug: string, sceneId: string, summary: string) {
    await this.get(slug, sceneId);
    return this.update(slug, sceneId, { status: 'done', summary });
  }
}
