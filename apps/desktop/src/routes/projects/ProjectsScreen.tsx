import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { briefTitle, type ProjectSummary, type RpcResult, type Series } from '@studio/core';
import {
  Button,
  Chip,
  IconArrowRight,
  IconTrash,
  Rule,
  Segmented,
  Select,
  TextArea,
  type ChipTone,
} from '@studio/ui';
import { useEngine } from '../../engine';
import { GetStarted } from '../settings/SetupChecklist';
import { AppFrame, formatDuration, navigate } from '../frame';
import { appendContext, ContextFiles } from '../ContextFiles';

const SUGGESTIONS = [
  'Create an HTTP service with a GET /greeting resource and try it',
  'Connect to a MySQL database',
  'Map JSON to XML with the data mapper',
  'Expose a service as an AI agent tool',
];

const SERIES_SUGGESTIONS = [
  'Build your first integration: an HTTP service that calls an API, maps the data and stores it in MySQL',
  'From zero to an AI agent that uses your services as tools',
];

type Mode = 'tutorial' | 'series';

/** A series part's state for the card's progress bar. */
function partTone(project: ProjectSummary | undefined): 'done' | 'active' | 'todo' {
  if (!project) return 'todo';
  if (project.status === 'exported') return 'done';
  const untouched = project.status === 'draft' && project.pipeline.status === 'idle';
  return untouched ? 'todo' : 'active';
}

/** "Part 2 of 5" for a project that belongs to a series. */
export function partLabel(p: ProjectSummary, series: readonly Series[]): string | null {
  if (!p.series) return null;
  const s = series.find((x) => x.slug === p.series!.slug);
  const i = s?.parts.findIndex((x) => x.id === p.series!.part) ?? -1;
  return s && i >= 0 ? `Part ${i + 1} of ${s.parts.length}` : null;
}

/** Where a project card leads: the screen for the stage the tutorial is in. */
export function projectRoute(p: ProjectSummary): string {
  if (p.capturing) return `/capture/${p.slug}`;
  if (p.pipeline.status === 'running' || p.pipeline.status === 'waiting') return `/storyboard/${p.slug}`;
  if (p.duration !== null) return `/studio/${p.slug}`;
  if (p.status === 'draft') return `/brief/${p.slug}`;
  return `/storyboard/${p.slug}`;
}

export function projectChip(p: ProjectSummary): { label: string; tone: ChipTone } {
  if (p.capturing) return { label: 'Capturing your demo', tone: 'info' };
  if (p.pipeline.status === 'waiting' && p.pipeline.stage === 'storyboard_gate')
    return { label: 'Storyboard review', tone: 'info' };
  if (p.pipeline.status === 'waiting' && p.pipeline.stage === 'narrate')
    return { label: 'Narration review', tone: 'info' };
  if (p.pipeline.status === 'waiting') return { label: 'Needs you', tone: 'info' };
  if (p.pipeline.status === 'running') return { label: 'Agent working', tone: 'info' };
  switch (p.status) {
    case 'edit':
      return { label: 'In edit', tone: 'active' };
    case 'exported':
      return { label: 'Exported', tone: 'ok' };
    case 'recording':
      return { label: 'Recording', tone: 'info' };
    case 'storyboard':
      return { label: 'Storyboard review', tone: 'info' };
    default:
      return { label: 'Draft', tone: 'neutral' };
  }
}

