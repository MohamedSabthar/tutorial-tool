import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildTimeMap,
  editPiece as editPieceOn,
  editRange as editRangeOn,
  insertExplainerScene,
  outputRemapper,
  remapOutputItems,
  removeExplainerScene,
  segmentDuration,
  voiceSpans,
  applyPatch,
  type PieceEdit,
  type Timeline,
  type TimelinePatch,
} from '@studio/core';
import { useEngine } from '../../engine';
import { useTimeline } from '../useTimeline';

export interface HistoryItem {
  label: string;
  author: 'user' | 'agent' | 'auto';
  at: number;
}
export type RangeEdit = { op: 'speed'; rate: number } | { op: 'remove' } | { op: 'auto' };
/** What a timing fit did, in numbers the screen can put into words. */
export interface FitReport {
  before: number;
  after: number;
  holds: number;
  spedUp: number;
}

/**
 * Every change the new Studio makes goes through here, so a dev preview can run the same
 * screen on an in-memory copy (`mock`) and never write to the workspace.
 */
export interface EditBackend {
  mock: boolean;
  timeline: Timeline | null;
  version: number;
  canUndo: boolean;
  canRedo: boolean;
  history: { undo: HistoryItem[]; redo: HistoryItem[] };
  /** Changes on their way to the engine. */
  saving: boolean;
  error: string | null;
  /** Patches with the same group (one drag) undo as one step. */
  patch: (p: TimelinePatch, label: string, group?: string | null) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  editRange: (from: number, to: number, edit: RangeEdit, label: string) => Promise<void>;
  editPiece: (sceneId: string, index: number, edit: PieceEdit) => Promise<void>;
  moveLine: (id: string, at: number) => Promise<void>;
  /** New words for a line: the engine voices it again. */
  revoice: (id: string, text: string) => Promise<void>;
  /** Saves a step's script and voices it. */
  voiceStep: (stepId: string, text: string) => Promise<void>;
  /** Inserts an explainer scene at output time `at` (freeze morphs in and out next to the recording). */
  insertScene: (at: number, component: string) => Promise<void>;
  removeScene: (sceneId: string) => Promise<void>;
  /** Rebuilds the automatic overlays (pointer, clicks, zooms); overlays added by hand stay. */
  autoOverlays: () => Promise<{ count: number }>;
  /** Freezes where the voice runs longer than the action, speeds up what runs on. */
  fitTiming: () => Promise<FitReport>;
  /** Moves a project overlay into the shared library. */
  promote: (id: string) => Promise<void>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const unknownMethod = (e: unknown) =>
  !!e && typeof e === 'object' && ((e as { code?: string }).code === 'unknown_method' || /unknown method/i.test(message(e)));

/** Replaces the recording scenes' pieces with those of `after` (the engine moves overlays to follow). */
function segmentsPatch(before: Timeline, after: Timeline): TimelinePatch {
  return after.scenes.flatMap((s, i) =>
    s.kind === 'recording' && JSON.stringify(s) !== JSON.stringify(before.scenes[i])
      ? [{ op: 'replace' as const, path: `/scenes/${i}/segments`, value: s.segments }]
      : [],
  );
}

/** The engine: timeline patches with server-side undo, piece and voice edits. */
export function useEngineBackend(slug: string, enabled: boolean): EditBackend {
  const { client } = useEngine();
  const tl = useTimeline(enabled ? slug : '');
  const [inflight, setInflight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ undo: HistoryItem[]; redo: HistoryItem[] }>({ undo: [], redo: [] });
  // Older engines have no timeline.history: keep this window's own list instead.
  const local = useRef<HistoryItem[] | null>(null);

  useEffect(() => {
    if (!client || !enabled || !tl.version) return;
    let live = true;
    void client.call('timeline.history', { slug }).then(
      (h) => live && setHistory(h),
      (e: unknown) => {
        if (live && unknownMethod(e)) {
          local.current ??= [];
          setHistory({ undo: [...local.current], redo: [] });
        }
      },
    );
    return () => {
      live = false;
    };
  }, [client, slug, enabled, tl.version]);

  const track = useCallback(async (label: string | null, fn: () => Promise<unknown>) => {
    setInflight((n) => n + 1);
    setError(null);
    try {
      await fn();
      if (label && local.current) local.current.push({ label, author: 'user', at: Date.now() });
    } catch (e) {
      setError(message(e));
      throw e;
    } finally {
      setInflight((n) => n - 1);
    }
  }, []);

  const patch = useCallback(
    (p: TimelinePatch, label: string, group?: string | null) =>
      track(label, () => tl.patch(p, { label, group: group ?? undefined })),
    [track, tl],
  );

  return {
    mock: false,
    timeline: tl.timeline,
    version: tl.version,
    canUndo: tl.canUndo,
    canRedo: tl.canRedo,
    history,
    saving: inflight > 0,
    error: error ?? tl.error,
    patch,
    undo: () =>
      track(null, async () => {
        await tl.undo();
        local.current?.pop();
      }),
    redo: () => track(null, () => tl.redo()),
    editRange: (from, to, edit, label) =>
      track(label, async () => {
        try {
          await client!.call('timeline.editRange', { slug, from, to, edit, label });
        } catch (e) {
          if (!unknownMethod(e) || !tl.timeline) throw e;
          // An engine from before timeline.editRange: the same edit as a segments patch.
          const after = editRangeOn(tl.timeline, from, to, edit).timeline;
          await tl.patch(segmentsPatch(tl.timeline, after), { label });
        }
      }),
    editPiece: (sceneId, index, edit) =>
      track('Edit the recording', () => client!.call('timeline.editPiece', { slug, sceneId, index, edit })),
    moveLine: (id, at) => track('Move voice-over', () => client!.call('vo.editLine', { slug, id, at })),
    revoice: (id, text) => track('Edit voice line', () => client!.call('vo.editLine', { slug, id, text })),
    voiceStep: (stepId, text) =>
      track('Voice a step', async () => {
        const i = tl.timeline?.steps.findIndex((s) => s.id === stepId) ?? -1;
        if (i < 0) throw new Error('That step is gone.');
        await tl.patch([{ op: 'replace', path: `/steps/${i}/narration`, value: text }], { label: 'Edit script' });
        await client!.call('vo.generate', { slug, stepIds: [stepId] });
      }),
    insertScene: (at, component) =>
      track('Insert explainer', () => client!.call('scenes.insert', { slug, at: Math.round(at * 100) / 100, component })),
    removeScene: (sceneId) => track('Remove explainer', () => client!.call('scenes.remove', { slug, sceneId })),
    autoOverlays: async () => {
      let count = 0;
      await track('Automatic overlays', async () => {
        count = (await client!.call('overlays.auto', { slug })).count;
      });
      return { count };
    },
    fitTiming: async () => {
      let report: FitReport = { before: 0, after: 0, holds: 0, spedUp: 0 };
      await track('Fit timing', async () => {
        const r = await client!.call('timing.fit', { slug });
        report = {
          before: r.before,
          after: r.after,
          holds: r.steps.filter((x) => x.hold > 0).length,
          spedUp: r.steps.filter((x) => x.saved > 0.5).length,
        };
      });
      return report;
    },
    promote: (id) => track(null, () => client!.call('library.promote', { slug, id })),
  };
}

/** The engine's scenes.insert on a timeline: the scene, freeze morphs next to the recording, later items moved. */
function insertWithMorphs(t: Timeline, at: number, component: string): Timeline {
  const { timeline: next, sceneId } = insertExplainerScene(t, at, {
    kind: 'explainer',
    component,
    props: {},
    narration: [],
    beats: [],
    duration: 'auto',
    estimatedDuration: 6,
  });
  const i = next.scenes.findIndex((s) => s.id === sceneId);
  const before = next.scenes[i - 1];
  const after = next.scenes[i + 1];
  const morph = (a: string, b: string) => ({
    id: `tr-${a}-${b}`,
    between: [a, b] as [string, string],
    component: 'core:FreezeMorph',
    duration: 1,
  });
  const withTransitions = {
    ...next,
    transitions: [
      ...next.transitions,
      ...(before?.kind === 'recording' ? [morph(before.id, sceneId)] : []),
      ...(after?.kind === 'recording' ? [morph(sceneId, after.id)] : []),
    ],
  };
  return remapOutputItems(withTransitions, outputRemapper(next, withTransitions));
}

/**
 * An in-memory copy of the project's timeline (read once from the engine) with its own undo.
 * Dev previews use it, so editing can be tried without writing anything to the workspace.
 */
export function useMockBackend(slug: string, enabled: boolean, seed?: (t: Timeline) => Timeline): EditBackend {
  const { client, state } = useEngine();
  const [doc, setDoc] = useState<{
    timeline: Timeline | null;
    version: number;
    undo: { label: string; at: number; before: Timeline }[];
    redo: { label: string; at: number; after: Timeline }[];
  }>({ timeline: null, version: 0, undo: [], redo: [] });
  const [saving, setSaving] = useState(false);
  const ref = useRef(doc);
  useEffect(() => {
    ref.current = doc;
  }, [doc]);
  useEffect(() => {
    if (!client || !enabled || state !== 'open') return;
    void client.call('timeline.get', { slug }).then(
      (r) => setDoc({ timeline: seed ? seed(r.timeline) : r.timeline, version: 1, undo: [], redo: [] }),
      () => undefined,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once per project
  }, [client, slug, enabled, state]);

  const change = useCallback(async (label: string, fn: (t: Timeline) => Timeline) => {
    const cur = ref.current;
    if (!cur.timeline) return;
    const next = fn(cur.timeline);
    setSaving(true);
    // A short "Saving…" so the save state can be seen in the preview.
    await new Promise((r) => setTimeout(r, 250));
    setSaving(false);
    setDoc((d) => ({
      timeline: next,
      version: d.version + 1,
      undo: [...d.undo, { label, at: Date.now(), before: d.timeline! }],
      redo: [],
    }));
  }, []);

  const d = doc;
  return {
    mock: true,
    timeline: d.timeline,
    version: d.version,
    canUndo: d.undo.length > 0,
    canRedo: d.redo.length > 0,
    history: {
      undo: d.undo.map((u) => ({ label: u.label, author: 'user', at: u.at })),
      redo: d.redo.map((u) => ({ label: u.label, author: 'user', at: u.at })),
    },
    saving,
    error: null,
    patch: (p, label) => change(label, (t) => applyPatch(t, p)),
    undo: async () =>
      setDoc((x) => {
        const last = x.undo.at(-1);
        if (!last || !x.timeline) return x;
        return {
          timeline: last.before,
          version: x.version + 1,
          undo: x.undo.slice(0, -1),
          redo: [...x.redo, { label: last.label, at: last.at, after: x.timeline }],
        };
      }),
    redo: async () =>
      setDoc((x) => {
        const last = x.redo.at(-1);
        if (!last || !x.timeline) return x;
        return {
          timeline: last.after,
          version: x.version + 1,
          redo: x.redo.slice(0, -1),
          undo: [...x.undo, { label: last.label, at: last.at, before: x.timeline }],
        };
      }),
    editRange: (from, to, edit, label) => change(label, (t) => editRangeOn(t, from, to, edit).timeline),
    editPiece: (sceneId, index, edit) =>
      change('Edit the recording', (t) => ({
        ...t,
        scenes: t.scenes.map((s) =>
          s.id === sceneId && s.kind === 'recording' ? { ...s, segments: editPieceOn(s.segments, index, edit) } : s,
        ),
      })),
    moveLine: (id, at) =>
      change('Move voice-over', (t) => {
        const span = voiceSpans(t, buildTimeMap(t)).find((s) => s.line.id === id);
        const shift = span ? at - span.start : 0;
        return { ...t, voice: t.voice.map((v) => (v.id === id ? { ...v, start: Math.max(0, v.start + shift), manual: true } : v)) };
      }),
    // The preview never voices anything: the words change, the audio stays.
    revoice: (id, text) =>
      change('Edit voice line', (t) => ({ ...t, voice: t.voice.map((v) => (v.id === id ? { ...v, text, manual: true } : v)) })),
    voiceStep: (stepId, text) =>
      change('Edit script', (t) => ({ ...t, steps: t.steps.map((s) => (s.id === stepId ? { ...s, narration: text } : s)) })),
    insertScene: (at, component) => change('Insert explainer', (t) => insertWithMorphs(t, at, component)),
    removeScene: (sceneId) => change('Remove explainer', (t) => removeExplainerScene(t, sceneId)),
    // The preview can't read the recording's clicks or re-time it: it reports what's there and changes nothing.
    autoOverlays: async () => {
      await new Promise((r) => setTimeout(r, 400));
      return { count: ref.current.timeline?.overlays.filter((o) => o.author === 'auto').length ?? 0 };
    },
    fitTiming: async () => {
      await new Promise((r) => setTimeout(r, 400));
      const t = ref.current.timeline;
      const len = t ? buildTimeMap(t).duration : 0;
      const segs = t?.scenes.flatMap((s) => (s.kind === 'recording' ? s.segments : [])) ?? [];
      return {
        before: len,
        after: len,
        holds: segs.filter((g) => g.kind === 'hold' && segmentDuration(g) > 0).length,
        spedUp: segs.filter((g) => g.kind === 'speed').length,
      };
    },
    promote: async () => {
      await new Promise((r) => setTimeout(r, 400));
    },
  };
}
