import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { OverlayModule } from '@studio/overlay-sdk';
import {
  buildTimeMap,
  pointerOverlayInstances,
  sfxCues,
  voiceSpans,
  type Segment,
  type TimelinePatch,
} from '@studio/core';
import { resolveProps } from '@studio/overlays-core';
import { Timed, usePlayerController, usePlayerValue } from '@studio/stage';
import {
  AppHeader,
  Button,
  Chip,
  EdgeAccent,
  GateBanner,
  IconButton,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  LinkButton,
  Panel,
  Pill,
  Segmented,
  Select,
} from '@studio/ui';
import { openLive, useEngine } from '../engine';
import { usePipeline } from '../pipeline';
import { appHrefs, HeaderStatus, useLiveSession } from '../routes/frame';
import { ProjectBar } from '../routes/ProjectBar';
import { useLatestTake } from '../useTake';
import { SfxPlayer } from './SfxPlayer';
import { resolveTimeline, stepAt } from './resolve';
import { StageHost } from './StageHost';
import { TimelinePanel } from './TimelinePanel';
import { Inspector } from './Inspector';
import { Library } from './Library';
import { VoicePlayer } from './VoicePlayer';
import { ToolRail, toolForKey, type Tool } from './ToolRail';
import { AnnotationLayer, AnnotationsPanel, type Shape } from './Annotations';
import { AnnotationPopover } from './AnnotationPopover';
import { screenToStage } from './StageHost';
import { useRuns } from './useRuns';
import { ExplainerInspector } from './ExplainerInspector';
import { ExplainerStoryboard, useExplainers } from '../routes/storyboard/ExplainerStoryboard';
import { Manipulator, type SnapTarget } from './Manipulator';
import { sourceToStage } from '@studio/stage';
import type { Rect } from '@studio/core';
import { useOverlayRegistry } from './useOverlayRegistry';
import { useTimeline } from './useTimeline';
import { AgentPanel } from './AgentPanel';
import { PipelinePanel } from './PipelinePanel';
import { KnowledgePanel } from './KnowledgePanel';
import { ExportButton } from './ExportButton';

/** A component's default props, or {} when its schema can't produce them. */
function defaultProps(
  schema: { safeParse?: (v: unknown) => { success: boolean; data?: unknown } } | undefined,
) {
  const r = schema?.safeParse?.({});
  return r?.success && r.data && typeof r.data === 'object' ? (r.data as Record<string, unknown>) : {};
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const ANCHORED = new Set([
  'core:Zoom',
  'core:Highlight',
  'core:Box',
  'core:Arrow',
  'core:Callout',
  'core:Blur',
]);
type View = 'Final' | 'With annotations' | 'Raw take';

const SIDES = ['Steps', 'Pipeline', 'Agent', 'Knowledge'] as const;
type Side = (typeof SIDES)[number];
const TIMELINE_MIN = 160;
const TIMELINE_MAX = 640;
const clampTimeline = (h: number) => Math.round(Math.min(TIMELINE_MAX, Math.max(TIMELINE_MIN, h)));

/** Per-viewer layout preferences (may be unavailable, e.g. in private mode). */
function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not saved: the layout still works for this visit.
  }
}

/**
 * The Studio: one window-high screen with the project sidebar, the preview and the inspector
 * side by side, and the timeline docked underneath (resizable), so the preview and the
 * timeline are always in view together.
 */
