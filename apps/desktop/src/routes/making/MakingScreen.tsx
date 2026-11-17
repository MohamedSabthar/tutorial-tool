import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Dots,
  Glyph,
  IconTile,
  LinkButton,
  Sheet,
  Shell,
  ShellPanel,
  StatusPill,
  useToast,
} from '@studio/ui';
import { formatDuration, navigate, TopBar } from '../frame';
import { buildFeed, runningRow } from './feedRows';
import { Feed } from './FeedPanel';
import { LiveViewPanel } from './LiveViewPanel';
import { useMakingModel, type MakingActions, type MakingModel } from './model';
import {
  CuesCard,
  Details,
  HelpCard,
  KnowledgeCard,
  NeedsYouCard,
  PermissionCard,
  ReviewCard,
} from './NeedsYou';
import { isPreviewState, previewModel } from './preview';
import { ScriptReview, scriptSummary, usePlanEdits } from './ScriptReview';
import {
  failureSentence,
  formatSince,
  groupOf,
  groupViews,
  minutesLeft,
  nowDetail,
  nowLabel,
  runCost,
  stageActivity,
  stageStartedAt,
} from './stages';
import './making.css';

/**
 * Making: one screen for a tutorial's run, from planning to the finished video. A status bar
 * with the stages, the live view, what the agent did, and cards for whatever needs the user.
 * `preview` (dev only) shows a sample run instead of the engine's.
 */
export function MakingScreen({ slug, preview }: { slug: string; preview?: string | null }) {
  const real = useMakingModel(slug);
  const toast = useToast();
  const kind = import.meta.env.DEV && isPreviewState(preview ?? null) ? preview : null;
  const model = useMemo(
    () => (kind && isPreviewState(kind) ? previewModel(real.model, kind) : real.model),
    [kind, real.model],
  );
  const actions: MakingActions = kind
    ? {
        approve: async (o) => toast(`Preview: would approve${o?.choice ? ` (${o.choice})` : ''}`),
        revise: async (f) => toast(`Preview: would ask for “${f}”`),
        stop: async () => toast('Preview: would stop'),
        resume: async () => toast('Preview: would try again'),
        answer: async (_id, allow) => toast(`Preview: would ${allow ? 'allow' : 'deny'}`),
        allowSafe: async () => toast('Preview: would allow safe actions'),
        editPlan: async () => undefined,
      }
    : real.actions;
  return <MakingView model={model} actions={actions} />;
}

