import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  parseTimeline,
  Run,
  RpcError,
  type AgentEvent,
  type OverlayInstance,
  type Timeline,
  type TimelinePatch,
} from '@studio/core';
import type { ProjectStore } from './projects';
import type { TimelineStore } from './timeline';

const exec = promisify(execFile);

interface Deps {
  workspace: string;
  store: ProjectStore;
  timelines: TimelineStore;
  agents: {
    get(slug: string): {
      subscribe(fn: (e: AgentEvent) => void): () => void;
      readonly runId: string;
      status(): Promise<{ status: { costUsd: number } }>;
    };
  };
  /** Composited frames at output times (null renderer: no frames). */
  render?: (slug: string, times: number[]) => Promise<{ png: Buffer }[]>;
  emit(slug: string): void;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Readable differences between two timelines, for the review screen. */
export function timelineChanges(a: Timeline, b: Timeline): string[] {
  const out: string[] = [];
  const span = (o: OverlayInstance) => `${r2(o.start)}–${r2(o.end)} s`;
  const before = new Map(a.overlays.map((o) => [o.id, o]));
  const after = new Map(b.overlays.map((o) => [o.id, o]));
  for (const o of b.overlays) {
    const old = before.get(o.id);
    if (!old) out.push(`Added overlay ${o.id} (${o.component}) ${span(o)}`);
    else if (JSON.stringify(old) !== JSON.stringify(o)) {
      const fields = (['start', 'end', 'props', 'rect', 'anchor', 'component', 'layer'] as const).filter(
        (k) => JSON.stringify(old[k]) !== JSON.stringify(o[k]),
      );
      if (fields.length) out.push(`Changed overlay ${o.id} (${o.component}): ${fields.join(', ')}`);
    }
  }
  for (const o of a.overlays)
    if (!after.has(o.id)) out.push(`Removed overlay ${o.id} (${o.component}) ${span(o)}`);
  for (const s of b.steps) {
    const old = a.steps.find((x) => x.id === s.id);
    if (old && old.narration !== s.narration) out.push(`Narration of ${s.id} changed to "${s.narration}"`);
  }
  if (JSON.stringify(a.voice) !== JSON.stringify(b.voice))
    out.push(`Voice-over: ${b.voice.length} lines (was ${a.voice.length})`);
  if (JSON.stringify(a.scenes) !== JSON.stringify(b.scenes))
    out.push('Scenes or segments changed (cuts, holds or speed)');
  if (JSON.stringify(a.captions) !== JSON.stringify(b.captions))
    out.push(`Captions: ${b.captions.length} cues (was ${a.captions.length})`);
  return out;
}

/**
 * Agent runs: a user turn (chat or annotations) is snapshotted before and after into the
 * workspace repo's `runs/<slug>` branch (plumbing with a temporary index, so the working tree
 * and the checked-out branch are untouched). Runs that changed nothing are marked empty.
 */
export class RunManager {
  private runs = new Map<string, Run[]>();
  private active = new Map<string, { n: number; unsub: () => void }>();

  constructor(private deps: Deps) {}

  private file(slug: string) {
    return path.join(this.deps.store.dir(slug), '.studio', 'runs.json');
  }

  async list(slug: string): Promise<Run[]> {
    const cached = this.runs.get(slug);
    if (cached) return cached;
    let list: Run[] = [];
    try {
      list = Run.array().parse(JSON.parse(await readFile(this.file(slug), 'utf8')));
    } catch {
      // No runs yet.
    }
    // A run that was in progress when the engine stopped can still be closed later.
    this.runs.set(slug, list);
    return list;
  }

  private async save(slug: string, list: Run[]) {
    this.runs.set(slug, list);
    const f = this.file(slug);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(`${f}.tmp`, JSON.stringify(list, null, 2));
    await rename(`${f}.tmp`, f);
    this.deps.emit(slug);
  }

  private async update(slug: string, n: number, patch: Partial<Run>) {
    const list = await this.list(slug);
    await this.save(
      slug,
      list.map((r) => (r.n === n ? Run.parse({ ...r, ...patch }) : r)),
    );
  }

  async get(slug: string, n: number): Promise<Run> {
    const r = (await this.list(slug)).find((x) => x.n === n);
    if (!r) throw new RpcError(`no run #${n}`, 'not_found');
    return r;
  }

  // ---------------------------------------------------------------- git

  private async git(args: string[], env?: NodeJS.ProcessEnv) {
    const { stdout } = await exec('git', args, {
      cwd: this.deps.workspace,
      env: { ...process.env, ...env },
      maxBuffer: 64 << 20,
    });
    return stdout;
  }

  private async identity(): Promise<string[]> {
    const name = (await this.git(['config', 'user.name']).catch(() => '')).trim();
    const email = (await this.git(['config', 'user.email']).catch(() => '')).trim();
    return [
      ...(name ? [] : ['-c', 'user.name=Tutorial Studio']),
      ...(email ? [] : ['-c', 'user.email=tutorial-studio@localhost']),
    ];
  }

