import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  applyPatch,
  formatIssues,
  invertPatch,
  parseTimeline,
  PatchError,
  RpcError,
  TimelineError,
  TimelinePatch,
  type Timeline,
} from '@studio/core';
import type { ProjectStore } from './projects';

export type Author = 'user' | 'agent' | 'auto';

interface HistoryEntry {
  /** Patches applied (in order) and their inverses (in reverse application order). */
  forward: TimelinePatch[];
  backward: TimelinePatch[];
  author: Author;
  group: string | null;
  label: string;
}

interface Doc {
  timeline: Timeline;
  version: number;
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

export interface PatchResult {
  version: number;
  timeline: Timeline;
  canUndo: boolean;
  canRedo: boolean;
}

export interface ChangeEvent {
  slug: string;
  version: number;
  /** The patch to apply to the previous version (undo/redo send their effective patch). */
  patch: TimelinePatch;
  author: Author;
  kind: 'patch' | 'undo' | 'redo';
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Owns every project's tutorial.json. All changes go through `patch` (validated, saved,
 * broadcast); undo/redo are server-side so every window and the agent share one history.
 * Consecutive patches with the same `group` (one drag, one agent run) undo as one step.
 */
export class TimelineStore {
  private docs = new Map<string, Doc>();
  private queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: ProjectStore,
    private readonly onChange: (e: ChangeEvent) => void,
  ) {}

  async get(slug: string): Promise<PatchResult> {
    return this.run(slug, async (doc) => this.result(doc));
  }

  async patch(
    slug: string,
    patch: unknown,
    opts: { author: Author; group?: string | null; label?: string; baseVersion?: number },
  ): Promise<PatchResult> {
    const parsed = TimelinePatch.safeParse(patch);
    if (!parsed.success) throw new RpcError(`invalid patch: ${formatIssues(parsed.error)}`, 'bad_request');
    return this.run(slug, async (doc) => {
      const before = doc.timeline;
      let after: Timeline;
      try {
        after = applyPatch(before, parsed.data);
      } catch (e) {
        if (e instanceof PatchError || e instanceof TimelineError)
          throw new RpcError(e.message, 'bad_request');
        throw e;
      }
      const inverse = invertPatch(before, parsed.data);
      const group = opts.group ?? null;
      const last = doc.undo[doc.undo.length - 1];
      if (group && last && last.group === group && last.author === opts.author) {
        last.forward.push(parsed.data);
        last.backward.unshift(inverse);
      } else {
        doc.undo.push({
          forward: [parsed.data],
          backward: [inverse],
          author: opts.author,
          group,
          label: opts.label ?? 'Edit',
        });
        if (doc.undo.length > 200) doc.undo.shift();
      }
      doc.redo = [];
      await this.commit(slug, doc, after, parsed.data, opts.author, 'patch');
      return this.result(doc);
    });
  }

  async undo(slug: string): Promise<PatchResult> {
    return this.run(slug, async (doc) => {
      const entry = doc.undo.pop();
      if (!entry) return this.result(doc);
      const combined = entry.backward.flat();
      const after = applyPatch(doc.timeline, combined);
      doc.redo.push(entry);
      await this.commit(slug, doc, after, combined, entry.author, 'undo');
      return this.result(doc);
    });
  }

  async redo(slug: string): Promise<PatchResult> {
    return this.run(slug, async (doc) => {
      const entry = doc.redo.pop();
      if (!entry) return this.result(doc);
      const combined = entry.forward.flat();
      const after = applyPatch(doc.timeline, combined);
      doc.undo.push(entry);
      await this.commit(slug, doc, after, combined, entry.author, 'redo');
      return this.result(doc);
    });
  }

  /** Reloads from disk (e.g. after a recording registered a take outside the store). */
  invalidate(slug: string): void {
    this.docs.delete(slug);
  }

  private result(doc: Doc): PatchResult {
    return {
      version: doc.version,
      timeline: doc.timeline,
      canUndo: doc.undo.length > 0,
      canRedo: doc.redo.length > 0,
    };
  }

  private async commit(
    slug: string,
    doc: Doc,
    after: Timeline,
    patch: TimelinePatch,
    author: Author,
    kind: ChangeEvent['kind'],
  ) {
    doc.timeline = after;
    doc.version++;
    await this.save(slug, after);
    this.onChange({
      slug,
      version: doc.version,
      patch,
      author,
      kind,
      canUndo: doc.undo.length > 0,
      canRedo: doc.redo.length > 0,
    });
  }

  private file(slug: string) {
    return path.join(this.store.dir(slug), 'tutorial.json');
  }

  private async load(slug: string): Promise<Doc> {
    let doc = this.docs.get(slug);
    if (doc) return doc;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.file(slug), 'utf8'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        throw new RpcError(`no project "${slug}"`, 'not_found');
      throw e;
    }
    doc = { timeline: parseTimeline(raw), version: 0, undo: [], redo: [] };
    this.docs.set(slug, doc);
    return doc;
  }

  /** Atomic write: never leaves a half-written tutorial.json. */
  private async save(slug: string, tl: Timeline) {
    const file = this.file(slug);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(tl, null, 2) + '\n');
    await rename(tmp, file);
  }

  /** Serializes operations per project. */
  private run<T>(slug: string, fn: (doc: Doc) => Promise<T>): Promise<T> {
    const prev = this.queues.get(slug) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(async () => fn(await this.load(slug)));
    this.queues.set(slug, next);
    return next;
  }
}