function MakingView({ model, actions }: { model: MakingModel; actions: MakingActions }) {
  const st = model.state;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [busy, setBusy] = useState(false);
  const editor = usePlanEdits(actions.editPlan);

  const needsPermission = model.pending.length > 0;
  const gate = st?.status === 'waiting' ? st.gate : null;
  const reviewing = gate?.kind === 'narration' ? 'script' : gate?.kind === 'storyboard' ? 'steps' : null;
  const working = st?.status === 'running' && !needsPermission;
  const ended = st?.status === 'failed' || st?.status === 'stopped';
  const done = st?.status === 'done';
  const tone = done ? 'positive' : ended ? 'negative' : gate || needsPermission ? 'warning' : 'brand';

  const groups = groupViews(st, now, needsPermission);
  const left = needsPermission ? null : minutesLeft(st, now);
  const since = st ? stageStartedAt(st) : null;
  const feed = useMemo(() => buildFeed(st, model.events), [st, model.events]);
  const run = runningRow(st, model.events, model.progress, since);
  const planning = !st || st.status === 'idle' || (!!st.stage && groupOf(st.stage) === 'plan');
  const label = nowLabel(st, { needsPermission });
  const detail = nowDetail(st, {
    needsPermission,
    progress: model.progress?.message ?? feed.at(-1)?.text ?? 'Nothing is recorded yet.',
  });
  const cost = runCost(st, model.agent);
  const shotsAt = st?.history.filter((h) => h.stage === 'dry_run' && h.ok).at(-1)?.endedAt ?? null;

  /** Edits typed in the script go out before the decision. */
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await editor.flush();
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const disabled = busy || !model.ready;

  return (
    <div className="app-frame">
      <TopBar center={<span className="mk-topbar-title">{model.title}</span>} />
      <div className="app-frame-body">
        <main className="mk">
          <div className="mk-head">
            <LinkButton variant="quiet" size="sm" href="#/projects">
              <Glyph name="back" size={12} />
              Tutorials
            </LinkButton>
            <h1 className="mk-title">{model.title}</h1>
            {model.preview && <StatusPill tone="warning">Preview: sample data</StatusPill>}
          </div>

          <Shell aria-label="Status">
            <ShellPanel className="mk-status">
              <div className="mk-status-top" aria-live="polite">
                <IconTile
                  tone={tone}
                  icon={
                    done ? 'check' : ended ? 'stop' : needsPermission ? 'lock' : gate ? 'warn' : undefined
                  }
                >
                  {working && <Dots />}
                </IconTile>
                <div className="mk-status-text">
                  <div className="mk-status-label">{label}</div>
                  {detail && <div className="mk-status-detail">{detail}</div>}
                </div>
                {st?.startedAt && !ended && !done && (
                  <StatusPill icon="clock" title="Time since it started">
                    <span className="ui-sr-only">Elapsed </span>
                    <Since at={st.startedAt} />
                  </StatusPill>
                )}
                {done && st?.startedAt && st.endedAt && (
                  <StatusPill icon="clock" title="How long it took">
                    {formatSince(st.endedAt - st.startedAt)}
                  </StatusPill>
                )}
                {left !== null && (
                  <StatusPill tone="brand" title="A rough estimate from how long each stage usually takes">
                    about {left} min left
                  </StatusPill>
                )}
                {(st?.status === 'running' || st?.status === 'waiting') && (
                  <Button variant="danger" size="sm" onClick={() => setConfirmStop(true)}>
                    <Glyph name="stop" size={12} />
                    Stop
                  </Button>
                )}
                {done && (
                  <LinkButton variant="brand" href={`#/studio/${model.slug}`}>
                    Watch and edit <Glyph name="next" size={12} />
                  </LinkButton>
                )}
              </div>
              <ol
                className="mk-stages"
                style={{ gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))` }}
              >
                {groups.map((g) => (
                  <li key={g.id} className="mk-stage" data-state={g.state}>
                    <span className="mk-stage-bar" aria-hidden="true">
                      <i style={{ clipPath: `inset(0 ${100 - g.fill * 100}% 0 0 round 999px)` }} />
                    </span>
                    <b>{g.name}</b>
                    <span className="mk-stage-sub">{g.sub}</span>
                  </li>
                ))}
              </ol>
            </ShellPanel>
          </Shell>

          {model.error && (
            <p role="alert" className="mk-error">
              {model.error}
            </p>
          )}

          {done ? (
            <DoneCard model={model} cost={cost} />
          ) : (
            <div className="mk-cols">
              {reviewing && st?.plan ? (
                <ScriptReview
                  plan={st.plan}
                  mode={reviewing}
                  editor={editor}
                  shot={shotsAt ? (id) => model.media(`.studio/shots/${id}.jpg`, shotsAt) : undefined}
                />
              ) : (
                <LiveViewPanel
                  live={model.live}
                  planning={planning && !model.live.frame}
                  label={
                    working
                      ? st?.stage
                        ? stageActivity(st.stage, st)
                        : label
                      : ended
                        ? 'Stopped'
                        : 'Waiting for you'
                  }
                  working={working}
                  progress={model.progress}
                  media={model.media}
                />
              )}
              <div className="mk-side">
                {model.pending.map((p) => (
                  <PermissionCard
                    key={p.requestId}
                    request={p}
                    autoMode={model.autoMode}
                    disabled={!model.ready}
                    onAnswer={(allow) => void actions.answer(p.requestId, allow)}
                    onAllowSafe={() => void actions.allowSafe()}
                  />
                ))}
                {gate && reviewing && (
                  <ReviewCard
                    kind={reviewing}
                    summary={
                      reviewing === 'script' && st?.plan
                        ? scriptSummary(st.plan, model.target, editor.drafts)
                        : `${st?.plan?.steps.length ?? 0} steps planned. It tests them after you approve.`
                    }
                    disabled={disabled}
                    onApprove={() => void act(() => actions.approve())}
                    onRevise={(t) => act(() => actions.revise(t))}
                  />
                )}
                {gate?.kind === 'cues' && (
                  <CuesCard
                    gate={gate}
                    disabled={disabled}
                    onChoose={(choice, remember) => void act(() => actions.approve({ choice, remember }))}
                  />
                )}
                {gate?.kind === 'help' && (
                  <HelpCard
                    gate={gate}
                    image={gate.image ? model.media(gate.image) : null}
                    disabled={disabled}
                    onApprove={() => void act(() => actions.approve())}
                    onChoose={(choice, remember) => void act(() => actions.approve({ choice, remember }))}
                    onRevise={(t) => act(() => actions.revise(t))}
                  />
                )}
                {gate?.kind === 'knowledge' && (
                  <KnowledgeCard
                    gate={gate}
                    disabled={disabled}
                    onApprove={() => void act(() => actions.approve())}
                    onRevise={(t) => act(() => actions.revise(t))}
                  />
                )}
                {ended && st && (
                  <NeedsYouCard
                    alert
                    icon={st.status === 'stopped' ? 'stop' : 'warn'}
                    title={st.status === 'stopped' ? 'You stopped it' : 'It stopped with a problem'}
                    subtitle={
                      st.status === 'stopped'
                        ? 'Everything it did so far is kept. Carry on from the step it was on.'
                        : failureSentence(st)
                    }
                  >
                    <div className="mk-need-row">
                      {st.stage && (
                        <Button
                          variant="brand"
                          disabled={disabled}
                          onClick={() => void act(() => actions.resume())}
                        >
                          {st.status === 'stopped' ? 'Continue' : 'Try this step again'}
                        </Button>
                      )}
                      <Button onClick={() => setConfirmRestart(true)}>
                        Change the brief and start over…
                      </Button>
                    </div>
                    {(st.error || feed.at(-1)) && (
                      <Details>
                        {st.error && <div className="mk-pre">{st.error}</div>}
                        {feed.at(-1)?.details.map((d) => (
                          <div key={d.label} className="mk-pre">
                            {d.label}: {d.value}
                          </div>
                        ))}
                      </Details>
                    )}
                  </NeedsYouCard>
                )}
                {(!st || st.status === 'idle') && (
                  <NeedsYouCard
                    icon="film"
                    title="Not started"
                    subtitle="Write a brief, then start it from there."
                  >
                    <LinkButton variant="brand" href={`#/brief/${model.slug}`}>
                      Open the brief
                    </LinkButton>
                  </NeedsYouCard>
                )}
                <Feed rows={feed} running={needsPermission ? null : run} />
              </div>
            </div>
          )}
        </main>
      </div>

      <Sheet
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        title="Stop making this tutorial?"
        subtitle="It stops after what it is doing now. Everything so far is kept, and you can continue later from this screen."
        width={460}
      >
        <div className="mk-sheet-actions">
          <Button onClick={() => setConfirmStop(false)}>Keep going</Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmStop(false);
              void actions.stop();
            }}
          >
            Stop
          </Button>
        </div>
      </Sheet>
      <Sheet
        open={confirmRestart}
        onClose={() => setConfirmRestart(false)}
        title="Change the brief and start over?"
        subtitle="You edit the brief, then start a new run from the beginning. The steps it has tested so far are replaced when the new run plans again."
        width={480}
      >
        <div className="mk-sheet-actions">
          <Button onClick={() => setConfirmRestart(false)}>Cancel</Button>
          <Button variant="brand" onClick={() => navigate(`/brief/${model.slug}`)}>
            Open the brief
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

