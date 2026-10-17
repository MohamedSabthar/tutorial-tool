import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { briefTitle, type ProjectSummary, type RpcResult } from '@studio/core';
import { Chip, IconArrowRight, Rule, type ChipTone } from '@studio/ui';
import { useEngine } from '../../engine';
import { AppFrame, formatDuration, navigate } from '../frame';

const SUGGESTIONS = [
  'Create an HTTP service with a GET /greeting resource and try it',
  'Connect to a MySQL database',
  'Map JSON to XML with the data mapper',
  'Expose a service as an AI agent tool',
];

/** Where a project card leads: the screen for the stage the tutorial is in. */
export function projectRoute(p: ProjectSummary): string {
  if (p.pipeline.status === 'running' || p.pipeline.status === 'waiting') return `/storyboard/${p.slug}`;
  if (p.duration !== null) return `/studio/${p.slug}`;
  if (p.status === 'draft') return `/brief/${p.slug}`;
  return `/storyboard/${p.slug}`;
}

export function projectChip(p: ProjectSummary): { label: string; tone: ChipTone } {
  if (p.pipeline.status === 'waiting' && p.pipeline.stage === 'storyboard_gate')
    return { label: 'Storyboard review', tone: 'info' };
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
  const [product, setProduct] = useState('wso2-integrator');
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      const [list, summary] = await Promise.all([
        client.call('project.list', {}),
        client.call('knowledge.summary', {}),
      ]);
      setProjects(list);
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
      const p = await client.call('project.create', { title: briefTitle(goal), product, brief: { goal } });
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
            Describe a task in a WSO2 product. The agent plans the steps, records them in VS Code, and drafts
            the narration, overlays and explainers for you to refine.
          </p>
          <form className="projects-prompt" onSubmit={(e) => void submit(e)}>
            <select
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
            </select>
            <input
              aria-label="Tutorial topic"
              className="projects-topic"
              placeholder="Create an HTTP service with a GET /greeting resource and try it"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
            <button
              type="submit"
              className="ui-btn ui-btn-primary ui-btn-lg"
              disabled={!topic.trim() || busy || !client}
            >
              {busy ? 'Creating…' : 'Set up tutorial'}
              <IconArrowRight />
            </button>
          </form>
          <div className="projects-suggestions" role="group" aria-label="Suggestions">
            {SUGGESTIONS.map((s) => (
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
                  <a key={p.slug} href={`#${projectRoute(p)}`} className="project-card">
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
                );
              })}
            </div>
          )}
        </section>
      </main>
    </AppFrame>
  );
}
