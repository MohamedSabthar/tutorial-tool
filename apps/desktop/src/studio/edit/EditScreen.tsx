import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  cutGaps,
  editPiece as editPieceOn,
  sfxCues,
  voiceSpans,
  type OverlayInstance,
  type PieceEdit,
  type Rect,
  type Run,
  type TimelinePatch,
  type VoiceLine,
} from '@studio/core';
import { resolveProps } from '@studio/overlays-core';
import { sourceToStage, Timed, usePlayerController, usePlayerValue } from '@studio/stage';
import {
  Button,
  Glyph,
  IconButton,
  LinkButton,
  Menu,
  MenuItem,
  MenuSeparator,
  Popover,
  Sheet,
  StatusPill,
  useToast,
} from '@studio/ui';
import { openLive, useEngine } from '../../engine';
import { usePipeline } from '../../pipeline';
import { HeaderStatus } from '../../routes/frame';
import { useLatestTake } from '../../useTake';
import { resolveTimeline, stepAt, type StepSpan } from '../resolve';
import { StageHost, STAGE, screenToStage } from '../StageHost';
import { Manipulator, type SnapTarget } from '../Manipulator';
import { useOverlayRegistry } from '../useOverlayRegistry';
import { useAgent } from '../useAgent';
import { useRuns } from '../useRuns';
import { useFullscreen } from '../fullscreen';
import { VoicePlayer } from '../VoicePlayer';
import { SfxPlayer } from '../SfxPlayer';
import { useEngineBackend, useMockBackend, type EditBackend } from './backend';
import { StepsRail } from './StepsRail';
import { StepPanel, type AddKind } from './StepPanel';
import { EditTimeline, EXTRA_TRACKS, pieceKey, type ExtraTrack, type Selection, type TimelineStep } from './EditTimeline';
import { PiecePanel } from './PiecePanel';
import { FixSheet, type FixKind } from './FixSheet';
import { ChangesList } from './ChangesPopover';
import { AgentDock } from './AgentDock';
import { agentActivity, agentTarget, cutsOver, isOnScreen, mmss, overlayName, stepPace } from './model';
import { previewAgent, previewFromHash, type Preview } from './previews';
import './EditScreen.css';