/** Time since `at`, ticking each second. */
function Since({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="mk-tabular">{formatSince(now - at)}</span>;
}

/** The finished tutorial: stats, the poster, and Watch and edit. */
function DoneCard({ model, cost }: { model: MakingModel; cost: number | null }) {
  const plan = model.state?.plan;
  return (
    <Shell aria-label="Finished">
      <ShellPanel className="mk-done">
        <StatusPill tone="positive" icon="check">
          Ready
        </StatusPill>
        <h2 className="mk-done-title">Ready to watch.</h2>
        <dl className="mk-stats">
          <div>
            <dt>long</dt>
            <dd>{formatDuration(model.duration)}</dd>
          </div>
          <div>
            <dt>steps</dt>
            <dd>{plan?.steps.length ?? '—'}</dd>
          </div>
          <div>
            <dt>{plan?.explainers.length === 1 ? 'explainer' : 'explainers'}</dt>
            <dd>{plan?.explainers.length ?? 0}</dd>
          </div>
        </dl>
        {model.poster && (
          <img className="mk-done-poster" src={model.poster} alt={`The first frame of ${model.title}`} />
        )}
        <LinkButton variant="brand" size="lg" href={`#/studio/${model.slug}`}>
          Watch and edit <Glyph name="next" size={14} />
        </LinkButton>
        <Details>
          {cost !== null && <div>agent cost for this run: ${cost.toFixed(2)}</div>}
          {model.agent?.sessionId && <div>session: {model.agent.sessionId.slice(0, 8)}</div>}
          {model.state?.runId && <div>run: {model.state.runId}</div>}
          <div>stages run: {model.state?.history.length ?? 0}</div>
        </Details>
      </ShellPanel>
    </Shell>
  );
}