export function StudioScreen({ slug }: { slug: string }) {
  const { client } = useEngine();
  const tl = useTimeline(slug);
  const { take, events, media } = useLatestTake(slug);
  const { registry, reportError } = useOverlayRegistry(slug);
  const resolved = useMemo(
    () => (tl.timeline ? resolveTimeline(tl.timeline, events) : null),
    [tl.timeline, events],
  );
  const duration = resolved?.tm.duration ?? 1;
  // The screen doesn't re-render as time passes: what follows the playhead subscribes itself
  // (<Timed>, usePlayerValue), and handlers read the time when they run.
  const controls = usePlayerController(duration);
  const playing = usePlayerValue(controls, (s) => s.playing);
  const rate = usePlayerValue(controls, (s) => s.rate);
  // Click and typing sounds from the take's events, in output time.
  const sfx = useMemo(
    () =>
      tl.timeline?.sfx.enabled && take && events?.length ? sfxCues(tl.timeline, { [take.id]: events }) : [],
    [tl.timeline, take, events],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>('Final');
  const [tool, setTool] = useState<Tool>('select');
  const [sceneComponent, setSceneComponent] = useState<string>('');
  const [selectedScene, setSelectedScene] = useState<string | null>(null);
  const jobs = useExplainers(slug).filter(
    (j) => j.status === 'storyboarding' || j.status === 'review' || j.status === 'building',
  );
  const { runs } = useRuns(slug);
  const toReview = runs.filter((r) => r.status === 'review');
  const [note, setNote] = useState<string | null>(null);
  /** A note created by the last click: closing it empty discards it. */
  const [fresh, setFresh] = useState<string | null>(null);
  const [dragRect, setDragRect] = useState<Rect | null>(null);
  const live = useLiveSession();
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    if (!client) return;
    void client.call('project.open', { slug }).then(
      (r) => setTitle(r.project.title),
      () => undefined,
    );
  }, [client, slug]);
  const pipe = usePipeline(slug);
  const [confirmRecord, setConfirmRecord] = useState(false);
  const [side, setSide] = useState<Side>(() => {
    // A link may open a tab (`#/studio/<slug>?side=Pipeline`); otherwise the last one used.
    const v =
      new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('side') ?? readPref('studio.side');
    return SIDES.includes(v as Side) ? (v as Side) : 'Steps';
  });
  const chooseSide = (v: Side) => {
    setSide(v);
    writePref('studio.side', v);
  };
  const [centre, setCentre] = useState<'Preview' | 'Review'>('Preview');
  // About a third of the window unless the user has resized it.
  const [timelineH, setTimelineH] = useState(() =>
    clampTimeline(Number(readPref('studio.timelineH')) || window.innerHeight * 0.32),
  );
  const resizeTimeline = (h: number) => {
    const v = clampTimeline(h);
    setTimelineH(v);
    writePref('studio.timelineH', String(v));
  };
  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const y0 = e.clientY;
    const h0 = timelineH;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => resizeTimeline(h0 + (y0 - ev.clientY));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const reRecord = () => {
    setConfirmRecord(false);
    if (!client) return;
    // Long-running: Live shows its progress; a failure is reported there and on the next visit.
    void client
      .call('project.record', { slug, mode: 'record' })
      .catch((e: unknown) => setSending({ text: e instanceof Error ? e.message : String(e), tone: 'error' }));
    openLive(slug);
  };

  const now = () => controls.get().t;
  const spans = useMemo(
    () => (tl.timeline && resolved ? voiceSpans(tl.timeline, resolved.tm) : []),
    [tl.timeline, resolved],
  );
  const steps = resolved?.steps ?? [];
  // Changes a few times per video, not every frame.
  const currentId = usePlayerValue(controls, (s) => stepAt(steps, s.t)?.id ?? null);
  const current = steps.find((s) => s.id === currentId) ?? null;

  function seekStep(dir: -1 | 1) {
    const i = current ? steps.indexOf(current) : -1;
    const target = steps[Math.min(Math.max(i + dir, 0), steps.length - 1)];
    if (target) controls.seek(target.start);
  }

  function split() {
    if (!tl.timeline || !resolved) return;
    const pos = resolved.tm.toSource(now());
    if (!pos || pos.kind !== 'recording') return;
    const si = tl.timeline.scenes.findIndex((s) => s.id === pos.sceneId);
    const scene = tl.timeline.scenes[si];
    if (!scene || scene.kind !== 'recording') return;
    const seg = scene.segments[pos.segment];
    if (!seg || seg.kind === 'hold') return;
    const cut = pos.takeTime;
    if (cut - seg.from < 0.1 || seg.to - cut < 0.1) return;
    const parts: Segment[] = [
      { ...seg, to: cut },
      { ...seg, from: cut },
    ];
    const segments = [
      ...scene.segments.slice(0, pos.segment),
      ...parts,
      ...scene.segments.slice(pos.segment + 1),
    ];
    void tl.patch([{ op: 'replace', path: `/scenes/${si}/segments`, value: segments }], { label: 'Split' });
  }

  function addOverlay(adding: string, at = now()) {
    if (!tl.timeline) return;
    const meta = registry[adding]?.meta;
    const len = meta?.defaultDuration ?? 3;
    const anchored = ANCHORED.has(adding);
    const here = stepAt(steps, at);
    const step = here && tl.timeline.steps.find((s) => s.id === here.id && s.bbox);
    const id = `${adding.split(':')[1]!.toLowerCase()}-${Date.now().toString(36)}`;
    const start = Math.round(at * 100) / 100;
    const value = {
      id,
      component: adding,
      start,
      end: Math.min(start + len, duration),
      props: adding.startsWith('core:')
        ? resolveProps(adding, {})
        : defaultProps(registry[adding]?.meta.props),
      ...(anchored && step ? { anchor: { stepId: step.id, target: 'primary' } } : {}),
    };
    void tl.patch([{ op: 'add', path: '/overlays/-', value }], { label: `Add ${meta?.name ?? adding}` });
    setSelected(id);
  }

  // Keyboard shortcuts (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void (e.shiftKey ? tl.redo() : tl.undo());
      } else if (e.key === ' ') {
        e.preventDefault();
        controls.toggle();
      } else if (e.key === 'j') controls.seek(controls.get().t - 1);
      else if (e.key === 'k') controls.pause();
      else if (e.key === 'l') controls.seek(controls.get().t + 1);
      else if (e.key === 'ArrowLeft') controls.seek(controls.get().t - 1 / 30);
      else if (e.key === 'ArrowRight') controls.seek(controls.get().t + 1 / 30);
      else if (e.key === 's') split();
      else if (e.key === 'x') insertExplainer();
      else if (!mod && !e.altKey && toolForKey(e.key)) chooseTool(toolForKey(e.key)!);
      else if ((e.key === 'Backspace' || e.key === 'Delete') && selected && tl.timeline) {
        const i = tl.timeline.overlays.findIndex((o) => o.id === selected);
        if (i >= 0)
          void tl.patch([{ op: 'remove', path: `/overlays/${i}` }] as TimelinePatch, {
            label: 'Delete overlay',
          });
        setSelected(null);
      } else if (e.key === 'Escape') {
        setSelected(null);
        setTool('select');
        closeNote();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function chooseTool(next: Tool) {
    setTool(next);
    if (next === 'pin' || next === 'region') setView('With annotations');
  }

  const noteIndex = (id: string) => tl.timeline?.annotations.findIndex((a) => a.id === id) ?? -1;
  function patchNote(id: string, path: string, value: unknown, label: string) {
    const i = noteIndex(id);
    if (i >= 0) void tl.patch([{ op: 'replace', path: `/annotations/${i}/${path}`, value }], { label });
  }
  function removeNote(id: string) {
    const i = noteIndex(id);
    if (i >= 0) void tl.patch([{ op: 'remove', path: `/annotations/${i}` }], { label: 'Delete annotation' });
    if (note === id) setNote(null);
  }
  function closeNote() {
    const a = note ? tl.timeline?.annotations.find((x) => x.id === note) : null;
    if (a && a.id === fresh && !a.comment.trim()) removeNote(a.id);
    setNote(null);
    setFresh(null);
  }
  function createNote(shape: Shape) {
    controls.pause();
    const id = `an-${Date.now().toString(36)}`;
    void tl.patch(
      [
        {
          op: 'add',
          path: '/annotations/-',
          value: { id, t: Math.round(now() * 100) / 100, shape, comment: '', status: 'open' },
        },
      ],
      { label: 'Add annotation' },
    );
    setNote(id);
    setFresh(id);
    setTool('select');
  }
  /** T, Z and B on the preview: a TextLabel at the point, or a Zoom/Blur over the area. */
  function addFromArea(kind: 'text' | 'zoom' | 'blur', area: Rect) {
    if (!take || !resolved) return;
    controls.pause();
    const id = `${kind}-${Date.now().toString(36)}`;
    const t = now();
    const start = Math.round(t * 100) / 100;
    const component = kind === 'text' ? 'core:TextLabel' : kind === 'zoom' ? 'core:Zoom' : 'core:Blur';
    const len = kind === 'zoom' ? 2.5 : kind === 'blur' ? 3 : 2;
    const value =
      kind === 'text'
        ? {
            id,
            component,
            start,
            end: Math.min(start + len, duration),
            props: { ...resolveProps(component, {}), x: area.x, y: area.y },
          }
        : {
            id,
            component,
            start,
            end: Math.min(start + len, duration),
            rect: screenToStage(area, take, resolved.instances, t),
            props: resolveProps(component, {}),
          };
    void tl.patch([{ op: 'add', path: '/overlays/-', value }], { label: `Add ${component.slice(5)}` });
    setSelected(id);
    setTool('select');
  }
  const [sending, setSending] = useState<{ text: string; tone: 'ok' | 'error' | 'info' } | null>(null);
  /** Sends annotations to the project's agent (one turn with frames and context). */
  async function sendNotes(ids?: string[]) {
    if (!client) return;
    setSending({ text: 'Sending…', tone: 'info' });
    try {
      const r = await client.call('annotations.send', { slug, ...(ids ? { ids } : {}) });
      setSending({ text: `Sent ${r.sent} annotation${r.sent === 1 ? '' : 's'} to the agent`, tone: 'ok' });
    } catch (e) {
      setSending({ text: e instanceof Error ? e.message : String(e), tone: 'error' });
    }
  }
  /** Inserts the chosen explainer scene at the playhead (X). */
  function insertExplainer() {
    const scenesAvailable = Object.entries(registry).filter(([, m]) => m.meta?.kind === 'scene');
    const component = sceneComponent || scenesAvailable[0]?.[0];
    if (!client || !component) {
      setSending({ text: 'No explainer scenes yet: add one to scenes/ (or ask the agent)', tone: 'error' });
      return;
    }
    controls.pause();
    void client
      .call('scenes.insert', { slug, at: Math.round(now() * 100) / 100, component })
      .catch((e: unknown) => setSending({ text: e instanceof Error ? e.message : String(e), tone: 'error' }));
  }
  const stepLabel = (at: number) => {
    const i = steps.findIndex((s) => at >= s.start && at < s.end);
    return i >= 0 ? `step ${i + 1}` : null;
  };

  const selectedOverlay = tl.timeline?.overlays.find((o) => o.id === selected) ?? null;
  const selectedInstance = resolved?.instances.find((i) => i.id === selected) ?? null;
  const selectedOnScreen = usePlayerValue(
    controls,
    (s) => !!selectedInstance && s.t >= selectedInstance.start && s.t <= selectedInstance.end,
  );
  const showHandles = !!selectedInstance?.anchor && view !== 'Raw take' && selectedOnScreen;
  // Only targets on screen now: the current step's and the next step's (its first click is often visible).
  const nearSteps = new Set(
    current ? [current.id, steps[steps.indexOf(current) + 1]?.id].filter(Boolean) : [],
  );
  const snapTargets: SnapTarget[] =
    tl.timeline && resolved?.fit
      ? tl.timeline.steps
          .filter((s) => s.bbox && nearSteps.has(s.id))
          .map((s) => ({ stepId: s.id, title: s.title, rect: sourceToStage(s.bbox!, resolved.fit!) }))
      : [];
  const instances = resolved
    ? resolved.instances.map((i) => (i.id === selected && dragRect ? { ...i, anchor: dragRect } : i))
    : [];

  function commitManipulation(result: { anchor: string } | { rect: Rect }) {
    if (!tl.timeline || !selectedOverlay) return;
    const i = tl.timeline.overlays.findIndex((o) => o.id === selectedOverlay.id);
    const base = `/overlays/${i}`;
    const ops: TimelinePatch = [];
    if ('anchor' in result) {
      ops.push({
        op: selectedOverlay.anchor ? 'replace' : 'add',
        path: `${base}/anchor`,
        value: { stepId: result.anchor, target: 'primary' },
      });
      if (selectedOverlay.rect) ops.push({ op: 'remove', path: `${base}/rect` });
    } else {
      ops.push({ op: selectedOverlay.rect ? 'replace' : 'add', path: `${base}/rect`, value: result.rect });
      if (selectedOverlay.anchor) ops.push({ op: 'remove', path: `${base}/anchor` });
    }
    void tl.patch(ops, { label: 'anchor' in result ? 'Re-anchor overlay' : 'Move overlay on canvas' });
  }
  const src = take ? media(take.video) : null;
  const needsRebuild = tl.timeline && tl.timeline.takes.length > 0 && tl.timeline.scenes.length === 0;
  // Takes recorded before the pointer overlays were added automatically have no cursor.
  const needsPointer =
    !needsRebuild &&
    tl.timeline &&
    tl.timeline.takes.length > 0 &&
    !tl.timeline.overlays.some((o) => o.component === 'core:Cursor');

  return (
    <div className="studio">
      <EdgeAccent />
      <AppHeader
        current="studio"
        hrefs={appHrefs(slug)}
        center={
          <Pill
            items={[
              <strong key="t" className="studio-title" title={title ?? slug}>
                {title ?? slug}
              </strong>,
              take ? take.id : 'no take',
              tl.error ? (
                <span key="e" style={{ color: 'var(--ui-red-ink)' }}>
                  error
                </span>
              ) : (
                <span key="s" style={{ color: 'var(--ui-green-ink)' }}>
                  Saved
                </span>
              ),
            ]}
          />
        }
        actions={
          <>
            <HeaderStatus />
            <Button
              onClick={() => setConfirmRecord(true)}
              disabled={!!live}
              title={live ? `${live.title} is running` : 'Record a new take of this project'}
            >
              Re-record
            </Button>
            <ExportButton slug={slug} />
          </>
        }
      />
      <ProjectBar slug={slug} current="studio" />
      {needsRebuild && (
        <GateBanner
          title="This project's take has no scenes or steps yet"
          text="It was recorded before the Studio existed. Build them from the latest take's events (overlays are kept)."
          actions={
            <Button
              variant="primary"
              onClick={() =>
                client && client.call('timeline.rebuildFromTake', { slug }).then(() => undefined)
              }
            >
              Build from take
            </Button>
          }
        />
      )}
      {needsPointer && tl.timeline && (
        <GateBanner
          title="The recorded mouse pointer isn't on the timeline"
          text="The video itself has no cursor; it is drawn from the take's mouse events. Add the Cursor and click ripples (you can remove or restyle them like any overlay)."
          actions={
            <Button
              variant="primary"
              onClick={() =>
                void tl.patch(
                  pointerOverlayInstances(buildTimeMap(tl.timeline!).duration).map((value) => ({
                    op: 'add' as const,
                    path: '/overlays/-',
                    value,
                  })),
                  { label: 'Add the recorded cursor' },
                )
              }
            >
              Add the cursor
            </Button>
          }
        />
      )}
      {toReview.length > 0 && (
        <GateBanner
          title={
            toReview.length === 1
              ? `Agent run #${toReview[0]!.n} is ready for review`
              : `${toReview.length} agent runs are ready for review`
          }
          text={toReview.at(-1)!.summary.split('\n')[0]?.slice(0, 220)}
          actions={
            <LinkButton variant="primary" href={`#/agentfix/${slug}?run=${toReview.at(-1)!.n}`}>
              Review changes
            </LinkButton>
          }
        />
      )}
      {tl.error && (
        <div style={{ padding: '6px 22px' }}>
          <Chip tone="error">{tl.error.slice(0, 220)}</Chip>
        </div>
      )}

      {confirmRecord && (
        <GateBanner
          title="Record a new take of this project?"
          text="The script runs again in WSO2 Integrator and Live shows it. The steps are rebuilt from the new take; overlays, annotations and narration are kept."
          actions={
            <>
              <Button onClick={() => setConfirmRecord(false)}>Cancel</Button>
              <Button variant="primary" onClick={reRecord}>
                Record
              </Button>
            </>
          }
        />
      )}

      <div className="studio-body" style={{ '--studio-timeline-h': `${timelineH}px` } as CSSProperties}>
        <aside className="studio-side" aria-label="Project">
          <div className="studio-tabs">
            <Segmented
              block
              label="Sidebar"
              options={[
                { value: 'Steps', label: 'Steps' },
                {
                  value: 'Pipeline',
                  label: (
                    <span className="studio-tab">
                      Pipeline
                      {pipe.state?.status === 'waiting' && (
                        <span className="studio-tab-dot" aria-label="needs you" />
                      )}
                    </span>
                  ),
                },
                { value: 'Agent', label: 'Agent' },
                { value: 'Knowledge', label: 'Skills' },
              ]}
              value={side}
              onChange={chooseSide}
            />
          </div>
          <div className="studio-side-scroll">
            {side === 'Steps' && (
              <>
                <Panel title="Steps">
                  <ol
                    style={{
                      listStyle: 'none',
                      margin: 0,
                      padding: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                    }}
                  >
                    {steps.map((s, i) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => controls.seek(s.start)}
                          className="ui-btn ui-btn-ghost"
                          style={{
                            width: '100%',
                            justifyContent: 'flex-start',
                            height: 'auto',
                            padding: '8px 10px',
                            background: current?.id === s.id ? 'var(--ui-orange-100)' : undefined,
                            color: current?.id === s.id ? 'var(--ui-orange-ink)' : 'var(--ui-ink)',
                          }}
                        >
                          <span className="ui-mono" style={{ fontSize: 11, width: 46, textAlign: 'left' }}>
                            {fmt(s.start).replace(/\.\d\d$/, '')}
                          </span>
                          <span
                            style={{
                              fontWeight: 500,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {i + 1} · {s.title}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </Panel>
                {tl.timeline && (
                  <AnnotationsPanel
                    annotations={tl.timeline.annotations}
                    stepLabel={stepLabel}
                    selected={note}
                    onOpen={(a) => {
                      controls.pause();
                      controls.seek(a.t);
                      if (note && note !== a.id) closeNote();
                      setNote(a.id);
                      setView('With annotations');
                    }}
                    actions={
                      <>
                        {tl.timeline.annotations.some((a) => a.status === 'open') && (
                          <Button variant="steel" onClick={() => void sendNotes()}>
                            Send open annotations (
                            {tl.timeline.annotations.filter((a) => a.status === 'open').length})
                          </Button>
                        )}
                        {sending && <Chip tone={sending.tone}>{sending.text}</Chip>}
                        {runs.length > 0 && (
                          <LinkButton variant="ghost" href={`#/agentfix/${slug}`}>
                            Review agent changes ({runs.length})
                          </LinkButton>
                        )}
                      </>
                    }
                  />
                )}
              </>
            )}
            {side === 'Pipeline' && <PipelinePanel slug={slug} />}
            {side === 'Agent' && <AgentPanel slug={slug} />}
            {side === 'Knowledge' && <KnowledgePanel />}
          </div>
        </aside>

        <main className="studio-center" aria-label="Preview">
          {jobs.length > 0 && (
            <Segmented
              label="Centre view"
              options={[
                { value: 'Preview', label: 'Preview' },
                {
                  value: 'Review',
                  label: (
                    <span className="studio-tab">
                      Explainer review ({jobs.length})
                      <span className="studio-tab-dot" aria-label="needs you" />
                    </span>
                  ),
                },
              ]}
              value={centre}
              onChange={setCentre}
            />
          )}
          {centre === 'Review' && jobs.length > 0 ? (
            <div className="studio-review">
              {jobs.map((job) => (
                <ExplainerStoryboard
                  key={job.sceneId}
                  slug={slug}
                  job={job}
                  onSeek={() => {
                    const span = resolved?.tm.scenes.find((x) => x.sceneId === job.sceneId);
                    if (span) controls.seek(span.start + 0.5);
                    setSelectedScene(job.sceneId);
                    setCentre('Preview');
                  }}
                />
              ))}
            </div>
          ) : (
            <Panel className="studio-preview">
              {/* The stage keeps its aspect and fits the space left by the timeline. */}
              <div className="studio-stage-fit">
                <div
                  className="studio-stage-box"
                  style={{ aspectRatio: `${tl.timeline?.size.w ?? 16} / ${tl.timeline?.size.h ?? 9}` }}
                >
                  {take && src && resolved ? (
                    <div
                      style={{
                        position: 'relative',
                        borderRadius: 10,
                        overflow: 'hidden',
                        border: '1px solid var(--ui-gray-300)',
                      }}
                    >
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
                            showOverlays={view !== 'Raw take'}
                            registry={registry}
                            onOverlayError={reportError}
                            captions={tl.timeline?.captions ?? []}
                            layers={resolved.layersAt(t)}
                          >
                            {showHandles && selectedInstance?.anchor && (
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
                      {tl.timeline && (
                        <Timed player={controls}>
                          {(t) => (
                            <AnnotationLayer
                              annotations={tl.timeline!.annotations}
                              t={t}
                              tool={tool}
                              show={view === 'With annotations'}
                              selected={note}
                              onSelect={(id) => {
                                if (note && note !== id) closeNote();
                                setNote(id);
                              }}
                              onCreate={createNote}
                              onArea={addFromArea}
                              popover={(a, style) => (
                                <AnnotationPopover
                                  key={a.id}
                                  annotation={a}
                                  n={noteIndex(a.id) + 1}
                                  stepLabel={stepLabel(a.t)}
                                  style={style}
                                  onSave={(text) => {
                                    patchNote(a.id, 'comment', text, 'Edit annotation');
                                    setFresh(null);
                                    setNote(null);
                                  }}
                                  onSend={(text) => {
                                    // Save the text first, then send this one annotation.
                                    const i = noteIndex(a.id);
                                    if (i < 0 || !tl.timeline) return;
                                    void tl
                                      .patch(
                                        [{ op: 'replace', path: `/annotations/${i}/comment`, value: text }],
                                        {
                                          label: 'Edit annotation',
                                        },
                                      )
                                      .then(() => sendNotes([a.id]));
                                    setFresh(null);
                                    setNote(null);
                                  }}
                                  onResolve={(done) =>
                                    patchNote(
                                      a.id,
                                      'status',
                                      done ? 'resolved' : 'open',
                                      done ? 'Resolve annotation' : 'Reopen annotation',
                                    )
                                  }
                                  onDelete={() => removeNote(a.id)}
                                  onClose={closeNote}
                                />
                              )}
                            />
                          )}
                        </Timed>
                      )}
                      <ToolRail tool={tool} onTool={chooseTool} />
                    </div>
                  ) : (
                    <div className="studio-stage-empty">
                      {tl.timeline
                        ? 'No take yet. Start the pipeline from the brief, or Re-record.'
                        : 'Loading…'}
                    </div>
                  )}
                </div>
              </div>
              {/* progress with step ticks */}
              <div
                style={{ position: 'relative', height: 4, borderRadius: 2, background: 'var(--ui-gray-100)' }}
              >
                <Timed player={controls}>
                  {(t) => (
                    <span
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: `${(t / duration) * 100}%`,
                        background: 'var(--ui-orange)',
                        borderRadius: 2,
                      }}
                    />
                  )}
                </Timed>
                {steps.map((s) => (
                  <span
                    key={s.id}
                    style={{
                      position: 'absolute',
                      top: -3,
                      width: 2,
                      height: 10,
                      left: `${(s.start / duration) * 100}%`,
                      background: 'var(--ui-navy)',
                    }}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                <IconButton label="Previous step" onClick={() => seekStep(-1)}>
                  <IconPrev size={14} />
                </IconButton>
                <IconButton
                  label={playing ? 'Pause' : 'Play'}
                  variant="primary"
                  onClick={() => controls.toggle()}
                >
                  {playing ? <IconPause size={14} /> : <IconPlay size={14} />}
                </IconButton>
                <IconButton label="Next step" onClick={() => seekStep(1)}>
                  <IconNext size={14} />
                </IconButton>
                <span className="ui-mono" style={{ color: 'var(--ui-navy)' }}>
                  <Timed player={controls}>{(t) => fmt(t)}</Timed>{' '}
                  <span style={{ color: 'var(--ui-gray-600)' }}>/ {fmt(duration)}</span>
                </span>
                <span style={{ flex: 1 }} />
                {tl.timeline && (
                  <Button
                    size="sm"
                    aria-pressed={tl.timeline.showCaptions}
                    title={
                      tl.timeline.showCaptions
                        ? 'Captions are drawn on the video (and burned into the export). Click to hide them; the SRT/VTT files are still exported.'
                        : 'Captions are hidden from the video. Click to show them.'
                    }
                    onClick={() =>
                      void tl.patch(
                        [{ op: 'add', path: '/showCaptions', value: !tl.timeline!.showCaptions }],
                        {
                          label: tl.timeline!.showCaptions ? 'Hide captions' : 'Show captions',
                        },
                      )
                    }
                  >
                    {tl.timeline.showCaptions ? 'Captions on' : 'Captions off'}
                  </Button>
                )}
                {tl.timeline && (
                  <Button
                    size="sm"
                    aria-pressed={tl.timeline.sfx.enabled}
                    title={
                      tl.timeline.sfx.enabled
                        ? 'Click and typing sounds play under the recording (and are mixed into the export). Click to turn them off.'
                        : 'No click or typing sounds. Click to turn them on.'
                    }
                    onClick={() =>
                      void tl.patch(
                        [
                          {
                            op: 'add',
                            path: '/sfx',
                            value: { ...tl.timeline!.sfx, enabled: !tl.timeline!.sfx.enabled },
                          },
                        ],
                        { label: tl.timeline!.sfx.enabled ? 'Turn sounds off' : 'Turn sounds on' },
                      )
                    }
                  >
                    {tl.timeline.sfx.enabled ? 'Sounds on' : 'Sounds off'}
                  </Button>
                )}
                <Segmented
                  label="View"
                  options={['Final', 'With annotations', 'Raw take'] as const}
                  value={view}
                  onChange={setView}
                />
              </div>
            </Panel>
          )}
        </main>

        <aside className="studio-side studio-side-right" aria-label="Inspector and library">
          {tl.timeline &&
            (() => {
              const i = tl.timeline.scenes.findIndex((x) => x.id === selectedScene);
              const sc = tl.timeline.scenes[i];
              return sc?.kind === 'explainer' ? (
                <ExplainerInspector
                  key={`${sc.id}:${JSON.stringify(sc.narration)}:${JSON.stringify(sc.props)}`}
                  scene={sc}
                  index={i}
                  voice={tl.timeline.voice.filter((v) => v.owner === sc.id)}
                  mod={registry[sc.component]}
                  patch={tl.patch}
                  onClose={() => setSelectedScene(null)}
                />
              ) : null;
            })()}
          {tl.timeline && (
            <Inspector
              timeline={tl.timeline}
              overlay={selectedOverlay}
              module={selectedOverlay ? registry[selectedOverlay.component] : undefined}
              patch={tl.patch}
              onOpenSource={(component) => {
                const [scope, name] = component.split(':');
                const rel =
                  scope === 'project' ? `projects/${slug}/overlays/${name}.tsx` : `overlays/${name}.tsx`;
                void client?.call('workspace.openInEditor', { path: rel });
              }}
            />
          )}
          <Library
            slug={slug}
            registry={registry}
            onAdd={(id) => addOverlay(id)}
            onInsertScene={(id) => {
              if (!client) return;
              controls.pause();
              void client
                .call('scenes.insert', { slug, at: Math.round(now() * 100) / 100, component: id })
                .catch((e: unknown) =>
                  setSending({ text: e instanceof Error ? e.message : String(e), tone: 'error' }),
                );
            }}
          />
        </aside>

        <div className="studio-dock">
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Timeline height"
            aria-valuenow={timelineH}
            aria-valuemin={TIMELINE_MIN}
            aria-valuemax={TIMELINE_MAX}
            tabIndex={0}
            className="studio-dock-handle"
            onPointerDown={startResize}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') resizeTimeline(timelineH + 24);
              else if (e.key === 'ArrowDown') resizeTimeline(timelineH - 24);
              else return;
              e.preventDefault();
            }}
          />
          {tl.timeline && resolved && (
            <TimelinePanel
              slug={slug}
              timeline={tl.timeline}
              resolved={resolved}
              player={controls}
              onSeek={(x) => controls.seek(x)}
              selected={selected}
              onSelect={(id) => {
                setSelected(id);
                // Selecting something off-screen brings it into view so it can be edited.
                const o = id ? tl.timeline?.overlays.find((x) => x.id === id) : null;
                if (o && (now() < o.start || now() > o.end)) controls.seek(Math.min(o.start + 0.6, o.end));
              }}
              patch={tl.patch}
              onSplit={split}
              onDropOverlay={(id, at) => addOverlay(id, at)}
              canUndo={tl.canUndo}
              canRedo={tl.canRedo}
              onUndo={() => void tl.undo()}
              onRedo={() => void tl.redo()}
              actions={
                <>
                  <RegenerateVo slug={slug} />
                  <InsertExplainer
                    registry={registry}
                    value={sceneComponent}
                    onChange={setSceneComponent}
                    onInsert={insertExplainer}
                    onAsk={(brief) => {
                      controls.pause();
                      return client!
                        .call('explainers.start', { slug, at: Math.round(now() * 100) / 100, brief })
                        .then(() => undefined);
                    }}
                  />
                </>
              }
              onSelectScene={(id) => {
                setSelectedScene(id);
                const span = resolved.tm.scenes.find((x) => x.sceneId === id);
                if (span && (now() < span.start || now() >= span.end)) controls.seek(span.start + 0.01);
              }}
              onTransition={(between, value) => {
                if (!tl.timeline) return;
                const rest = tl.timeline.transitions.filter(
                  (x) => !(x.between[0] === between[0] && x.between[1] === between[1]),
                );
                const next = value
                  ? [
                      ...rest,
                      {
                        id: `tr-${between[0]}-${between[1]}`,
                        between,
                        component: value.component,
                        duration: value.duration,
                      },
                    ]
                  : rest;
                void tl.patch([{ op: 'replace', path: '/transitions', value: next }], {
                  label: value ? 'Set transition' : 'Remove transition',
                });
              }}
              onRemoveScene={(id) =>
                client &&
                void client
                  .call('scenes.remove', { slug, sceneId: id })
                  .catch((e: unknown) => setSending({ text: String(e), tone: 'error' }))
              }
              onAnnotation={(id) => {
                const a = tl.timeline?.annotations.find((x) => x.id === id);
                if (!a) return;
                controls.pause();
                controls.seek(a.t);
                setNote(id);
                setView('With annotations');
              }}
            />
          )}
        </div>
      </div>

      <Timed player={controls}>
        {(t) => (
          <>
            <VoicePlayer
              spans={spans}
              t={t}
              playing={playing}
              rate={rate}
              media={media}
              onSync={(at) => controls.seek(at)}
            />
            <SfxPlayer
              cues={sfx}
              t={t}
              playing={playing}
              rate={rate}
              volume={tl.timeline?.sfx.volume ?? 0.5}
            />
          </>
        )}
      </Timed>
    </div>
  );
}

/** Voice-over and timing-fit actions for the timeline toolbar, with a one-line report. */
function RegenerateVo({ slug }: { slug: string }) {
  const { client } = useEngine();
  const [busy, setBusy] = useState<'vo' | 'fit' | 'auto' | null>(null);
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const len = (s: number) => {
    const t = Math.round(s);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };
  const fitText = (f: { before: number; after: number; holds: number; spedUp: number }) =>
    `fitted ${len(f.before)} → ${len(f.after)} (${f.holds} freeze${f.holds === 1 ? '' : 's'}, ${f.spedUp} fast-forwarded)`;
  const run = (kind: 'vo' | 'fit' | 'auto', fn: () => Promise<string>) => {
    setBusy(kind);
    setNote(null);
    fn()
      .then(
        (text) => setNote({ tone: 'ok', text }),
        (e: unknown) => setNote({ tone: 'error', text: e instanceof Error ? e.message : String(e) }),
      )
      .finally(() => setBusy(null));
  };
  return (
    <>
      <Button
        size="sm"
        variant="steel"
        disabled={!client || !!busy}
        title="Synthesize the voice-over from each step's narration with the brief's voice, then fit the timing"
        onClick={() =>
          run('vo', async () => {
            const r = await client!.call('vo.generate', { slug });
            const cached = r.lines.filter((l) => l.cached).length;
            return [
              `${r.lines.length} line${r.lines.length === 1 ? '' : 's'} · ${r.seconds.toFixed(1)} s`,
              cached ? `${cached} from cache` : '',
              r.skipped.length ? `${r.skipped.length} without narration` : '',
              r.fit ? fitText(r.fit) : '',
            ]
              .filter(Boolean)
              .join(' · ');
          })
        }
      >
        {busy === 'vo' ? 'Voicing…' : 'Regenerate VO'}
      </Button>
      <Button
        size="sm"
        disabled={!client || !!busy}
        title="Freeze where the voice runs longer than the action; fast-forward what runs on after a line ends (product waits, and unnarrated action at up to 4×)"
        onClick={() =>
          run('fit', async () => {
            const r = await client!.call('timing.fit', { slug });
            return fitText({
              before: r.before,
              after: r.after,
              holds: r.steps.filter((x) => x.hold > 0).length,
              spedUp: r.steps.filter((x) => x.saved > 0.5).length,
            });
          })
        }
      >
        {busy === 'fit' ? 'Fitting…' : 'Fit timing'}
      </Button>
      <Button
        size="sm"
        disabled={!client || !!busy}
        title="Rebuild the automatic overlays from the recording: pointer, zooms on clicks and typing, blurs over masked areas, and the title card. Overlays you added or edited stay."
        onClick={() =>
          run('auto', async () => {
            const r = await client!.call('overlays.auto', { slug });
            return `${r.count} automatic overlay${r.count === 1 ? '' : 's'}`;
          })
        }
      >
        {busy === 'auto' ? 'Rebuilding…' : 'Auto overlays'}
      </Button>
      {note && <Chip tone={note.tone}>{note.text}</Chip>}
      {note?.tone === 'error' && /voice in the brief/i.test(note.text) && (
        <LinkButton size="sm" variant="primary" href={`#/brief/${slug}`}>
          Open the brief
        </LinkButton>
      )}
    </>
  );
}

/** Pick an explainer scene component and insert it at the playhead. */
function InsertExplainer({
  registry,
  value,
  onChange,
  onInsert,
  onAsk,
}: {
  registry: Record<string, OverlayModule>;
  value: string;
  onChange: (id: string) => void;
  onInsert: () => void;
  /** Ask the agent to storyboard and build an explainer from a brief, at the playhead. */
  onAsk: (brief: string) => Promise<void>;
}) {
  const scenes = Object.entries(registry).filter(([, m]) => m.meta?.kind === 'scene');
  const [asking, setAsking] = useState(false);
  const [brief, setBrief] = useState('');
  const [sending, setSending] = useState(false);
  return (
    <>
      <span style={{ width: 1, height: 22, background: 'var(--ui-gray-300)', margin: '0 2px' }} />
      <Select
        aria-label="Explainer scene"
        value={value || scenes[0]?.[0] || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={!scenes.length}
        style={{ width: 150, height: 30 }}
      >
        {scenes.length ? (
          scenes.map(([id, m]) => (
            <option key={id} value={id}>
              {m.meta?.name ?? id}
            </option>
          ))
        ) : (
          <option value="">No scenes yet</option>
        )}
      </Select>
      <Button
        size="sm"
        variant="accent"
        disabled={!scenes.length}
        onClick={onInsert}
        title="Insert the explainer at the playhead (X)"
      >
        + Insert explainer
      </Button>
      <span style={{ position: 'relative' }}>
        <Button
          size="sm"
          onClick={() => setAsking((a) => !a)}
          title="Describe an explainer; the agent storyboards it for your approval"
        >
          Ask the agent…
        </Button>
        {asking && (
          <span
            role="dialog"
            aria-label="Explainer brief"
            style={{
              position: 'absolute',
              top: 34,
              left: 0,
              zIndex: 10,
              width: 320,
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              background: 'var(--ui-white)',
              border: '1px solid var(--ui-gray-300)',
              borderRadius: 10,
              boxShadow: 'var(--ui-shadow-md)',
            }}
          >
            <label
              htmlFor="explainer-brief"
              style={{ fontSize: 12, fontWeight: 600, color: 'var(--ui-navy)' }}
            >
              What should the explainer show?
            </label>
            <textarea
              id="explainer-brief"
              className="ui-textarea"
              rows={3}
              placeholder="e.g. explain how a request reaches /greeting"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <span style={{ fontSize: 11, color: 'var(--ui-gray-600)' }}>
              Inserted at the playhead. You approve the storyboard before it is built.
            </span>
            <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
                Close
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={brief.trim().length < 3 || sending}
                onClick={() => {
                  setSending(true);
                  void onAsk(brief.trim())
                    .then(() => {
                      setBrief('');
                      setAsking(false);
                    })
                    .finally(() => setSending(false));
                }}
              >
                {sending ? 'Inserting…' : 'Storyboard it'}
              </Button>
            </span>
          </span>
        )}
      </span>
    </>
  );
}
