import { useEffect, useRef, useState } from 'react';
import type { AgentEvent, AgentStatus, PipelineProgress, RecorderEvent, RpcEventData } from '@studio/core';
import {
  AppHeader,
  Button,
  Chip,
  EdgeAccent,
  GateBanner,
  Input,
  MonoBox,
  Panel,
  Pill,
  Segmented,
  Stepper,
  Title,
  type ChipTone,
  type StepState,
} from '@studio/ui';
import { useEngine } from '../engine';
import { ProjectBar } from '../routes/ProjectBar';
import { StageProgress } from './StageProgress';
import { appHrefs, HeaderStatus } from '../routes/frame';
import { elapsed as runElapsed, pipelineSteps as agentPipelineSteps, usePipeline } from '../pipeline';

type Session = RpcEventData<'live.session'>;
type Action = RpcEventData<'live.action'>;
type Stage = RpcEventData<'live.stage'>['stage'];

interface StepRow {
  id: string;
  title: string;
  done: boolean;
  /** Cued actions in a paced take: the word, and how far from it the action landed (seconds). */
  cues: { word: string; off: number }[];
}

/** A cued action this close to its word counts as on time (the engine's CUE_TOLERANCE). */
const CUE_OK = 0.15;

interface LogLine {
  t: string;
  tag: string;
  tone: ChipTone;
  text: string;
  /** A tool call waiting for Allow or Deny. */
  request?: { slug: string; id: string };
}

const PIPELINE: { stage: Stage; label: string }[] = [
  { stage: 'fixture', label: 'Create project fixture' },
  { stage: 'launch', label: 'Launch WSO2 Integrator' },
  { stage: 'load', label: 'Load the project' },
  { stage: 'run', label: 'Run the script' },
  { stage: 'encode', label: 'Encode the take' },
];
const ORDER: Stage[] = ['fixture', 'launch', 'load', 'run', 'encode', 'done'];

function pipelineState(current: Stage | null, item: Stage, mode: 'dry' | 'record' | undefined): StepState {
  if (!current) return 'todo';
  if (item === 'encode' && mode === 'dry') return current === 'done' ? 'done' : 'todo';
  if (current === 'failed' || current === 'stopped') return 'todo';
  const ci = ORDER.indexOf(current);
  const ii = ORDER.indexOf(item);
  return ii < ci ? 'done' : ii === ci ? (current === 'done' ? 'done' : 'active') : 'todo';
}

function readable(e: RecorderEvent): LogLine | null {
  const t = `${e.t.toFixed(1)}s`;
  switch (e.kind) {
    case 'step-start':
      return { t, tag: 'Step', tone: 'info', text: `${e.stepId} · ${e.title}` };
    case 'click':
      return { t, tag: 'Playwright', tone: 'neutral', text: `click ${e.target}` };
    case 'type':
      return { t, tag: 'Playwright', tone: 'neutral', text: `type "${e.text}" into ${e.target}` };
    case 'key':
      return { t, tag: 'Playwright', tone: 'neutral', text: `press ${e.key}` };
    case 'marker':
      return e.name === 'start' ? { t, tag: 'Recording', tone: 'error', text: 'started' } : null;
    default:
      return null;
  }
}

/** Agent messages as console lines (thinking, results of tools and permission answers are left out). */
function agentLine(e: AgentEvent): LogLine | null {
  const t = new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  switch (e.kind) {
    case 'user':
      return { t, tag: e.source === 'user' ? 'You' : 'Pipeline', tone: 'neutral', text: e.text };
    case 'text':
      return { t, tag: 'Claude', tone: 'info', text: e.text };
    case 'tool_use':
      return { t, tag: e.name.replace(/^mcp__studio__/, 'studio · '), tone: 'neutral', text: e.summary };
    case 'permission':
      return {
        t,
        tag: 'Needs approval',
        tone: 'active',
        text: `${e.tool}: ${e.summary}`,
        request: { slug: e.slug, id: e.requestId },
      };
    case 'result':
      return {
        t,
        tag: e.ok ? 'Turn done' : 'Turn stopped',
        tone: e.ok ? 'ok' : 'error',
        text: `${e.turns} turns · ${(e.durationMs / 1000).toFixed(1)} s · $${e.costUsd.toFixed(2)} total`,
      };
    case 'init':
      return {
        t,
        tag: 'Session',
        tone: 'info',
        text: `${e.resumed ? 'resumed' : 'started'} ${e.sessionId.slice(0, 8)} · ${e.model}`,
      };
    case 'status':
      return { t, tag: 'Agent', tone: 'neutral', text: e.text };
    case 'error':
      return { t, tag: 'Agent error', tone: 'error', text: e.text };
    default:
      return null;
  }
}