  /** Commits the project folder and shared overlays onto runs/<slug>; returns the commit. */
  async snapshot(slug: string, message: string): Promise<string> {
    const index = path.join(os.tmpdir(), `studio-index-${randomBytes(6).toString('hex')}`);
    const env = { GIT_INDEX_FILE: index };
    try {
      await this.git(['read-tree', '--empty'], env);
      const paths = [`projects/${slug}`, 'overlays', 'scenes'].filter((p) =>
        existsSync(path.join(this.deps.workspace, p)),
      );
      // Engine state and media are never part of a run (also git-ignored in workspaces).
      await this.git(['add', '-A', '--', ...paths], env);
      const skip = ['.studio', 'recordings', 'audio', 'output'].map((d) => `projects/${slug}/${d}`);
      await this.git(['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', ...skip], env);
      const tree = (await this.git(['write-tree'], env)).trim();
      const ref = `refs/heads/runs/${slug}`;
      const parent = (await this.git(['rev-parse', '--verify', '-q', ref]).catch(() => '')).trim();
      const commit = (
        await this.git([
          ...(await this.identity()),
          'commit-tree',
          tree,
          ...(parent ? ['-p', parent] : []),
          '-m',
          message,
        ])
      ).trim();
      await this.git(['update-ref', ref, commit]);
      return commit;
    } finally {
      await rm(index, { force: true });
    }
  }

  private async show(commit: string, rel: string): Promise<string | null> {
    return this.git(['show', `${commit}:${rel}`]).catch(() => null);
  }

  /** Unified diff of a run's files (the timeline is summarised separately). */
  async diff(slug: string, n: number): Promise<string> {
    const r = await this.get(slug, n);
    if (!r.after) return '';
    const out = await this.git([
      'diff',
      '--no-color',
      r.before,
      r.after,
      '--',
      '.',
      `:(exclude)projects/${slug}/tutorial.json`,
    ]).catch(() => '');
    return out.length > 80_000 ? `${out.slice(0, 80_000)}\n… (diff truncated)` : out;
  }

  // ---------------------------------------------------------------- lifecycle

  /**
   * Starts a run for a user turn (or joins the one in progress), snapshots the project and
   * renders "before" frames at the annotations' times; the run ends with the turn's result.
   */
  async begin(slug: string, opts: { prompt: string; annotationIds?: string[] }): Promise<number> {
    const running = this.active.get(slug);
    if (running) {
      if (opts.annotationIds?.length) {
        const r = await this.get(slug, running.n);
        await this.update(slug, running.n, {
          annotationIds: [...new Set([...r.annotationIds, ...opts.annotationIds])],
        });
      }
      return running.n;
    }
    const list = await this.list(slug);
    const n = (list.at(-1)?.n ?? 0) + 1;
    const before = await this.snapshot(slug, `run #${n} before: ${opts.prompt.slice(0, 72)}`);
    const run = Run.parse({
      n,
      runId: this.deps.agents.get(slug).runId,
      startedAt: Date.now(),
      endedAt: null,
      prompt: opts.prompt.slice(0, 2000),
      annotationIds: opts.annotationIds ?? [],
      before,
      after: null,
      status: 'running',
    });
    await this.save(slug, [...list, run]);
    const frames = await this.frames(slug, n, run.annotationIds, 'before');
    if (frames) await this.update(slug, n, frames);

    // Follow the turn: the summary, check_overlay results, cost; end on the result.
    const tools = new Map<string, string>();
    const checks: string[] = [];
    let summary = '';
    const session = this.deps.agents.get(slug);
    const costAtStart = (await session.status()).status.costUsd;
    const unsub = session.subscribe((e) => {
      if (e.kind === 'tool_use') tools.set(e.id, e.name);
      else if (e.kind === 'tool_result' && /check_overlay$/.test(tools.get(e.id) ?? '')) {
        const first = e.text.split('\n')[0];
        if (first) checks.push(first);
      } else if (e.kind === 'text') summary = e.text;
      else if (e.kind === 'result') {
        unsub();
        this.active.delete(slug);
        void this.end(slug, n, {
          summary: e.text || summary,
          checks,
          costUsd: Math.max(0, e.costUsd - costAtStart),
          durationMs: e.durationMs,
        });
      }
    });
    this.active.set(slug, { n, unsub });
    return n;
  }