type Pick = 'arrow' | 'box' | 'blur' | 'note';
const PICK_HINT: Record<Pick, string> = {
  arrow: 'Click what to point at',
  box: 'Click what to outline',
  blur: 'Click what to hide',
  note: 'Click where the agent should look',
};
const COMPONENT: Record<'arrow' | 'box' | 'blur', string> = {
  arrow: 'core:Arrow',
  box: 'core:Box',
  blur: 'core:Blur',
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}`;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The preview requested in the address (dev builds only), kept current. */
function usePreview(): Preview | null {
  const [p, setP] = useState(() => previewFromHash(window.location.hash));
  useEffect(() => {
    const on = () => setP(previewFromHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return p;
}

/**
 * The Studio (Phase 13): steps on the left, the video with its transport, a compact timeline
 * and the agent dock in the middle, and the step at the playhead on the right.
 */
export function EditScreen({ slug }: { slug: string }) {
  const preview = usePreview();
  // A different preview starts from a fresh copy of the tutorial.
  return <Studio key={preview ?? 'live'} slug={slug} preview={preview} />;
}

function Studio({ slug, preview }: { slug: string; preview: Preview | null }) {
  const mock = preview !== null;
  const engineBackend = useEngineBackend(slug, !mock);
  const mockBackend = useMockBackend(
    slug,
    mock,
    preview === 'empty' ? (t) => ({ ...t, takes: [], scenes: [], steps: [], overlays: [], voice: [] }) : undefined,
  );
  const be: EditBackend = mock ? mockBackend : engineBackend;
  const timeline = be.timeline;
  const { client } = useEngine();
  const toast = useToast();
  const { take: latestTake, events, media } = useLatestTake(slug);
  const take = timeline?.takes.length ? latestTake : null;
  const { registry, reportError } = useOverlayRegistry(slug);
  const names = useMemo(
    () => Object.fromEntries(Object.entries(registry).map(([k, m]) => [k, m.meta?.name])),
    [registry],
  );
  const resolved = useMemo(() => (timeline ? resolveTimeline(timeline, events) : null), [timeline, events]);
  const duration = resolved?.tm.duration ?? 1;
  const controls = usePlayerController(duration);
  const playing = usePlayerValue(controls, (s) => s.playing);
  const rate = usePlayerValue(controls, (s) => s.rate);
  const now = () => controls.get().t;

  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    if (!client) return;
    void client.call('project.open', { slug }).then(
      (r) => setTitle(r.project.title),
      () => undefined,
    );
  }, [client, slug]);

  // Steps in output time; a skipped step (cut out) sits where its cut is.
  const steps: StepSpan[] = useMemo(() => {
    if (!resolved || !timeline) return [];
    let last = 0;
    return resolved.steps.map((s) => {
      const step = timeline.steps.find((x) => x.id === s.id);
      if (step && stepPace(timeline, step).kind === 'skip') return { ...s, start: last, end: last };
      last = s.end;
      return s;
    });
  }, [resolved, timeline]);
  const stepsLive = useMemo(() => steps.filter((s) => s.end > s.start), [steps]);
  // Before the first step (a title card), the first step is the one to edit.
  const currentId = usePlayerValue(controls, (s) => (stepAt(stepsLive, s.t) ?? stepsLive[0])?.id ?? null);
  const index = steps.findIndex((s) => s.id === currentId);
  const span = steps[index] ?? null;
  const step = span ? (timeline?.steps.find((s) => s.id === span.id) ?? null) : null;

  const [selection, setSelection] = useState<Selection>(null);
  const selectedOverlay =
    selection?.kind === 'overlay' ? (timeline?.overlays.find((o) => o.id === selection.id) ?? null) : null;
  const [pick, setPick] = useState<Pick | null>(null);
  const [sheet, setSheet] = useState(false);
  const [menu, setMenu] = useState(false);
  const [changes, setChanges] = useState(false);
  // Extra timeline tracks (Recording, Camera, Captions, Notes): a per-viewer choice, remembered.
  const [tracks, setTracksState] = useState<ExtraTrack[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('studio.tracks') ?? '[]') as unknown;
      return Array.isArray(v) ? EXTRA_TRACKS.map((t) => t.key).filter((k) => v.includes(k)) : [];
    } catch {
      return [];
    }
  });
  const setTracks = (next: ExtraTrack[]) => {
    setTracksState(next);
    try {
      localStorage.setItem('studio.tracks', JSON.stringify(next));
    } catch {
      // Not remembered; the choice still applies in this window.
    }
  };
  const [confirmRecord, setConfirmRecord] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [voicing, setVoicing] = useState<Set<string>>(new Set());
  const [paceBusy, setPaceBusy] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [ask, setAsk] = useState('');
  const [dragRect, setDragRect] = useState<Rect | null>(null);
  // "Cut a part out": starts at the playhead, the end is set on the timeline.
  const [cut, setCut] = useState<{ from: number; to: number | null } | null>(null);
  const [pieceBusy, setPieceBusy] = useState(false);
  const [full, setFull] = useFullscreen();
  const composer = useRef<HTMLTextAreaElement>(null);

  const agentLive = useAgent(slug);
  const { runs: realRuns } = useRuns(slug);
  const fixture = preview ? previewAgent(preview, slug, timeline) : null;
  const agentStatus = fixture ? fixture.status : agentLive.status;
  const agentEvents = fixture ? fixture.events : agentLive.events;
  const runs = fixture ? (fixture.run ? [...realRuns, fixture.run] : realRuns) : realRuns;
  const reviewRun = (fixture ? fixture.run : realRuns.filter((r) => r.status === 'review').at(-1)) ?? null;
  const working = agentStatus?.state === 'busy' || agentStatus?.state === 'starting';
  const activity = agentActivity(agentEvents);
  const target = working ? agentTarget(activity, stepsLive) : { stepId: null };
  const pipe = usePipeline(slug);
  const cues = pipe.state?.status === 'waiting' && pipe.state.gate?.kind === 'cues' ? (pipe.state.gate.cues ?? []) : [];

  const spans = useMemo(() => (timeline && resolved ? voiceSpans(timeline, resolved.tm) : []), [timeline, resolved]);
  const sfx = useMemo(
    () => (timeline?.sfx.enabled && take && events.length ? sfxCues(timeline, { [take.id]: events }) : []),
    [timeline, take, events],
  );

  /** Runs an action, reporting a failure as a toast. */
  const attempt = useCallback(
    async (fn: () => Promise<unknown>, done?: string, undo = false) => {
      try {
        await fn();
        if (done) toast(done, undo ? { undo: () => void be.undo() } : {});
      } catch (e) {
        toast(errText(e), { tone: 'error' });
      }
    },
    [toast, be],
  );
  const previewOnly = (what: string) => toast(`Preview: ${what} (nothing was sent)`);

  // ---------------------------------------------------------------------------
  // Overlays
  // ---------------------------------------------------------------------------
  const overlayIndex = (id: string) => timeline?.overlays.findIndex((o) => o.id === id) ?? -1;
  const stepNo = (at: number) => {
    const s = stepAt(stepsLive, at);
    return s ? steps.indexOf(s) + 1 : null;
  };
  function addOverlay(component: string, extra: Partial<OverlayInstance>, len: number, label: string) {
    if (!timeline) return;
    const id = uid(component.split(':')[1]!.toLowerCase());
    // A little before the playhead, so it's already on screen (past its entrance) where you are.
    const start = r2(Math.max(0, now() - 0.4));
    const value = {
      id,
      component,
      start,
      end: r2(Math.min(start + len, duration)),
      props: resolveProps(component, {}),
      ...extra,
    };
    controls.pause();
    void attempt(() => be.patch([{ op: 'add', path: '/overlays/-', value }], label), 'Added. Drag it on the video to adjust.', true);
    setSelection({ kind: 'overlay', id });
    return id;
  }
  function addLabel() {
    const n = stepNo(now());
    const id = addOverlay(
      'core:TextLabel',
      { props: { ...resolveProps('core:TextLabel', {}), text: 'Label', x: 96, y: 96 } },
      4,
      `Add a label${n ? ` in step ${n}` : ''}`,
    );
    if (id) setTimeout(() => document.getElementById(`ed-ovt-${id}`)?.focus(), 350);
  }
  /** Step targets on screen now (the current step's and the next one's), in stage px. */
  const snapTargets: SnapTarget[] =
    timeline && resolved?.fit
      ? timeline.steps
          .filter((s) => s.bbox && (s.id === currentId || s.id === steps[index + 1]?.id))
          .map((s) => ({ stepId: s.id, title: s.title, rect: sourceToStage(s.bbox!, resolved.fit!) }))
      : [];
  /** A click on the video while placing something. */
  function place(e: ReactMouseEvent<HTMLDivElement>) {
    if (!pick || !timeline || !resolved || !take) return;
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * STAGE.width;
    const py = ((e.clientY - box.top) / box.height) * STAGE.height;
    const t = now();
    const kind = pick;
    setPick(null);
    if (kind === 'note') {
      const id = uid('an');
      void attempt(() =>
        be.patch(
          [
            {
              op: 'add',
              path: '/annotations/-',
              value: { id, t: r2(t), shape: { kind: 'point', x: Math.round(px), y: Math.round(py) }, comment: '', status: 'open' },
            },
          ],
          'Add a note for the agent',
        ),
      );
      setNotes((n) => [...n, id]);
      setTimeout(() => composer.current?.focus(), 50);
      return;
    }
    const size = kind === 'arrow' ? { w: 40, h: 40, dx: 10 } : kind === 'box' ? { w: 240, h: 80, dx: 120 } : { w: 260, h: 60, dx: 130 };
    const screen = { x: px - size.dx, y: py - size.h / 2, w: size.w, h: size.h };
    const rect = screenToStage(screen, take, resolved.instances, t);
    const cx = rect.x + (kind === 'arrow' ? 10 : rect.w / 2);
    const cy = rect.y + rect.h / 2;
    // Clicked inside a recorded step's target: follow it (it moves with the screen).
    const hit =
      kind !== 'blur'
        ? snapTargets.find((s) => cx >= s.rect.x && cx <= s.rect.x + s.rect.w && cy >= s.rect.y && cy <= s.rect.y + s.rect.h)
        : undefined;
    const n = stepNo(t);
    const what = kind === 'arrow' ? 'an arrow' : kind === 'box' ? 'a box' : 'a hidden area';
    addOverlay(
      COMPONENT[kind],
      hit ? { anchor: { stepId: hit.stepId, target: 'primary' } } : { rect: { x: r2(rect.x), y: r2(rect.y), w: r2(rect.w), h: r2(rect.h) } },
      4,
      `Add ${what}${n ? ` in step ${n}` : ''}`,
    );
  }
  function editOverlay(o: OverlayInstance, change: { props?: Record<string, unknown>; end?: number }, label: string) {
    const i = overlayIndex(o.id);
    if (i < 0) return;
    const ops: TimelinePatch = [];
    if (change.props) ops.push({ op: 'replace', path: `/overlays/${i}/props`, value: change.props });
    if (change.end !== undefined) ops.push({ op: 'replace', path: `/overlays/${i}/end`, value: r2(Math.min(change.end, duration)) });
    if (ops.length) void attempt(() => be.patch(ops, label));
  }
  function removeOverlay(o: OverlayInstance) {
    const i = overlayIndex(o.id);
    if (i < 0) return;
    const name = overlayName(o, names[o.component]);
    setSelection(null);
    void attempt(() => be.patch([{ op: 'remove', path: `/overlays/${i}` }], `Remove ${name.toLowerCase()}`), `${name} removed.`, true);
  }
  function overlayTime(o: OverlayInstance, start: number, end: number, label: string) {
    const i = overlayIndex(o.id);
    if (i < 0) return;
    setSelection({ kind: 'overlay', id: o.id });
    void attempt(
      () =>
        be.patch(
          [
            { op: 'replace', path: `/overlays/${i}/start`, value: start },
            { op: 'replace', path: `/overlays/${i}/end`, value: end },
          ],
          label,
        ),
      `${label}.`,
      true,
    );
  }
  function commitManipulation(result: { anchor: string } | { rect: Rect }) {
    if (!timeline || !selectedOverlay) return;
    const i = overlayIndex(selectedOverlay.id);
    const base = `/overlays/${i}`;
    const ops: TimelinePatch = [];
    if ('anchor' in result) {
      ops.push({ op: selectedOverlay.anchor ? 'replace' : 'add', path: `${base}/anchor`, value: { stepId: result.anchor, target: 'primary' } });
      if (selectedOverlay.rect) ops.push({ op: 'remove', path: `${base}/rect` });
    } else {
      ops.push({ op: selectedOverlay.rect ? 'replace' : 'add', path: `${base}/rect`, value: result.rect });
      if (selectedOverlay.anchor) ops.push({ op: 'remove', path: `${base}/anchor` });
    }
    const name = overlayName(selectedOverlay, names[selectedOverlay.component]).toLowerCase();
    void attempt(() => be.patch(ops, `Move ${name} on the video`));
  }

  // ---------------------------------------------------------------------------
  // Steps: pace and trims
  // ---------------------------------------------------------------------------
  async function setPace(kind: 'normal' | 'fast' | 'skip') {
    if (!timeline || !step || !span) return;
    const n = index + 1;
    const pace = stepPace(timeline, step);
    setPaceBusy(true);
    try {
      if (pace.kind === 'skip') {
        // Put the step back first (one undo step per cut).
        for (const c of cutsOver(timeline, step).reverse()) await be.editPiece(c.sceneId, c.after, { op: 'restoreCut' });
        if (kind === 'normal') toast(`Step ${n} is back in the video.`, { undo: () => void be.undo() });
        else toast(`Step ${n} is back. Choose ${kind === 'fast' ? 'Faster' : 'Skip'} again to change its pace.`);
        return;
      }
      const label = kind === 'fast' ? `Step ${n} faster` : kind === 'skip' ? `Skip step ${n}` : `Step ${n} at normal pace`;
      const edit = kind === 'fast' ? ({ op: 'speed', rate: 2 } as const) : kind === 'skip' ? ({ op: 'remove' } as const) : ({ op: 'auto' } as const);
      await be.editRange(r2(span.start), r2(span.end), edit, label);
      toast(`${label}.`, { undo: () => void be.undo() });
    } catch (e) {
      toast(errText(e), { tone: 'error' });
    } finally {
      setPaceBusy(false);
    }
  }
  function trimStep(id: string, edge: 'start' | 'end', to: number) {
    if (!timeline) return;
    const s = steps.find((x) => x.id === id);
    const st = timeline.steps.find((x) => x.id === id);
    if (!s || !st) return;
    const n = steps.indexOf(s) + 1;
    const clamped = Math.min(Math.max(to, s.start), s.end);
    if (edge === 'end' && to < s.end - 0.05) {
      if (s.end - clamped < 0.1) return;
      void attempt(() => be.editRange(r2(clamped), r2(s.end), { op: 'remove' }, `Trim the end of step ${n}`), `Trimmed step ${n}.`, true);
    } else if (edge === 'start' && to > s.start + 0.05) {
      if (clamped - s.start < 0.1) return;
      void attempt(() => be.editRange(r2(s.start), r2(clamped), { op: 'remove' }, `Trim the start of step ${n}`), `Trimmed step ${n}.`, true);
    } else {
      // Dragged outwards: put back the cut next to that edge, if there is one.
      const cut = timeline.scenes
        .flatMap((sc) =>
          sc.kind === 'recording' && sc.take === st.take ? cutGaps(sc.segments).map((g) => ({ ...g, sceneId: sc.id })) : [],
        )
        .find((g) => (edge === 'end' ? Math.abs(g.from - st.to) < 1.5 || (g.from > st.from && g.from < st.to + 0.05) : Math.abs(g.to - st.from) < 1.5 || (g.to > st.from - 0.05 && g.to < st.to)));
      if (!cut) {
        toast(`Nothing was cut ${edge === 'end' ? 'after' : 'before'} step ${n} to put back.`);
        return;
      }
      void attempt(() => be.editPiece(cut.sceneId, cut.after, { op: 'restoreCut' }), `Put back the recording ${edge === 'end' ? 'after' : 'before'} step ${n}.`, true);
    }
  }

  // ---------------------------------------------------------------------------
  // Pieces of the recording: speed, freezes, cuts
  // ---------------------------------------------------------------------------
  const selectedPiece = (() => {
    if (selection?.kind !== 'piece' || !timeline || !resolved) return null;
    const cut = selection.id.lastIndexOf(':');
    const sceneId = selection.id.slice(0, cut);
    const i = Number(selection.id.slice(cut + 1));
    const scene = timeline.scenes.find((sc) => sc.id === sceneId);
    const span = resolved.tm.segments.find((g) => g.sceneId === sceneId && g.index === i);
    const segment = scene?.kind === 'recording' ? scene.segments[i] : undefined;
    return segment && span ? { sceneId, index: i, segment, start: span.start, end: span.end } : null;
  })();
  const playheadInPiece = usePlayerValue(
    controls,
    (s) => !!selectedPiece && s.t >= selectedPiece.start - 1e-6 && s.t < selectedPiece.end,
  );
  const PIECE_DONE: Record<PieceEdit['op'], string> = {
    speed: 'Changed the speed.',
    remove: 'Removed that part of the recording.',
    freeze: 'Froze the frame.',
    duration: 'Changed how long the freeze holds.',
    auto: 'Back to automatic timing.',
    restoreCut: 'Put back the recording.',
    trim: 'Trimmed the recording.',
  };
  async function pieceEdit(sceneId: string, index: number, edit: PieceEdit, done = PIECE_DONE[edit.op]) {
    setPieceBusy(true);
    try {
      await be.editPiece(sceneId, index, edit);
      if (edit.op === 'remove' || (edit.op === 'auto' && selectedPiece?.segment.kind === 'hold')) setSelection(null);
      toast(done, { undo: () => void be.undo() });
    } catch (e) {
      toast(errText(e), { tone: 'error' });
    } finally {
      setPieceBusy(false);
    }
  }
  /** Freezes the frame at output time `t` for `len` seconds, then selects the freeze. */
  async function freezeAt(t: number, len: number) {
    if (!timeline || !resolved) return;
    controls.pause();
    const g = resolved.tm.segments.find((x) => t >= x.start - 1e-6 && t < x.end);
    if (!g) {
      toast('There is no recording here to freeze.');
      return;
    }
    if (g.segment.kind === 'hold') {
      setSelection({ kind: 'piece', id: pieceKey(g.sceneId, g.index) });
      toast('This frame is already frozen. Change how long it holds on the right.');
      return;
    }
    const seg = g.segment;
    const pos = resolved.tm.toSource(t);
    const take = pos && pos.kind === 'recording' && pos.sceneId === g.sceneId ? pos.takeTime : resolved.sourceTime(t);
    const at = Math.round(Math.min(Math.max(take, seg.from), seg.to) * 1000) / 1000;
    const edit: PieceEdit = { op: 'freeze', at, duration: len };
    const scene = timeline.scenes.find((sc) => sc.id === g.sceneId);
    let holdIndex = g.index;
    if (scene?.kind === 'recording') {
      try {
        const after = editPieceOn(scene.segments, g.index, edit);
        holdIndex = [g.index, g.index + 1].find((i) => after[i]?.kind === 'hold' && after[i]?.manual) ?? g.index;
      } catch (e) {
        toast(errText(e), { tone: 'error' });
        return;
      }
    }
    setPieceBusy(true);
    try {
      await be.editPiece(g.sceneId, g.index, edit);
      setSelection({ kind: 'piece', id: pieceKey(g.sceneId, holdIndex) });
      toast(`Froze the frame at ${mmss(t)} for ${len} s.`, { undo: () => void be.undo() });
    } catch (e) {
      toast(errText(e), { tone: 'error' });
    } finally {
      setPieceBusy(false);
    }
  }
  const cutSpan = cut && cut.to !== null ? { a: Math.min(cut.from, cut.to), b: Math.max(cut.from, cut.to) } : null;
  const cutLen = cutSpan ? Math.round((cutSpan.b - cutSpan.a) * 10) / 10 : 0;
  function startCut() {
    controls.pause();
    setSelection(null);
    setCut({ from: r2(now()), to: null });
  }
  function doCut() {
    if (!cutSpan || cutLen < 0.1) return;
    const { a, b } = cutSpan;
    setCut(null);
    void attempt(
      () => be.editRange(r2(a), r2(b), { op: 'remove' }, `Cut ${mmss(a)}–${mmss(b)}`),
      `Cut ${mmss(a)}–${mmss(b)} out of the video.`,
      true,
    );
  }

  // ---------------------------------------------------------------------------
  // What's said
  // ---------------------------------------------------------------------------
  const draft = (key: string, text: string | null) =>
    setDrafts((d) => {
      const next = { ...d };
      if (text === null) delete next[key];
      else next[key] = text;
      return next;
    });
  const busy = (key: string, on: boolean) =>
    setVoicing((v) => {
      const next = new Set(v);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  async function revoice(line: VoiceLine, text: string) {
    busy(line.id, true);
    try {
      await be.revoice(line.id, text);
      draft(line.id, null);
      toast(mock ? 'Preview: the words changed; nothing was voiced.' : 'Re-voiced.', { undo: () => void be.undo() });
    } catch (e) {
      toast(errText(e), { tone: 'error' });
    } finally {
      busy(line.id, false);
    }
  }
  async function voiceStep(text: string) {
    if (!step) return;
    const key = `step:${step.id}`;
    busy(key, true);
    try {
      await be.voiceStep(step.id, text);
      draft(key, null);
      toast(mock ? 'Preview: the script changed; nothing was voiced.' : 'Voiced.');
    } catch (e) {
      toast(errText(e), { tone: 'error' });
    } finally {
      busy(key, false);
    }
  }
  const edited = useMemo(() => {
    const out = new Set<string>();
    for (const [k, v] of Object.entries(drafts)) {
      if (k.startsWith('step:')) out.add(k.slice(5));
      else {
        const line = timeline?.voice.find((l) => l.id === k);
        if (line && line.text !== v) out.add(line.owner);
      }
    }
    return out;
  }, [drafts, timeline]);

  // ---------------------------------------------------------------------------
  // Agent
  // ---------------------------------------------------------------------------
  const noteLabels = notes.map((id, i) => {
    const a = timeline?.annotations.find((x) => x.id === id);
    return { id, label: a ? `Note at ${mmss(a.t)}` : `Note ${i + 1}` };
  });
  async function send(text: string) {
    if (mock) {
      previewOnly(notes.length ? `your message and ${notes.length} note${notes.length > 1 ? 's' : ''}` : 'your message');
      return;
    }
    if (!client) return;
    try {
      if (notes.length && timeline) {
        const ops: TimelinePatch = notes.flatMap((id) => {
          const i = timeline.annotations.findIndex((a) => a.id === id);
          return i >= 0 ? [{ op: 'replace' as const, path: `/annotations/${i}/comment`, value: text }] : [];
        });
        if (ops.length) await be.patch(ops, 'Describe the note');
        await client.call('annotations.send', { slug, ids: notes });
        setNotes([]);
      } else {
        await agentLive.send(text);
      }
      setAsk('');
    } catch (e) {
      toast(errText(e), { tone: 'error' });
    }
  }
  function removeNote(id: string) {
    setNotes((n) => n.filter((x) => x !== id));
    const i = timeline?.annotations.findIndex((a) => a.id === id) ?? -1;
    if (i >= 0) void attempt(() => be.patch([{ op: 'remove', path: `/annotations/${i}` }], 'Remove a note'));
  }
  const runAction = (what: string, fn: () => Promise<unknown>, done: string) =>
    mock ? previewOnly(what) : void attempt(fn, done);
  const scan = (() => {
    if (!working || !target.stepId || !resolved?.fit || !timeline) return null;
    const box = timeline.steps.find((s) => s.id === target.stepId)?.bbox;
    if (!box) return null;
    const r = sourceToStage(box, resolved.fit);
    return { left: `${(r.x / STAGE.width) * 100}%`, top: `${(r.y / STAGE.height) * 100}%`, width: `${(r.w / STAGE.width) * 100}%`, height: `${(r.h / STAGE.height) * 100}%` };
  })();

  // ---------------------------------------------------------------------------
  // Undo, Fix this moment, keys
  // ---------------------------------------------------------------------------
  const undoItem = be.history.undo.at(-1);
  const redoItem = be.history.redo.at(-1);
  const undo = () =>
    void attempt(async () => {
      await be.undo();
      setSelection(null);
    }, undoItem ? `Undid: ${undoItem.label}` : 'Undone');
  const redo = () => void attempt(() => be.redo(), redoItem ? `Redid: ${redoItem.label}` : 'Redone');

  function fix(k: FixKind) {
    setSheet(false);
    controls.pause();
    const focus = (sel: string) => setTimeout(() => document.querySelector<HTMLElement>(sel)?.focus(), 60);
    if (k === 'say') focus('#ed-said');
    else if (k === 'arrow') setPick('arrow');
    else if (k === 'blur') setPick('blur');
    else if (k === 'label') addLabel();
    else if (k === 'pace') focus('#ed-pace [aria-pressed="true"]');
    else if (k === 'note') setPick('note');
    else if (k === 'hold') void freezeAt(now(), 2);
    else if (k === 'cut') startCut();
    else focus('#ed-ask');
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheet || confirmRecord) return;
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]')) {
        if (e.key === 'Escape') (el as HTMLElement).blur();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod) return;
      else if (e.key === ' ' && !el.closest('button, [role="button"], a')) {
        e.preventDefault();
        controls.toggle();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        controls.pause();
        setSheet(true);
      } else if (e.key === 'j') controls.seek(now() - 1);
      else if (e.key === 'k') controls.pause();
      else if (e.key === 'l') controls.seek(now() + 1);
      else if (e.key === 'ArrowLeft' && !el.closest('[role="slider"]')) controls.seek(now() - 1 / 30);
      else if (e.key === 'ArrowRight' && !el.closest('[role="slider"]')) controls.seek(now() + 1 / 30);
      else if ((e.key === 'Backspace' || e.key === 'Delete') && selectedOverlay) removeOverlay(selectedOverlay);
      else if (e.key === 'Escape') {
        if (cut) setCut(null);
        else if (pick) setPick(null);
        else if (full) setFull(false);
        else setSelection(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function seekStep(dir: -1 | 1) {
    const i = Math.max(0, stepsLive.findIndex((s) => s.id === currentId));
    const t = stepsLive[Math.min(Math.max(i + dir, 0), stepsLive.length - 1)];
    if (t) controls.seek(t.start + 0.01);
  }
  function selectFromTimeline(sel: Selection, seekTo?: number) {
    setSelection(sel);
    if (seekTo !== undefined) controls.seek(seekTo);
    if (sel?.kind === 'line') setTimeout(() => document.querySelector<HTMLElement>('#ed-said')?.scrollIntoView({ block: 'nearest' }), 60);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const saving = be.saving || preview === 'saving';
  const selectedInstance = resolved?.instances.find((i) => i.id === selectedOverlay?.id) ?? null;
  const selectedOnScreen = usePlayerValue(
    controls,
    (s) => !!selectedInstance && s.t >= selectedInstance.start && s.t <= selectedInstance.end,
  );
  const instances = resolved
    ? resolved.instances.map((i) => (i.id === selectedOverlay?.id && dragRect ? { ...i, anchor: dragRect } : i))
    : [];
  const src = take ? media(take.video) : null;
  const empty = !!timeline && (!timeline.takes.length || !take);
  const tlSteps: TimelineStep[] = timeline
    ? steps.map((s) => {
        const st = timeline.steps.find((x) => x.id === s.id);
        return { ...s, pace: st ? stepPace(timeline, st) : { kind: 'normal' } };
      })
    : [];
  const explainers = resolved
    ? resolved.tm.scenes.flatMap((sc) => {
        const scene = timeline?.scenes.find((x) => x.id === sc.sceneId);
        return scene?.kind === 'explainer'
          ? [{ id: scene.id, title: names[scene.component] ?? 'Explainer', start: sc.start, end: sc.end }]
          : [];
      })
    : [];
  const shownOverlays = timeline ? timeline.overlays.filter(isOnScreen) : [];
  const zooms = timeline ? timeline.overlays.filter((o) => o.component === 'core:Zoom') : [];
  const trackPieces = resolved ? resolved.tm.segments : [];
  const trackCuts =
    timeline && resolved
      ? timeline.scenes.flatMap((sc) =>
          sc.kind !== 'recording'
            ? []
            : cutGaps(sc.segments).flatMap((gap) => {
                const span = resolved.tm.segments.find((g) => g.sceneId === sc.id && g.index === gap.after);
                return span
                  ? [{ sceneId: sc.id, after: gap.after, at: span.end, label: `${mmss(gap.from)}–${mmss(gap.to)}` }]
                  : [];
              }),
        )
      : [];
  const notePins = timeline ? timeline.annotations.filter((a) => notes.includes(a.id) && a.shape.kind === 'point') : [];

  return (
    <div className="ed" data-full={full || undefined}>
      <header className="ed-top">
        <a className="ui-btn ui-btn-quiet ui-icon-btn" href="#/projects" aria-label="Back to tutorials" title="Back to tutorials">
          <Glyph name="back" size={16} />
        </a>
        <h1 className="ed-title" title={title ?? slug}>
          {title ?? slug}
        </h1>
        <span className="ed-save" role="status" aria-live="polite" title={be.error ?? undefined}>
          {saving ? (
            <>
              <span className="k-spin" aria-hidden="true" /> Saving…
            </>
          ) : be.error ? (
            <span className="ed-neg">
              <Glyph name="warn" size={12} /> Couldn't save
            </span>
          ) : (
            <>
              <Glyph name="check" size={12} /> Saved
            </>
          )}
        </span>
        {mock && (
          <StatusPill tone="warning" title="A dev preview: edits stay in this window and are never saved">
            Preview: {preview}
          </StatusPill>
        )}
        <span className="ed-grow" />
        <HeaderStatus live />
        <IconButton
          variant="quiet"
          label={undoItem ? `Undo: ${undoItem.label}` : be.canUndo ? 'Undo' : 'Nothing to undo'}
          disabled={!be.canUndo}
          onClick={undo}
        >
          <Glyph name="undo" size={14} />
        </IconButton>
        <IconButton
          variant="quiet"
          label={redoItem ? `Redo: ${redoItem.label}` : be.canRedo ? 'Redo' : 'Nothing to redo'}
          disabled={!be.canRedo}
          onClick={redo}
        >
          <Glyph name="redo" size={14} />
        </IconButton>
        <span className="ed-pop-wrap">
          <Button variant="quiet" aria-expanded={changes} aria-haspopup="dialog" onClick={() => setChanges((c) => !c)}>
            <Glyph name="history" size={14} />
            Changes
            <span className="k-pill" data-size="sm">
              {be.history.undo.length + runs.filter((r) => r.status !== 'empty').length}
            </span>
          </Button>
          <Popover open={changes} onClose={() => setChanges(false)} minWidth={360}>
            <ChangesList
              history={be.history.undo}
              runs={runs}
              onUndo={() => {
                setChanges(false);
                undo();
              }}
              onOpenRun={(r: Run) => {
                window.location.hash = `/agentfix/${slug}?run=${r.n}`;
              }}
            />
          </Popover>
        </span>
        <LinkButton variant="silver" href={`#/export/${slug}`}>
          <Glyph name="upload" size={14} />
          Export
        </LinkButton>
        <span className="ed-pop-wrap">
          <IconButton variant="quiet" label="More" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu((m) => !m)}>
            <Glyph name="dots" size={16} />
          </IconButton>
          <Popover open={menu} onClose={() => setMenu(false)} minWidth={240}>
            <Menu label="More">
              <MenuItem
                icon="record"
                onSelect={() => {
                  setMenu(false);
                  setConfirmRecord(true);
                }}
              >
                Record again…
              </MenuItem>
              <MenuItem
                icon="film"
                onSelect={() => {
                  window.location.hash = `/making/${slug}`;
                }}
              >
                Show how it was made
              </MenuItem>
              <MenuItem
                icon="folder"
                onSelect={() => {
                  setMenu(false);
                  void client?.call('project.reveal', { slug, path: '.' }).catch(() => undefined);
                }}
              >
                Open the tutorial folder
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                icon="timeline"
                hint="Recording, camera, captions and notes on the timeline"
                onSelect={() => {
                  setMenu(false);
                  setTracks(EXTRA_TRACKS.map((t) => t.key));
                }}
              >
                Show all tracks
              </MenuItem>
              {timeline && (
                <MenuItem
                  icon="mic"
                  onSelect={() => {
                    setMenu(false);
                    void attempt(() =>
                      be.patch(
                        [{ op: 'add', path: '/sfx', value: { ...timeline.sfx, enabled: !timeline.sfx.enabled } }],
                        timeline.sfx.enabled ? 'Turn click sounds off' : 'Turn click sounds on',
                      ),
                    );
                  }}
                >
                  {timeline.sfx.enabled ? 'Turn click sounds off' : 'Turn click sounds on'}
                </MenuItem>
              )}
            </Menu>
          </Popover>
        </span>
      </header>

      {!timeline ? (
        <div className="ed-loading">
          <span className="k-spin" aria-hidden="true" /> Loading the tutorial…
        </div>
      ) : empty ? (
        <div className="ed-empty">
          <div className="k-shell">
            <div className="k-panel ed-empty-in">
              <Glyph name="film" size={28} />
              <h2>No recording yet</h2>
              <p className="ed-muted">This tutorial hasn't been recorded. Make it first, then edit it here.</p>
              <LinkButton variant="brand" href={`#/making/${slug}`}>
                Go to making
              </LinkButton>
            </div>
          </div>
        </div>
      ) : (
        <main className="ed-body">
          <StepsRail
            timeline={timeline}
            steps={steps}
            currentId={currentId}
            src={src}
            badges={{
              agentStep: target.stepId,
              warnings: new Set(cues.map((c) => c.stepId)),
              edited,
            }}
            onSeek={(s) => controls.seek(s.start + 0.01)}
          />

          <section className="ed-center" aria-label="Video">
            <div className="ed-stagefit">
              {pick && (
                <div className="ed-pickhint" role="status">
                  {PICK_HINT[pick]}
                  <button type="button" onClick={() => setPick(null)}>
                    Cancel
                  </button>
                </div>
              )}
              <div
                className="ed-stagebox"
                data-picking={pick ? pick : undefined}
                data-agent={working || undefined}
                style={{ aspectRatio: `${timeline.size.w} / ${timeline.size.h}` }}
              >
                {take && src && resolved && (
                  <Timed player={controls}>
                    {(t) => (
                      <StageHost
                        take={take}
                        src={src}
                        events={events}
                        instances={instances}
                        t={t}
                        playing={playing}
                        sourceTime={resolved.sourceTime}
                        videoPlaying={playing && resolved.videoRuns(t)}
                        registry={registry}
                        onOverlayError={reportError}
                        captions={timeline.captions}
                        layers={resolved.layersAt(t)}
                      >
                        {!pick && selectedInstance?.anchor && selectedOnScreen && (
                          <Manipulator
                            rect={selectedInstance.anchor}
                            targets={snapTargets}
                            onDrag={setDragRect}
                            onCommit={commitManipulation}
                          />
                        )}
                      </StageHost>
                    )}
                  </Timed>
                )}
                <Timed player={controls}>
                  {(t) => (
                    <>
                      {notePins
                        .filter((a) => Math.abs(a.t - t) < 4)
                        .map((a) =>
                          a.shape.kind === 'point' ? (
                            <span
                              key={a.id}
                              className="ed-pin"
                              style={{ left: `${(a.shape.x / STAGE.width) * 100}%`, top: `${(a.shape.y / STAGE.height) * 100}%` }}
                              aria-hidden="true"
                            />
                          ) : null,
                        )}
                    </>
                  )}
                </Timed>
                {scan && (
                  <>
                    <div className="ed-scan" style={scan} aria-hidden="true" />
                    <span className="ed-scan-tag" style={{ left: scan.left, top: scan.top }} aria-hidden="true">
                      Agent
                    </span>
                  </>
                )}
                {pick && (
                  <div
                    className="ed-picklayer"
                    role="button"
                    tabIndex={0}
                    aria-label={PICK_HINT[pick]}
                    onClick={place}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setPick(null);
                    }}
                  />
                )}
              </div>
            </div>

            <div className="ed-ctrl">
              <IconButton variant="quiet" label="Previous step" onClick={() => seekStep(-1)}>
                <Glyph name="back" size={14} />
              </IconButton>
              <button type="button" className="ed-play" aria-label={playing ? 'Pause' : 'Play'} onClick={() => controls.toggle()}>
                <Glyph name={playing ? 'pause' : 'play'} size={16} />
              </button>
              <IconButton variant="quiet" label="Next step" onClick={() => seekStep(1)}>
                <Glyph name="next" size={14} />
              </IconButton>
              <span className="ed-tc">
                <Timed player={controls}>{(t) => mmss(t, true)}</Timed> / {mmss(duration)}
              </span>
              {span && (
                <StatusPill>
                  Step {index + 1} of {steps.length}
                </StatusPill>
              )}
              <span className="ed-grow" />
              <Button
                size="sm"
                variant="quiet"
                aria-pressed={timeline.showCaptions}
                onClick={() =>
                  void attempt(() =>
                    be.patch(
                      [{ op: 'add', path: '/showCaptions', value: !timeline.showCaptions }],
                      timeline.showCaptions ? 'Hide captions' : 'Show captions',
                    ),
                  )
                }
              >
                {timeline.showCaptions ? 'Captions on' : 'Captions off'}
              </Button>
              <IconButton variant="quiet" label={full ? 'Exit full screen (Esc)' : 'Full screen'} onClick={() => setFull(!full)}>
                <Glyph name="expand" size={14} />
              </IconButton>
              <Button
                variant="brand"
                className="ed-fixbtn"
                onClick={() => {
                  controls.pause();
                  setSheet(true);
                }}
                title="Fix this moment (F)"
              >
                <Glyph name="wand" size={14} />
                Fix this moment
              </Button>
            </div>

            {cut && (
              <div className="ed-cutbar" role="group" aria-label="Cut a part out">
                <Glyph name="trash" size={14} />
                <span className="ed-grow ed-s13" role="status" aria-live="polite">
                  {cutSpan ? (
                    <>
                      Cut{' '}
                      <b className="ed-tab">
                        {mmss(cutSpan.a)}–{mmss(cutSpan.b)}
                      </b>{' '}
                      ({cutLen} s)
                    </>
                  ) : (
                    <>
                      Cut from <b className="ed-tab">{mmss(cut.from)}</b>. Click or drag on the timeline to set where it ends.
                    </>
                  )}
                </span>
                <Button size="sm" variant="quiet" onClick={() => setCut({ ...cut, to: r2(now()) })} title="Use the playhead as the end">
                  End at the playhead
                </Button>
                <Button size="sm" onClick={() => setCut(null)}>
                  Cancel
                </Button>
                <Button size="sm" variant="danger" disabled={!cutSpan || cutLen < 0.1} onClick={doCut}>
                  Cut
                </Button>
              </div>
            )}

            <EditTimeline
              player={controls}
              duration={duration}
              steps={tlSteps}
              explainers={explainers}
              lines={spans}
              overlays={shownOverlays}
              names={names}
              selection={selection}
              onSelect={selectFromTimeline}
              onTrimStep={trimStep}
              onMoveLine={(id, at) => void attempt(() => be.moveLine(id, at), 'Moved the voice-over.', true)}
              onOverlayTime={overlayTime}
              tracks={tracks}
              onTracks={setTracks}
              pieces={trackPieces}
              cuts={trackCuts}
              zooms={zooms}
              captions={timeline?.captions ?? []}
              notes={(timeline?.annotations ?? []).map((a) => ({ id: a.id, t: a.t, text: a.comment, done: a.status === 'resolved' }))}
              onFreezeLength={(sceneId, index, len) =>
                void pieceEdit(sceneId, index, { op: 'duration', duration: len }, `The freeze now holds for ${len} s.`)
              }
              range={cut}
              onRangeEnd={(t) => {
                setCut((c) => (c ? { ...c, to: r2(t) } : c));
                controls.seek(t);
              }}
              onTrimPiece={(sceneId, index, edge) =>
                void attempt(() => be.editPiece(sceneId, index, { op: 'trim', ...edge }), 'Trimmed the recording.', true)
              }
              onRestoreCut={(sceneId, after) =>
                void attempt(() => be.editPiece(sceneId, after, { op: 'restoreCut' }), 'Put back the recording.', true)
              }
              onEditCaption={(i, text) =>
                void attempt(
                  () =>
                    be.patch(
                      [
                        { op: 'replace', path: `/captions/${i}/text`, value: text },
                        { op: 'add', path: `/captions/${i}/edited`, value: true },
                      ],
                      'Edit a caption',
                    ),
                  'Caption changed.',
                  true,
                )
              }
            />

            <AgentDock
              slug={slug}
              status={agentStatus}
              events={agentEvents}
              run={reviewRun}
              notes={noteLabels}
              composer={composer}
              draft={ask}
              onDraft={setAsk}
              onSend={(text) => void send(text)}
              onStop={() => (mock ? previewOnly('Stop') : void agentLive.interrupt())}
              onAnswer={(id, allow) => (mock ? previewOnly(allow ? 'Allow' : 'Not now') : void agentLive.answer(id, allow))}
              onKeep={(r) => runAction('Keep', () => client!.call('runs.accept', { slug, n: r.n }), 'Kept.')}
              onUndoRun={(r) => runAction('Undo this', () => client!.call('runs.revert', { slug, n: r.n }), 'Undid the agent’s change.')}
              onFollowUp={(r, text) => {
                if (mock) previewOnly('the follow-up');
                else void attempt(() => client!.call('runs.followUp', { slug, n: r.n, text }).then(() => setAsk('')), 'Sent.');
              }}
              onPin={() => {
                controls.pause();
                setPick('note');
              }}
              onRemoveNote={removeNote}
              frameUrl={(rel) => media(rel)}
            />
          </section>

          {selectedPiece ? (
            <PiecePanel
              key={selection?.id}
              segment={selectedPiece.segment}
              start={selectedPiece.start}
              end={selectedPiece.end}
              busy={pieceBusy}
              playheadInside={playheadInPiece}
              onEdit={(edit) => void pieceEdit(selectedPiece.sceneId, selectedPiece.index, edit)}
              onFreeze={(len) => void freezeAt(now(), len)}
              onClose={() => setSelection(null)}
            />
          ) : step && span ? (
            <StepPanel
              timeline={timeline}
              step={step}
              span={span}
              index={index}
              pace={stepPace(timeline, step)}
              drafts={drafts}
              onDraft={draft}
              voicing={voicing}
              onRevoice={(l, text) => void revoice(l, text)}
              onVoiceStep={(text) => void voiceStep(text)}
              selected={selectedOverlay?.id ?? null}
              onSelect={(id) => {
                setSelection(id ? { kind: 'overlay', id } : null);
                const o = id ? timeline.overlays.find((x) => x.id === id) : null;
                if (o && (now() < o.start || now() > o.end)) controls.seek(Math.min(o.start + 0.4, o.end));
              }}
              names={names}
              onAdd={(k: AddKind) => {
                if (k === 'label') addLabel();
                else {
                  controls.pause();
                  setPick(k);
                }
              }}
              onEditOverlay={editOverlay}
              onRemoveOverlay={removeOverlay}
              onPace={(k) => void setPace(k)}
              paceBusy={paceBusy}
              lateCues={cues.filter((c) => c.stepId === step.id)}
              onFixCues={
                cues.length
                  ? () => (mock ? previewOnly('Fix it') : void pipe.approve({ choice: 'edit' }))
                  : null
              }
            />
          ) : (
            <aside className="k-shell ed-side ed-side-empty">
              <p className="ed-muted ed-s13">Play or pick a step to edit it here.</p>
            </aside>
          )}
        </main>
      )}

      <FixSheet
        open={sheet}
        at={now()}
        step={span ? `Step ${index + 1}: ${span.title}` : null}
        onClose={() => setSheet(false)}
        onPick={fix}
      />

      <Sheet open={confirmRecord} onClose={() => setConfirmRecord(false)} title="Record this tutorial again?" width={460}>
        <p className="ed-s13 ed-sheet-p">
          WSO2 Integrator opens and the whole tutorial is recorded again. The steps are rebuilt from the new recording; your
          overlays, notes and voice-over are kept.
        </p>
        <div className="ed-row ed-row-end">
          <Button onClick={() => setConfirmRecord(false)}>Cancel</Button>
          <Button
            variant="brand"
            onClick={() => {
              setConfirmRecord(false);
              if (mock) return previewOnly('Record again');
              if (!client) return;
              void client
                .call('project.record', { slug, mode: 'record' })
                .catch((e: unknown) => toast(errText(e), { tone: 'error' }));
              openLive(slug);
            }}
          >
            Record again
          </Button>
        </div>
      </Sheet>

      <Timed player={controls}>
        {(t) => (
          <>
            <VoicePlayer spans={spans} t={t} playing={playing} rate={rate} media={media} onSync={(at) => controls.seek(at)} />
            <SfxPlayer cues={sfx} t={t} playing={playing} rate={rate} volume={timeline?.sfx.volume ?? 0.5} />
          </>
        )}
      </Timed>
    </div>
  );
}