/** Live: what the agent sees while it records, streamed from the engine. */
export function LiveShell({ slug = null }: { slug?: string | null }) {
  const { client, state } = useEngine();
  const [session, setSession] = useState<Session | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [frame, setFrame] = useState<{ src: string; latencyMs: number } | null>(null);
  const [frames, setFrames] = useState(0);
  const [action, setAction] = useState<Action | null>(null);
  /** The recorder's pointer (frame px); `clickAt` restarts the click ring. */
  const [pointer, setPointer] = useState<{ x: number; y: number; clickAt: number } | null>(null);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [raw, setRaw] = useState<string[]>([]);
  const [view, setView] = useState<'Readable' | 'Raw'>('Readable');
  const [elapsed, setElapsed] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  /** Pending permission requests per project, from agent.state. */
  const [pending, setPending] = useState<Record<string, string[]>>({});
  const [steer, setSteer] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const pipe = usePipeline(null);
  const startedAt = useRef<number | null>(null);

  // A run that started before this screen opened: pick it up (its frames arrive as events).
  useEffect(() => {
    if (!client || state !== 'open') return;
    void client.call('live.status', {}).then(
      (r) => {
        if (!r.session) return;
        setSession(r.session);
        startedAt.current ??= Date.now();
      },
      () => undefined,
    );
  }, [client, state]);

  useEffect(() => {
    if (!client) return;
    const now = () =>
      new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const offs = [
      client.on('live.session', (s) => {
        setSession(s);
        if (s.state === 'started' && !s.frame) {
          startedAt.current = Date.now();
          setStage(null);
          setSteps([]);
          setLog([]);
          setRaw([]);
          setAction(null);
          setPointer(null);
          setFrame(null);
          setFrames(0);
          setStopping(false);
        }
        if (s.state === 'stopped') {
          startedAt.current = null;
          setAction(null);
          setStopping(false);
        }
      }),
      client.on('live.stage', (s) => setStage(s.stage)),
      client.on('live.frame', (f) => {
        setFrame({ src: `data:image/jpeg;base64,${f.data}`, latencyMs: Date.now() - f.timestamp * 1000 });
        setFrames((n) => n + 1);
      }),
      client.on('live.action', setAction),
      client.on('live.pointer', (p) =>
        setPointer((cur) => ({ x: p.x, y: p.y, clickAt: p.click ? Date.now() : (cur?.clickAt ?? 0) })),
      ),
      client.on('recorder.event', (e) => {
        if (e.kind === 'step-start')
          setSteps((s) => [...s, { id: e.stepId, title: e.title, done: false, cues: [] }]);
        if ((e.kind === 'click' || e.kind === 'key') && e.cue) {
          const cue = { word: e.cue.word, off: Math.round((e.t - e.cue.at) * 100) / 100 };
          setSteps((s) => s.map((x) => (x.id === e.stepId ? { ...x, cues: [...x.cues, cue] } : x)));
        }
        if (e.kind === 'step-end')
          setSteps((s) => s.map((x) => (x.id === e.stepId ? { ...x, done: true } : x)));
        const line = readable(e);
        if (line) setLog((l) => [...l, line].slice(-80));
        setRaw((r) =>
          [...r, JSON.stringify(e.kind === 'mouse' ? { ...e, points: `[${e.points.length}]` } : e)].slice(
            -200,
          ),
        );
      }),
      client.on('pipeline.progress', setProgress),
      client.on('agent.state', (a) => {
        setAgent(a);
        setPending((p) => ({ ...p, [a.slug]: a.pending }));
      }),
      client.on('agent.event', (e) => {
        const line = agentLine(e);
        if (line) setLog((l) => [...l, line].slice(-80));
        setRaw((r) => [...r, JSON.stringify(e)].slice(-200));
      }),
      client.on('recorder.progress', (p) =>
        setLog((l) =>
          [...l, { t: now(), tag: 'Engine', tone: 'active', text: p.message } as LogLine].slice(-80),
        ),
      ),
    ];
    return () => offs.forEach((off) => off());
  }, [client]);

  useEffect(() => {
    const t = setInterval(() => {
      setElapsed(startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0);
      setNow(Date.now());
    }, 500);
    return () => clearInterval(t);
  }, []);

  const running = session?.state === 'started';
  const fw = session?.frame?.width ?? 1;
  const fh = session?.frame?.height ?? 1;
  const mmss = `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`;

  // A window opened while a request is waiting still shows it.
  const pipeSlug = pipe.state?.slug ?? null;
  // The running stage's progress (the voiced lines stay up while the agent aligns to them).
  const pipeStage =
    pipe.state?.status === 'running' || pipe.state?.status === 'waiting' ? pipe.state.stage : null;
  const engineProgress =
    progress &&
    progress.slug === pipeSlug &&
    (progress.stage === pipeStage || (progress.stage === 'voice' && pipeStage === 'align'))
      ? progress
      : null;
  // While the agent plans or narrates, the steps and lines it has saved so far.
  const planProgress = ((): PipelineProgress | null => {
    const plan = pipe.state?.plan;
    if (!plan || !pipeSlug || (pipeStage !== 'plan' && pipeStage !== 'narrate')) return null;
    if (pipeStage === 'plan')
      return {
        slug: pipeSlug,
        stage: 'plan',
        message: `Planned ${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}`,
        items: plan.steps.map((st) => ({
          id: st.id,
          label: `${st.id} · ${st.title}`,
          detail: '',
          state: 'done',
        })),
      };
    const written = plan.steps.filter((st) => st.narration.trim()).length;
    // The last passing dry run left a still of each step's end screen.
    const shotsAt = pipe.state?.history.filter((h) => h.stage === 'dry_run' && h.ok).at(-1)?.endedAt;
    return {
      slug: pipeSlug,
      stage: 'narrate',
      message: `Narration: ${written} of ${plan.steps.length} lines written`,
      ...(shotsAt ? { version: shotsAt } : {}),
      items: plan.steps.map((st) => {
        const words = st.narration.trim().split(/\s+/).filter(Boolean).length;
        return {
          id: st.id,
          label: `${st.id} · ${st.narration.trim() || st.title}`,
          detail: words ? `${words} words · about ${Math.round(words / 2.5)} s` : '',
          state: words ? 'done' : 'pending',
          ...(shotsAt ? { image: `.studio/shots/${st.id}.jpg` } : {}),
        };
      }),
    };
  })();
  const shown = engineProgress ?? planProgress;
  const showProgress = !!shown;
  useEffect(() => {
    if (!client || state !== 'open' || !pipeSlug) return;
    void client.call('agent.status', { slug: pipeSlug, history: 200 }).then(
      ({ status, history }) => {
        setAgent((a) => a ?? status);
        setPending((p) => ({ ...p, [status.slug]: status.pending }));
        const waiting = history.filter(
          (e) => e.kind === 'permission' && status.pending.includes(e.requestId),
        );
        if (waiting.length)
          setLog((l) => {
            const have = new Set(l.map((x) => x.request?.id));
            const lines = waiting.map(agentLine).filter((x): x is LogLine => !!x && !have.has(x.request?.id));
            return [...l, ...lines].slice(-80);
          });
      },
      () => undefined,
    );
  }, [client, state, pipeSlug]);

  const answer = (r: { slug: string; id: string }, allow: boolean) =>
    void client?.call('agent.permission', { slug: r.slug, requestId: r.id, allow }).catch(() => undefined);

  async function stop() {
    if (!client) return;
    setStopping(true);
    await client.call('recorder.stop', {}).catch(() => setStopping(false));
  }

  const agentWorking = !!agent && agent.state !== 'idle' && agent.state !== 'error';
  async function pauseAgent() {
    if (client && agent) await client.call('agent.interrupt', { slug: agent.slug }).catch(() => {});
  }
  async function sendSteer() {
    const text = steer.trim();
    if (!client || !agent || !text) return;
    setSteer('');
    await client.call('agent.send', { slug: agent.slug, text }).catch(() => {});
  }

  const pipelineSteps = PIPELINE.map((p) => ({
    label: p.label,
    sub:
      p.stage === 'encode' && session?.mode === 'dry'
        ? 'skipped in dry runs'
        : p.stage === 'run' && steps.length
          ? `${steps.filter((s) => s.done).length} of ${steps.length} steps`
          : undefined,
    state: pipelineState(stage, p.stage, session?.mode),
  }));
  if (stage === 'failed' || stage === 'stopped')
    pipelineSteps.push({
      label: stage === 'stopped' ? 'Stopped by you' : 'Run failed',
      sub: undefined,
      state: 'failed',
    });

  return (
    <div className="app-frame">
      <EdgeAccent />
      <AppHeader
        current="live"
        hrefs={appHrefs(slug ?? session?.slug)}
        center={
          session ? (
            <Pill
              items={[
                running ? (
                  <Chip key="rec" tone={session.mode === 'record' ? 'error' : 'info'} dot>
                    {session.mode === 'record' ? `REC ${mmss}` : `DRY RUN ${mmss}`}
                  </Chip>
                ) : (
                  <Chip key="done" tone={stage === 'done' ? 'ok' : stage ? 'error' : 'neutral'}>
                    {stage === 'done'
                      ? 'Finished'
                      : stage === 'stopped'
                        ? 'Stopped'
                        : stage === 'failed'
                          ? 'Failed'
                          : 'Idle'}
                  </Chip>
                ),
                <strong key="t">{session.title}</strong>,
                'WSO2 Integrator',
              ]}
            />
          ) : undefined
        }
        actions={
          <>
            <HeaderStatus live={false} />
            <Button
              disabled={!agentWorking || agent?.state === 'interrupting'}
              onClick={pauseAgent}
              title={agent ? `Stop the current turn of ${agent.slug}'s agent` : 'No agent session yet'}
            >
              {agent?.state === 'interrupting' ? 'Pausing…' : 'Pause agent'}
            </Button>
            <Button variant="danger" onClick={stop} disabled={!running || stopping || state !== 'open'}>
              {stopping ? 'Stopping…' : 'Stop take'}
            </Button>
          </>
        }
      />
      {(slug ?? session?.slug ?? pipeSlug) && (
        <ProjectBar slug={(slug ?? session?.slug ?? pipeSlug)!} current="live" />
      )}

      <main
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          background: 'var(--ui-gray-50)',
          padding: '12px 12px 12px 18px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'stretch',
        }}
      >
        <Panel title="Pipeline" style={{ flex: '1 1 250px', maxWidth: 290 }}>
          {pipe.state && pipe.state.status !== 'idle' && (
            <>
              <Stepper steps={agentPipelineSteps(pipe.state)} />
              {pipe.state.gate && (
                <GateBanner
                  title={pipe.state.gate.title}
                  text={pipe.state.gate.text}
                  actions={
                    <Button size="sm" variant="primary" onClick={() => void pipe.approve()}>
                      {pipe.state.gate.kind === 'storyboard'
                        ? 'Approve'
                        : pipe.state.gate.kind === 'knowledge'
                          ? 'Commit'
                          : 'Try again'}
                    </Button>
                  }
                />
              )}
              <span className="ui-eyebrow" style={{ marginTop: 4 }}>
                Current run
              </span>
            </>
          )}
          <Stepper steps={pipelineSteps} />
          <div style={{ flex: 1 }} />
          {pipe.state && pipe.state.status !== 'idle' && (
            <div
              className="ui-mono"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 8,
                fontSize: 11,
                color: 'var(--ui-gray-600)',
              }}
            >
              <span>
                pipeline
                <br />
                <b style={{ color: 'var(--ui-navy)', fontWeight: 500 }}>{runElapsed(pipe.state, now)}</b>
              </span>
              <span>
                cost
                <br />
                <b style={{ color: 'var(--ui-navy)', fontWeight: 500 }}>
                  $
                  {Math.max(
                    0,
                    (agent?.slug === pipe.state.slug ? agent.costUsd : pipe.state.costAtStart) -
                      pipe.state.costAtStart,
                  ).toFixed(2)}
                </b>
              </span>
              <span>
                session
                <br />
                <b style={{ color: 'var(--ui-navy)', fontWeight: 500 }}>
                  {agent?.sessionId ? agent.sessionId.slice(0, 8) : '—'}
                </b>
              </span>
            </div>
          )}
          <div
            className="ui-mono"
            style={{
              borderTop: '1px solid var(--ui-gray-100)',
              paddingTop: 12,
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 8,
              fontSize: 11,
              color: 'var(--ui-gray-600)',
            }}
          >
            <span>
              elapsed
              <br />
              <b style={{ color: 'var(--ui-navy)', fontWeight: 500 }}>{mmss}</b>
            </span>
            <span>
              frames
              <br />
              <b style={{ color: 'var(--ui-navy)', fontWeight: 500 }}>{frames}</b>
            </span>
            <span>
              delay
              <br />
              <b style={{ color: 'var(--ui-navy)', fontWeight: 500 }}>
                {frame ? `${Math.max(0, frame.latencyMs).toFixed(0)} ms` : '—'}
              </b>
            </span>
          </div>
        </Panel>

        <Panel
          title="Live view"
          action={
            <span className="ui-mono" style={{ fontSize: 11, color: 'var(--ui-gray-600)' }}>
              {session?.frame
                ? `${session.frame.width}×${session.frame.height} · CDP screencast`
                : 'CDP screencast'}
            </span>
          }
          style={{ flex: '999 1 560px' }}
        >
          {!running && showProgress ? (
            <StageProgress progress={shown!} />
          ) : frame ? (
            <div
              style={{
                position: 'relative',
                borderRadius: 10,
                overflow: 'hidden',
                border: '1px solid var(--ui-gray-300)',
              }}
            >
              <img
                src={frame.src}
                alt="Live view of WSO2 Integrator"
                style={{ display: 'block', width: '100%' }}
              />
              {running && action && session?.frame && (
                <>
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: `${(action.bbox.x / fw) * 100}%`,
                      top: `${(action.bbox.y / fh) * 100}%`,
                      width: `${(action.bbox.w / fw) * 100}%`,
                      height: `${(action.bbox.h / fh) * 100}%`,
                      border: '2px solid var(--ui-orange)',
                      borderRadius: 4,
                      background: 'rgba(255,88,0,0.08)',
                      transition: 'all var(--ui-base) var(--ui-ease)',
                    }}
                  />
                  <span
                    className="ui-mono"
                    style={{
                      position: 'absolute',
                      left: `${(action.bbox.x / fw) * 100}%`,
                      top: `calc(${(action.bbox.y / fh) * 100}% - 24px)`,
                      fontSize: 11,
                      color: 'var(--ui-white)',
                      background: 'var(--ui-orange)',
                      padding: '2px 6px',
                      borderRadius: 4,
                      whiteSpace: 'nowrap',
                      maxWidth: '60%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {action.label}
                  </span>
                </>
              )}
              {running && pointer && session?.frame && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: `${(pointer.x / fw) * 100}%`,
                    top: `${(pointer.y / fh) * 100}%`,
                    pointerEvents: 'none',
                  }}
                >
                  {/* Keyed by the click: the ring animates once, then stays transparent. */}
                  {pointer.clickAt > 0 && (
                    <span
                      key={pointer.clickAt}
                      className="live-click-ring"
                      style={{ position: 'absolute', left: -14, top: -14, width: 28, height: 28 }}
                    />
                  )}
                  <svg
                    width={20}
                    height={23}
                    viewBox="0 0 24 28"
                    style={{
                      position: 'absolute',
                      left: -2,
                      top: -2,
                      filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.35))',
                    }}
                  >
                    <path
                      d="M2 2l18 11-8 2-3 9z"
                      fill="var(--ui-white)"
                      stroke="var(--ui-ink)"
                      strokeWidth={1.6}
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              )}
            </div>
          ) : (
            <div
              style={{
                padding: '64px 16px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <Title size={22} rule={false}>
                {running ? 'Starting WSO2 Integrator' : 'Waiting for a recording'}
              </Title>
              <p style={{ margin: 0, color: 'var(--ui-gray-600)', maxWidth: 460, lineHeight: 1.5 }}>
                {running
                  ? 'The live view appears as soon as the window is up.'
                  : 'Dry runs and recordings stream here: start the pipeline from a brief, or Re-record in the Studio.'}
              </p>
            </div>
          )}
          {steps.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
                gap: 6,
              }}
            >
              {steps.map((s, i) => {
                const active = !s.done && i === steps.length - 1 && running;
                const failed = !s.done && !running && (stage === 'failed' || stage === 'stopped');
                return (
                  <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span
                      style={{
                        height: 5,
                        borderRadius: 3,
                        background: s.done
                          ? 'var(--ui-green)'
                          : failed
                            ? 'var(--ui-red)'
                            : active
                              ? 'var(--ui-orange)'
                              : 'var(--ui-gray-300)',
                      }}
                    />
                    <span
                      style={{
                        fontSize: 11,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        color: s.done
                          ? 'var(--ui-green-ink)'
                          : active
                            ? 'var(--ui-orange-ink)'
                            : 'var(--ui-gray-600)',
                      }}
                    >
                      {s.id} · {s.title}
                    </span>
                    {s.cues.map((c, j) => (
                      <span
                        key={j}
                        className="live-cue ui-mono"
                        data-late={Math.abs(c.off) > CUE_OK ? 'true' : undefined}
                        title={`"${c.word}" landed ${Math.abs(c.off).toFixed(2)} s ${c.off < 0 ? 'before' : 'after'} the word`}
                      >
                        {Math.abs(c.off) > CUE_OK ? '✗' : '✓'} {c.word}{' '}
                        {Math.abs(c.off) > CUE_OK
                          ? `+${c.off.toFixed(1)} s`
                          : `${Math.round(c.off * 1000)} ms`}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel
          title="Agent console"
          action={
            <Segmented
              label="Console view"
              options={['Readable', 'Raw'] as const}
              value={view}
              onChange={setView}
            />
          }
          style={{ flex: '1 1 340px', maxWidth: 420 }}
        >
          {view === 'Readable' ? (
            <ol
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                maxHeight: 560,
                overflow: 'auto',
                flex: 1,
              }}
            >
              {log.length === 0 && <li style={{ color: 'var(--ui-gray-600)' }}>No activity yet.</li>}
              {log.map((l, i) => (
                <li key={i} style={{ display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr)', gap: 8 }}>
                  <span
                    className="ui-mono"
                    style={{ fontSize: 11, color: 'var(--ui-gray-600)', paddingTop: 2 }}
                  >
                    {l.t}
                  </span>
                  <span
                    style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}
                  >
                    <Chip tone={l.tone} mono>
                      {l.tag}
                    </Chip>
                    <span style={{ lineHeight: 1.45 }}>{l.text}</span>
                    {l.request && pending[l.request.slug]?.includes(l.request.id) && (
                      <span style={{ display: 'flex', gap: 6 }}>
                        <Button size="sm" variant="primary" onClick={() => answer(l.request!, true)}>
                          Allow
                        </Button>
                        <Button size="sm" onClick={() => answer(l.request!, false)}>
                          Deny
                        </Button>
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <MonoBox style={{ maxHeight: 560, flex: 1 }}>
              {raw.length ? raw.join('\n') : 'No events yet.'}
            </MonoBox>
          )}
          <div style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--ui-gray-100)', paddingTop: 12 }}>
            <label htmlFor="steer" className="ui-sr-only">
              Steer the agent
            </label>
            <Input
              id="steer"
              placeholder={
                agent ? `Steer ${agent.slug}'s agent` : 'Steer the agent (once a session has started)'
              }
              disabled={!agent}
              value={steer}
              onChange={(e) => setSteer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void sendSteer();
              }}
              style={{ flex: 1 }}
            />
            <Button variant="primary" disabled={!agent || !steer.trim()} onClick={sendSteer}>
              Send
            </Button>
          </div>
        </Panel>
      </main>
    </div>
  );
}