  private async end(
    slug: string,
    n: number,
    info: { summary: string; checks: string[]; costUsd: number; durationMs: number },
  ) {
    const run = await this.get(slug, n);
    const after = await this.snapshot(slug, `run #${n} after`);
    const numstat = await this.git(['diff', '--numstat', run.before, after]).catch(() => '');
    const files = numstat
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [a = '0', d = '0', p = ''] = l.split('\t');
        return { path: p, added: Number(a) || 0, removed: Number(d) || 0 };
      });
    let timeline: string[] = [];
    const tlPath = `projects/${slug}/tutorial.json`;
    if (files.some((f) => f.path === tlPath)) {
      const a = await this.show(run.before, tlPath);
      const b = await this.show(after, tlPath);
      if (a && b) timeline = timelineChanges(parseTimeline(JSON.parse(a)), parseTimeline(JSON.parse(b)));
    }
    // Annotation status changes alone (sent, resolved) don't make a run.
    const changed = files.some((f) => f.path !== tlPath) || timeline.length > 0;
    await this.update(slug, n, {
      after,
      endedAt: Date.now(),
      files: files.filter((f) => f.path !== tlPath),
      timeline,
      summary: info.summary,
      checks: info.checks,
      costUsd: info.costUsd,
      durationMs: info.durationMs,
      status: changed ? 'review' : 'empty',
    });
    if (changed) {
      const frames = await this.frames(slug, n, run.annotationIds, 'after');
      if (frames) await this.update(slug, n, frames);
    }
  }

  /** Renders a frame per annotation at its time; returns the run fields to merge. */
  private async frames(
    slug: string,
    n: number,
    ids: string[],
    which: 'before' | 'after',
  ): Promise<Partial<Run> | null> {
    if (!ids.length || !this.deps.render) return null;
    const { timeline } = await this.deps.timelines.get(slug);
    const notes = ids.map((id) => timeline.annotations.find((a) => a.id === id)).filter((a) => !!a);
    if (!notes.length || !timeline.takes.length) return null;
    try {
      const pngs = await this.deps.render(
        slug,
        notes.map((a) => a.t),
      );
      const dir = path.join(this.deps.store.dir(slug), '.studio', 'runs', String(n));
      await mkdir(dir, { recursive: true });
      const run = await this.get(slug, n);
      const frames = { ...run.frames };
      for (const [i, a] of notes.entries()) {
        const rel = `.studio/runs/${n}/${which}-${a.id}.png`;
        await writeFile(path.join(this.deps.store.dir(slug), rel), pngs[i]!.png);
        frames[a.id] = { ...frames[a.id], [which]: rel };
      }
      return { frames };
    } catch (e) {
      return {
        framesNote: `Frames could not be rendered: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`,
      };
    }
  }

  // ---------------------------------------------------------------- review actions

  private async setNotes(slug: string, ids: string[], status: 'open' | 'resolved', label: string) {
    const { timeline } = await this.deps.timelines.get(slug);
    const patch: TimelinePatch = ids.flatMap((id) => {
      const i = timeline.annotations.findIndex((a) => a.id === id);
      return i < 0 ? [] : [{ op: 'replace' as const, path: `/annotations/${i}/status`, value: status }];
    });
    if (patch.length) await this.deps.timelines.patch(slug, patch, { author: 'user', label });
  }

  async accept(slug: string, n: number) {
    const r = await this.get(slug, n);
    await this.setNotes(slug, r.annotationIds, 'resolved', `Accept run #${n}`);
    await this.update(slug, n, { status: 'accepted' });
    return this.get(slug, n);
  }

  async reopen(slug: string, n: number) {
    const r = await this.get(slug, n);
    await this.setNotes(slug, r.annotationIds, 'open', `Reopen run #${n}`);
    await this.update(slug, n, { status: 'reopened' });
    return this.get(slug, n);
  }

  /**
   * Puts every file the run changed back as it was, and the timeline through one undoable patch
   * (annotations stay, reopened). Later runs that touched the same files are not unwound.
   */
  async revert(slug: string, n: number) {
    const r = await this.get(slug, n);
    if (!r.after) throw new RpcError(`run #${n} has not finished`, 'bad_request');
    const tlPath = `projects/${slug}/tutorial.json`;
    const names = (await this.git(['diff', '--name-only', r.before, r.after])).split('\n').filter(Boolean);
    for (const rel of names) {
      if (rel === tlPath) continue;
      const abs = path.join(this.deps.workspace, rel);
      const old = await this.show(r.before, rel);
      if (old === null) await rm(abs, { force: true });
      else {
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, old);
      }
    }
    if (names.includes(tlPath)) {
      const old = parseTimeline(JSON.parse((await this.show(r.before, tlPath)) ?? '{}'));
      const { timeline: cur } = await this.deps.timelines.get(slug);
      const keys = ['scenes', 'transitions', 'steps', 'overlays', 'voice', 'captions'] as const;
      const patch: TimelinePatch = keys
        .filter((k) => JSON.stringify(old[k]) !== JSON.stringify(cur[k]))
        .map((k) => ({ op: 'replace' as const, path: `/${k}`, value: old[k] }));
      if (patch.length)
        await this.deps.timelines.patch(slug, patch, { author: 'user', label: `Revert run #${n}` });
    }
    await this.setNotes(slug, r.annotationIds, 'open', `Reopen after reverting run #${n}`);
    await this.update(slug, n, { status: 'reverted' });
    return this.get(slug, n);
  }
}