const shortDate = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'today';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export function ProjectsScreen() {
  const { client, state, info } = useEngine();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [knowledge, setKnowledge] = useState<RpcResult<'knowledge.summary'> | null>(null);
  const [series, setSeries] = useState<Series[]>([]);
  const [mode, setMode] = useState<Mode>('tutorial');
  const [product, setProduct] = useState('wso2-integrator');
  const [topic, setTopic] = useState('');
  /** Optional context for the agent: the brief's notes, or the series' notes. */
  const [context, setContext] = useState('');
  const [showContext, setShowContext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The project whose delete is being confirmed. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const remove = async (slug: string) => {
    if (!client) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await client.call('project.delete', { slug });
      setConfirming(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  const load = useCallback(async () => {
    if (!client) return;
    try {
      const [list, summary, seriesList] = await Promise.all([
        client.call('project.list', {}),
        client.call('knowledge.summary', {}),
        client.call('series.list', {}),
      ]);
      setProjects(list);
      setSeries(seriesList);
      setKnowledge(summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client]);

  useEffect(() => {
    if (!client || state !== 'open') return;
    void Promise.resolve().then(load);
    const offs = [
      client.on('project.changed', () => void load()),
      client.on('pipeline.changed', () => void load()),
      client.on('series.changed', () => void load()),
    ];
    return () => offs.forEach((off) => off());
  }, [client, state, load]);

  const products = knowledge?.products.length
    ? knowledge.products
    : [{ id: 'wso2-integrator', name: 'WSO2 Integrator' }];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const goal = topic.trim();
    if (!client || !goal) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'series') {
        const s = await client.call('series.create', {
          topic: goal,
          product,
          ...(context.trim() ? { notes: context.trim() } : {}),
        });
        // The agent starts on the outline; if it can't (no Claude Code), the Series screen offers it again.
        await client.call('series.plan', { slug: s.slug }).catch(() => undefined);
        navigate(`/series/${s.slug}`);
        return;
      }
      const p = await client.call('project.create', {
        title: briefTitle(goal),
        product,
        brief: { goal, ...(context.trim() ? { notes: context.trim() } : {}) },
      });
      navigate(`/brief/${p.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const media = (rel: string) =>
    info ? `http://127.0.0.1:${info.port}${rel}?token=${encodeURIComponent(info.token)}` : undefined;

  return (
    <AppFrame current="projects">
      <main className="projects">
        <section className="projects-hero">
          <h1 className="projects-title">
            What should we teach today<span className="ui-title-dot">.</span>
          </h1>
          <p className="projects-lede">
            {mode === 'series'
              ? 'Describe what the series should teach. The agent splits it into parts that build on each other, records each one in VS Code, and links them together.'
              : 'Describe a task in a WSO2 product. The agent plans the steps, records them in VS Code, and drafts the narration, overlays and explainers for you to refine.'}
          </p>
          <Segmented<Mode>
            label="What to make"
            options={[
              { value: 'tutorial', label: 'Single tutorial' },
              { value: 'series', label: 'Series' },
            ]}
            value={mode}
            onChange={setMode}
          />
          <form className="projects-prompt" onSubmit={(e) => void submit(e)}>
            <Select
              aria-label="Product"
              className="projects-product"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <input
              aria-label={mode === 'series' ? 'What the series is about' : 'Tutorial topic'}
              className="projects-topic"
              placeholder={
                mode === 'series'
                  ? 'Build your first integration: a service that calls an API and stores the result'
                  : 'Create an HTTP service with a GET /greeting resource and try it'
              }
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
            <button
              type="submit"
              className="ui-btn ui-btn-primary ui-btn-lg"
              disabled={!topic.trim() || busy || !client}
            >
              {busy ? 'Creating…' : mode === 'series' ? 'Plan series' : 'Set up tutorial'}
              <IconArrowRight />
            </button>
            {showContext ? (
              <div className="projects-context">
                <label htmlFor="projects-context">
                  Context <span>(optional)</span>
                </label>
                <TextArea
                  id="projects-context"
                  rows={context.length > 400 ? 8 : 3}
                  autoFocus
                  value={context}
                  placeholder={
                    mode === 'series'
                      ? 'Who it is for, what they already know, names and sample data to use in every part, what to leave out…'
                      : 'Who it is for, what they already know, names and sample data to use, what to leave out…'
                  }
                  onChange={(e) => setContext(e.target.value)}
                />
                <ContextFiles onText={(text) => setContext((c) => appendContext(c, text))} />
                <span className="projects-context-hint">
                  {mode === 'series'
                    ? 'The agent reads this when it plans the parts, and every part reads it too. Edit it later in the series notes.'
                    : 'The agent reads this when it plans. Edit it later in the brief, under Notes for the agent.'}
                </span>
              </div>
            ) : (
              <button type="button" className="projects-context-toggle" onClick={() => setShowContext(true)}>
                + Add context
              </button>
            )}
          </form>
          <div className="projects-suggestions" role="group" aria-label="Suggestions">
            {(mode === 'series' ? SERIES_SUGGESTIONS : SUGGESTIONS).map((s) => (
              <button key={s} type="button" className="projects-suggestion" onClick={() => setTopic(s)}>
                {s}
              </button>
            ))}
          </div>
          {error && (
            <span role="alert" className="app-error">
              {error}
            </span>
          )}
        </section>

        <GetStarted />

        {series.length > 0 && (
          <section className="projects-recent" aria-labelledby="series-heading">
            <div className="projects-recent-head">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <h2 id="series-heading" className="projects-h2">
                  Series
                </h2>
                <Rule width={40} />
              </div>
            </div>
            <div className="series-grid">
              {series.map((s) => {
                const parts = s.parts.map((part) => ({
                  part,
                  tone: partTone(projects?.find((p) => p.slug === part.project)),
                }));
                const started = parts.filter((x) => x.tone !== 'todo').length;
                const exported = parts.filter((x) => x.tone === 'done').length;
                const productName = products.find((x) => x.id === s.product)?.name ?? s.product;
                return (
                  <a key={s.slug} href={`#/series/${s.slug}`} className="series-card">
                    <span className="series-card-head">
                      <span className="series-card-title">{s.title}</span>
                      <Chip tone="info">
                        {s.outline !== 'approved'
                          ? 'Outline'
                          : exported === parts.length
                            ? 'Done'
                            : started === 0
                              ? 'Ready to make'
                              : `${started} of ${parts.length} started`}
                      </Chip>
                    </span>
                    {parts.length > 0 && (
                      <span
                        className="series-bar"
                        aria-label={`${exported} of ${parts.length} parts exported`}
                        style={{ gridTemplateColumns: `repeat(${parts.length}, minmax(0, 1fr))` }}
                      >
                        {parts.map((x) => (
                          <span key={x.part.id} className={`series-bar-seg series-bar-${x.tone}`} />
                        ))}
                      </span>
                    )}
                    <span className="series-card-meta">
                      {parts.length} part{parts.length === 1 ? '' : 's'} · {exported} exported · {productName}{' '}
                      · {shortDate(s.updatedAt)}
                    </span>
                  </a>
                );
              })}
            </div>
          </section>
        )}

        <section className="projects-recent" aria-labelledby="recent-heading">
          <div className="projects-recent-head">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h2 id="recent-heading" className="projects-h2">
                Recent tutorials
              </h2>
              <Rule width={40} />
            </div>
            {knowledge && (
              <span className="projects-kb">
                Knowledge base: {knowledge.productSkills} product skill
                {knowledge.productSkills === 1 ? '' : 's'} · {knowledge.components} component note
                {knowledge.components === 1 ? '' : 's'} · {knowledge.overlays} overlay
                {knowledge.overlays === 1 ? '' : 's'} · {knowledge.scenes} explainer
                {knowledge.scenes === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {projects === null ? (
            <span className="projects-empty">
              {state === 'open' ? 'Loading…' : 'Waiting for the engine…'}
            </span>
          ) : projects.length === 0 ? (
            <span className="projects-empty">No tutorials yet. Describe one above to start.</span>
          ) : (
            <div className="projects-grid">
              {projects.map((p) => {
                const chip = projectChip(p);
                const productName = products.find((x) => x.id === p.product)?.name ?? p.product;
                return (
                  <div key={p.slug} className="project-card-wrap">
                    <a href={`#${projectRoute(p)}`} className="project-card">
                      <div className="project-thumb">
                        {p.poster ? (
                          <img src={media(p.poster)} alt="" loading="lazy" />
                        ) : (
                          <>
                            <span className="project-thumb-line" style={{ width: '44%', top: 12 }} />
                            <span
                              className="project-thumb-line"
                              style={{ width: '28%', top: 26, opacity: 0.6 }}
                            />
                          </>
                        )}
                        <span className="project-len ui-mono">{formatDuration(p.duration)}</span>
                        {partLabel(p, series) && <span className="project-part">{partLabel(p, series)}</span>}
                      </div>
                      <div className="project-body">
                        <span className="project-title">{p.title}</span>
                        <div className="project-meta">
                          <Chip tone={chip.tone}>{chip.label}</Chip>
                          <span>
                            {productName} · {shortDate(p.updatedAt)}
                          </span>
                        </div>
                      </div>
                    </a>
                    {confirming === p.slug ? (
                      <div className="project-confirm" role="alertdialog" aria-label={`Delete ${p.title}?`}>
                        <strong>Delete “{p.title}”?</strong>
                        <span>
                          Its folder, takes and voice-over are removed from the workspace. The workspace's git
                          history keeps a copy.
                        </span>
                        {deleteError && (
                          <span role="alert" className="project-confirm-error">
                            {deleteError}
                          </span>
                        )}
                        <div className="project-confirm-actions">
                          <Button size="sm" onClick={() => setConfirming(null)} disabled={deleting}>
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            autoFocus
                            disabled={deleting}
                            onClick={() => void remove(p.slug)}
                          >
                            {deleting ? 'Deleting…' : 'Delete'}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="project-delete"
                        aria-label={`Delete ${p.title}`}
                        title="Delete this tutorial"
                        onClick={() => {
                          setDeleteError(null);
                          setConfirming(p.slug);
                        }}
                      >
                        <IconTrash size={16} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </AppFrame>
  );
}
