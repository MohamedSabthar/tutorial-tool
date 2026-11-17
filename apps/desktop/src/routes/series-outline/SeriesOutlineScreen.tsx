import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  applySeriesEdit,
  BRIEF_AUDIENCES,
  BRIEF_LENGTHS,
  BRIEF_STYLES,
  type PartStatus,
  type ProjectSummary,
  type Series,
  type SeriesBrief,
  type SeriesEdit,
  type SeriesOutputs,
  type SeriesPart,
} from '@studio/core';
import {
  AgentStatus,
  Button,
  Glyph,
  IconTile,
  Segmented,
  Sheet,
  Shell,
  ShellHeader,
  ShellPanel,
  StatusPill,
  useToast,
} from '@studio/ui';
import { useEngine } from '../../engine';
import { appendContext, ContextFiles } from '../ContextFiles';
import { navigate, TopBar } from '../frame';
import { useComposerOptions } from '../home/Composer';
import { tileRoute, tileStatus } from '../home/tutorialStatus';
import {
  PREVIEW_ACTIVITY,
  previewProjects,
  previewSeries,
  previewStarts,
  type OutlinePreview,
} from './fixtures';
import './outline.css';

type Length = SeriesBrief['length'];
const LENGTHS: { value: Length; label: string }[] = BRIEF_LENGTHS.map((l) => ({
  value: l.value,
  label: l.value === 'medium' ? '2–3 min' : l.label,
}));
/** Rough minutes of video per episode, for the totals. */
const MINUTES: Record<Length, number> = { short: 1, medium: 2.5, long: 5 };
const LENGTH_PILL: Record<Length, string> = { short: '~1 min', medium: '~2–3 min', long: '5+ min' };

const OUTPUT_TEXTS: { key: 'titleCard' | 'endCard'; text: 'titleText' | 'endText'; label: string }[] = [
  { key: 'titleCard', text: 'titleText', label: 'Title card line' },
  { key: 'endCard', text: 'endText', label: 'End card line' },
];

/** Objectives are edited one per line. */
const objectiveLines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.replace(/^\s*[-•*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 10);

function previewOf(query: string | undefined): OutlinePreview | null {
  if (!import.meta.env.DEV) return null;
  const p = new URLSearchParams(query ?? '').get('preview');
  return p === 'drafting' || p === 'review' || p === 'approved' || p === 'empty' ? p : null;
}

/** "Starts from …" for an episode. */
function startsFrom(series: Series, i: number): string {
  const part = series.parts[i]!;
  if (i === 0 || part.startFrom === 'clean') return 'Starts from an empty project';
  if (part.startFrom === 'previous') return `Starts where episode ${i} ends`;
  const n = series.parts.findIndex((p) => p.id === part.startFrom) + 1;
  return n > 0 ? `Starts where episode ${n} ends` : `Starts where episode ${i} ends`;
}

/**
 * The series outline: the agent drafts the episodes, the user edits and approves them, then each
 * episode is made like any tutorial. Shared settings sit beside the list; the rest of what the old
 * Series screen offered is under "More options".
 */
export function SeriesOutlineScreen({ slug, query }: { slug: string; query?: string }) {
  const { client, state } = useEngine();
  const toast = useToast();
  const preview = previewOf(query);
  const wantsAdd = new URLSearchParams(query ?? '').get('add') === '1';
  const { products, voices, defaultVoice } = useComposerOptions();
  const [series, setSeries] = useState<Series | null>(() => (preview ? previewSeries(slug, preview) : null));
  const [projects, setProjects] = useState<ProjectSummary[]>(() =>
    preview === 'approved' ? previewProjects() : [],
  );
  const [starts, setStarts] = useState<PartStatus[]>(() => (preview === 'approved' ? previewStarts() : []));
  const [activity, setActivity] = useState(preview === 'drafting' ? PREVIEW_ACTIVITY : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const addInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!client || preview) return;
    try {
      const [s, list, st] = await Promise.all([
        client.call('series.get', { slug }),
        client.call('project.list', {}),
        client.call('series.starts', { slug }).catch(() => [] as PartStatus[]),
      ]);
      setSeries(s);
      setProjects(list);
      setStarts(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client, slug, preview]);

  useEffect(() => {
    if (!client || state !== 'open' || preview) return;
    void Promise.resolve().then(load);
    const offs = [
      client.on('series.changed', (d) => d.slug === slug && void load()),
      client.on('project.changed', () => void load()),
      client.on('pipeline.changed', () => void load()),
      client.on('series.activity', (d) => d.slug === slug && setActivity(d.text)),
    ];
    return () => offs.forEach((off) => off());
  }, [client, state, slug, load, preview]);

  // From Home's "Add an episode": focus the new episode's title.
  const focused = useRef(false);
  useEffect(() => {
    if (!wantsAdd || focused.current || !series || series.outline === 'planning') return;
    focused.current = true;
    addInput.current?.focus();
    addInput.current?.scrollIntoView({ block: 'center' });
  }, [wantsAdd, series]);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  /** Saves an edit (in a preview, applies it here only). */
  const edit = async (e: SeriesEdit) => {
    setError(null);
    if (preview) {
      setSeries((s) => (s ? applySeriesEdit(s, e) : s));
      return;
    }
    if (!client) return;
    try {
      setSeries(await client.call('series.edit', { slug, edit: e }));
    } catch (err) {
      fail(err);
    }
  };

  /** Runs an action that talks to the agent or makes tutorials (never in a preview). */
  const act = async (label: string, fn: () => Promise<void>) => {
    if (preview) {
      toast('Preview: nothing was sent.');
      return;
    }
    if (!client) return;
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  if (!series)
    return (
      <div className="app-frame">
        <TopBar current="tutorials" />
        <div className="app-frame-body">
          <main className="so">
            {error ? (
              <p role="alert" className="so-error">
                {error}
              </p>
            ) : (
              <p className="so-muted">Loading…</p>
            )}
          </main>
        </div>
      </div>
    );

  const planning = series.outline === 'planning';
  const approved = series.outline === 'approved';
  const n = series.parts.length;
  const unmade = series.parts.filter((p) => !p.project).length;
  const project = (s: string | null) => (s ? projects.find((p) => p.slug === s) : undefined);
  const status = (id: string) => starts.find((x) => x.part === id);
  const partNumber = (id: string) => series.parts.findIndex((x) => x.id === id) + 1;
  const productName = products.find((p) => p.id === series.product)?.name ?? series.product;
  const minutes = Math.round(n * MINUTES[series.brief.length]);
  const setBrief = (brief: Partial<SeriesBrief>) => void edit({ op: 'meta', brief });
  const setOutputs = (outputs: Partial<SeriesOutputs>) => void edit({ op: 'meta', outputs });

  /** The first episode whose tutorial exists but hasn't been started. */
  const next = series.parts.findIndex((part) => {
    const p = project(part.project);
    return p && !status(part.id)?.recordedAt && p.status === 'draft' && p.pipeline.status === 'idle';
  });
  const nextStatus = next >= 0 ? status(series.parts[next]!.id) : undefined;
  const waitsFor = nextStatus?.blocked ? series.parts.find((x) => x.id === nextStatus.start) : undefined;

  const plan = (text?: string) =>
    act('plan', async () => {
      setActivity('');
      setSeries(await client!.call('series.plan', { slug, ...(text ? { feedback: text } : {}) }));
      if (text) setFeedback('');
    });
  const cancelPlan = () =>
    act('cancel', async () => {
      setSeries(await client!.call('series.cancelPlan', { slug }));
    });
  const approveOnly = () =>
    act('approve', async () => {
      setSeries(await client!.call('series.approve', { slug }));
      toast(`Created ${unmade} draft tutorial${unmade === 1 ? '' : 's'}. Make them one at a time.`);
    });
  /** Approves if needed, then starts episode `index`'s run and follows it. */
  const make = (index: number) =>
    act(`make:${index}`, async () => {
      const s = series.parts.some((p) => !p.project)
        ? await client!.call('series.approve', { slug })
        : series;
      setSeries(s);
      const target = s.parts[index]?.project;
      if (!target) throw new Error('That episode has no tutorial yet.');
      await client!.call('pipeline.start', {
        slug: target,
        gates: { storyboard: s.brief.gates.storyboard, narration: s.brief.gates.narration },
      });
      navigate(`/making/${target}`);
    });
  const keep = (part: string) =>
    act(`keep:${part}`, async () => {
      setStarts(await client!.call('series.keep', { slug, part }));
    });
  const remove = () =>
    act('delete', async () => {
      await client!.call('series.delete', { slug });
      navigate('/projects');
    });

  const addPart = async (e: FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim() || 'New episode';
    setNewTitle('');
    await edit({ op: 'addPart', title });
    toast(`Added “${title}”. Give it a goal, or ask the agent to fill it in.`);
  };

  const revise = (e: FormEvent) => {
    e.preventDefault();
    const text = feedback.trim();
    if (text) void plan(text);
  };

  const statusCard = () => {
    if (planning)
      return (
        <ShellPanel className="so-status">
          <AgentStatus
            label={activity || `Reading what it knows about ${productName}`}
            since={Date.parse(series.updatedAt)}
            onStop={() => void cancelPlan()}
          />
          <p className="so-muted">Nothing is recorded yet. This only plans the episodes.</p>
        </ShellPanel>
      );
    let tone: 'warning' | 'negative' | 'positive' | 'neutral' = 'warning';
    let title: string;
    let detail: string;
    let action: React.ReactNode = null;
    if (series.planError && !approved) {
      tone = 'negative';
      title = "The agent couldn't draft the outline";
      detail = series.planError;
      action = (
        <Button size="sm" onClick={() => void plan()} disabled={!!busy}>
          Try again
        </Button>
      );
    } else if (series.outline === 'review') {
      title = 'Your turn: approve the outline';
      detail = `${n} episode${n === 1 ? '' : 's'} · about ${minutes} min of video in total · each starts where the last one ended`;
    } else if (approved) {
      tone = 'positive';
      const made = series.parts.filter((p) => project(p.project)?.duration != null).length;
      title = 'Outline approved';
      detail = `${n} episode${n === 1 ? '' : 's'} · ${made} recorded · each is its own tutorial`;
    } else {
      tone = 'neutral';
      title = n ? 'Your outline' : 'Let the agent draft the episodes';
      detail = n
        ? 'Approve it when it looks right, or let the agent complete it.'
        : 'It reads what it knows about the product and splits the topic into episodes that build on each other. You can also add episodes by hand.';
      action = (
        <Button size="sm" variant={n ? 'secondary' : 'brand'} onClick={() => void plan()} disabled={!!busy}>
          <Glyph name="spark" size={12} />
          {n ? 'Complete it with the agent' : 'Draft with the agent'}
        </Button>
      );
    }
    return (
      <ShellPanel className="so-status">
        <div className="so-status-top">
          <IconTile icon={tone === 'positive' ? 'check' : tone === 'neutral' ? 'film' : 'warn'} tone={tone} />
          <div className="so-grow">
            <div className="so-status-title">{title}</div>
            <div className="so-muted">{detail}</div>
          </div>
          {action}
        </div>
      </ShellPanel>
    );
  };

  const episode = (part: SeriesPart, i: number) => {
    const p = project(part.project);
    const st = p ? tileStatus(p) : null;
    const ps = status(part.id);
    return (
      <li key={part.id} className="so-ep k-enter">
        <span className="so-num" aria-hidden="true">
          {i + 1}
        </span>
        <label className="ui-sr-only" htmlFor={`so-t-${part.id}`}>
          Episode {i + 1} title
        </label>
        <input
          id={`so-t-${part.id}`}
          className="so-ep-title"
          key={`t:${part.title}`}
          defaultValue={part.title}
          onBlur={(e) => {
            const title = e.target.value.trim();
            if (title && title !== part.title) void edit({ op: 'editPart', id: part.id, title });
            else e.target.value = part.title;
          }}
        />
        <span className="so-ep-actions">
          <button
            type="button"
            className="ui-btn ui-btn-sm ui-btn-quiet ui-icon-btn"
            aria-label={`Move episode ${i + 1} up`}
            disabled={i === 0}
            onClick={() => void edit({ op: 'movePart', id: part.id, to: i - 1 })}
          >
            <Glyph name="next" size={12} style={{ transform: 'rotate(-90deg)' }} />
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-sm ui-btn-quiet ui-icon-btn"
            aria-label={`Move episode ${i + 1} down`}
            disabled={i === n - 1}
            onClick={() => void edit({ op: 'movePart', id: part.id, to: i + 1 })}
          >
            <Glyph name="next" size={12} style={{ transform: 'rotate(90deg)' }} />
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-sm ui-btn-quiet ui-icon-btn"
            aria-label={`Remove episode ${i + 1}`}
            title={part.project ? 'It has a tutorial: delete the tutorial first' : undefined}
            disabled={!!part.project}
            onClick={() => {
              void edit({ op: 'removePart', id: part.id });
              toast(`Removed “${part.title}”.`);
            }}
          >
            <Glyph name="trash" size={12} />
          </button>
        </span>
        <label className="ui-sr-only" htmlFor={`so-g-${part.id}`}>
          Episode {i + 1} goal
        </label>
        <textarea
          id={`so-g-${part.id}`}
          className="so-ep-goal"
          rows={Math.min(6, Math.max(1, Math.ceil(part.goal.length / 85)))}
          key={`g:${part.goal}`}
          defaultValue={part.goal}
          placeholder="What this episode shows, in a sentence or two"
          onBlur={(e) => {
            if (e.target.value !== part.goal)
              void edit({ op: 'editPart', id: part.id, goal: e.target.value });
          }}
        />
        <span className="so-ep-pills">
          <StatusPill icon="clock">{LENGTH_PILL[series.brief.length]}</StatusPill>
          <StatusPill>{startsFrom(series, i)}</StatusPill>
          {st && p && (
            <a
              className="so-pilllink"
              href={`#${tileRoute(p)}`}
              aria-label={`${st.label}: open episode ${i + 1}`}
            >
              <StatusPill tone={st.tone} icon={st.icon} busy={st.busy}>
                {st.label}
              </StatusPill>
            </a>
          )}
          {ps?.blocked && <StatusPill icon="clock">Waits for episode {partNumber(ps.start)}</StatusPill>}
          {ps?.stale && (
            <StatusPill tone="warning" icon="warn">
              May be out of date
            </StatusPill>
          )}
        </span>
        <details className="so-more so-ep-more">
          <summary>
            <Glyph name="next" size={11} className="so-caret" />
            More for this episode
          </summary>
          <div className="so-more-body">
            <label className="so-lbl" htmlFor={`so-o-${part.id}`}>
              What viewers can do after it <span className="so-muted">(one per line)</span>
            </label>
            <textarea
              id={`so-o-${part.id}`}
              className="ui-textarea"
              rows={Math.max(2, part.objectives.length)}
              key={`o:${part.objectives.join('\n')}`}
              defaultValue={part.objectives.join('\n')}
              onBlur={(e) => {
                const objectives = objectiveLines(e.target.value);
                if (objectives.join('\n') !== part.objectives.join('\n'))
                  void edit({ op: 'editPart', id: part.id, objectives });
              }}
            />
            {i > 0 && (
              <>
                <label className="so-lbl" htmlFor={`so-s-${part.id}`}>
                  Starts from
                </label>
                <select
                  id={`so-s-${part.id}`}
                  className="ui-select"
                  value={part.startFrom}
                  onChange={(e) => void edit({ op: 'editPart', id: part.id, startFrom: e.target.value })}
                >
                  <option value="previous">
                    Where episode {i} ends ({series.parts[i - 1]!.title})
                  </option>
                  {series.parts.slice(0, i - 1).map((earlier, k) => (
                    <option key={earlier.id} value={earlier.id}>
                      Where episode {k + 1} ends ({earlier.title})
                    </option>
                  ))}
                  <option value="clean">An empty project</option>
                </select>
              </>
            )}
            {ps?.stale && p && (
              <div className="so-stale">
                <span className="so-muted">
                  The episode it starts from was recorded again (or its start changed) after this one was
                  recorded, so this recording may no longer match.
                </span>
                <span className="so-row">
                  <Button size="sm" onClick={() => navigate(tileRoute(p))}>
                    Open to record again
                  </Button>
                  <Button size="sm" variant="quiet" onClick={() => void keep(part.id)}>
                    It still matches
                  </Button>
                </span>
              </div>
            )}
          </div>
        </details>
      </li>
    );
  };

  const approvalCard = () => {
    if (planning) return null;
    if (!approved && n > 0)
      return (
        <section className="so-approve k-enter" aria-labelledby="so-approve-h">
          <div className="so-approve-in">
            <div className="so-status-top">
              <IconTile icon="film" tone="warning" />
              <div className="so-grow">
                <b id="so-approve-h">Approve the outline</b>
                <p className="so-muted">Each episode then gets its own script check.</p>
              </div>
            </div>
            <Button variant="brand" size="lg" disabled={!!busy} onClick={() => void make(0)}>
              {busy === 'make:0' ? 'Starting…' : 'Make episode 1 now'}
            </Button>
            <Button disabled={!!busy} onClick={() => void approveOnly()}>
              {busy === 'approve' ? 'Creating…' : `Approve and keep all ${n} as drafts`}
            </Button>
            <p className="so-small">
              Episode 1: about 25 min and $2. Episodes are made one at a time: start the next from here or its
              tile when the one before is recorded.
            </p>
            <form className="so-field" onSubmit={revise}>
              <label className="so-lbl" htmlFor="so-feedback">
                Or ask for changes
              </label>
              <textarea
                id="so-feedback"
                className="ui-textarea"
                rows={2}
                value={feedback}
                placeholder="Merge episodes 3 and 4, and add one on deploying"
                onChange={(e) => setFeedback(e.target.value)}
              />
              <Button type="submit" size="sm" disabled={!feedback.trim() || !!busy} className="so-start">
                Send
              </Button>
            </form>
          </div>
        </section>
      );
    if (approved && unmade > 0)
      return (
        <section className="so-approve k-enter" aria-label="New episodes">
          <div className="so-approve-in">
            <b>
              {unmade} new episode{unmade === 1 ? '' : 's'} without a tutorial yet
            </b>
            <Button variant="brand" disabled={!!busy} onClick={() => void approveOnly()}>
              {busy === 'approve' ? 'Creating…' : 'Create their tutorials'}
            </Button>
          </div>
        </section>
      );
    if (approved && next >= 0) {
      const waits = waitsFor ? project(waitsFor.project) : undefined;
      return (
        <section className="so-approve k-enter" aria-label="Next episode">
          <div className="so-approve-in">
            <div className="so-status-top">
              <IconTile icon="play" tone="brand" />
              <div className="so-grow">
                <b>Next: episode {next + 1}</b>
                <p className="so-muted">
                  {waitsFor
                    ? `It starts where episode ${partNumber(waitsFor.id)} ends, so that one is recorded first.`
                    : `${series.parts[next]!.title}. Its agent knows what the episodes before it covered.`}
                </p>
              </div>
            </div>
            {waitsFor && waits ? (
              <Button variant="brand" size="lg" onClick={() => navigate(tileRoute(waits))}>
                Finish episode {partNumber(waitsFor.id)}
              </Button>
            ) : (
              <Button variant="brand" size="lg" disabled={!!busy} onClick={() => void make(next)}>
                {busy === `make:${next}` ? 'Starting…' : `Make episode ${next + 1} now`}
              </Button>
            )}
          </div>
        </section>
      );
    }
    return null;
  };

  return (
    <div className="app-frame">
      <TopBar current="tutorials" />
      <div className="app-frame-body">
        <main className="so">
          <div className="so-row">
            <a className="ui-btn ui-btn-quiet" href="#/projects">
              <Glyph name="back" size={12} />
              Tutorials
            </a>
            <StatusPill tone="brand" icon="film">
              {approved ? 'Series' : 'New series'}
            </StatusPill>
          </div>
          <label className="ui-sr-only" htmlFor="so-title">
            Series title
          </label>
          <input
            id="so-title"
            className="so-title"
            key={`title:${series.title}`}
            defaultValue={series.title}
            onBlur={(e) => {
              const title = e.target.value.trim();
              if (title && title !== series.title) void edit({ op: 'meta', title });
              else e.target.value = series.title;
            }}
          />
          {series.topic && series.topic !== series.title && <p className="so-topic">{series.topic}</p>}
          {error && (
            <p role="alert" className="so-error">
              {error}
            </p>
          )}
          <Shell aria-live="polite">{statusCard()}</Shell>

          <div className="so-grid">
            <Shell aria-labelledby="so-eps-h">
              <ShellHeader
                icon="film"
                title={<span id="so-eps-h">Episodes</span>}
                subtitle="Rename, reorder or remove. Each becomes its own tutorial."
                aside={<span className="so-count">{n}</span>}
              />
              <ShellPanel className="so-eps">
                <fieldset className="so-lock" disabled={planning}>
                  <legend className="ui-sr-only">Episodes</legend>
                  {n > 0 && <ol className="so-list">{series.parts.map(episode)}</ol>}
                  {n === 0 && !planning && (
                    <p className="so-muted so-pad">
                      No episodes yet. Let the agent draft them, or add one below.
                    </p>
                  )}
                  {planning ? (
                    <div className="so-drafting">
                      <span className="k-spin" aria-hidden="true" />
                      <span className="so-muted">Drafting {n ? 'the next episode' : 'the episodes'}…</span>
                    </div>
                  ) : (
                    <form className="so-add" onSubmit={(e) => void addPart(e)}>
                      <label className="ui-sr-only" htmlFor="so-new">
                        New episode title
                      </label>
                      <input
                        id="so-new"
                        ref={addInput}
                        className="ui-input"
                        placeholder="Title of a new episode"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                      />
                      <Button type="submit" disabled={n >= 20}>
                        <Glyph name="plus" size={12} />
                        Add an episode
                      </Button>
                    </form>
                  )}
                </fieldset>
              </ShellPanel>
            </Shell>

            <div className="so-side">
              {approvalCard()}
              <Shell aria-labelledby="so-shared-h">
                <ShellHeader icon="gear" title={<span id="so-shared-h">Shared by every episode</span>} />
                <ShellPanel className="so-shared">
                  <div className="so-field">
                    <span className="so-lbl">Product</span>
                    <span className="so-row">
                      <StatusPill>{productName}</StatusPill>
                    </span>
                  </div>
                  <div className="so-field">
                    <span className="so-lbl">Length of each episode</span>
                    <Segmented<Length>
                      label="Length of each episode"
                      options={LENGTHS}
                      value={series.brief.length}
                      onChange={(length) => setBrief({ length })}
                    />
                  </div>
                  <div className="so-field">
                    <label className="so-lbl" htmlFor="so-voice">
                      Voice
                    </label>
                    {voices && voices.length === 0 ? (
                      <span className="so-small">
                        Add an ElevenLabs key in <a href="#/settings">Settings</a> to pick a voice.
                      </span>
                    ) : (
                      <select
                        id="so-voice"
                        className="ui-select"
                        value={series.brief.voice ?? ''}
                        onChange={(e) => setBrief({ voice: e.target.value || null })}
                      >
                        <option value="">{voices ? 'The default voice' : 'Loading voices…'}</option>
                        {voices?.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                            {v.id === defaultVoice ? ' (default)' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <label className="so-check">
                    <input
                      type="checkbox"
                      checked={series.outputs.titleCard}
                      onChange={(e) => setOutputs({ titleCard: e.target.checked })}
                    />
                    <span>
                      <b>Episode number on the title card</b>
                      <span className="so-small">“Part 2 of 4” above each title.</span>
                    </span>
                  </label>
                  <label className="so-check">
                    <input
                      type="checkbox"
                      checked={series.outputs.recap && series.outputs.endCard}
                      onChange={(e) => setOutputs({ recap: e.target.checked, endCard: e.target.checked })}
                    />
                    <span>
                      <b>“Previously” and “Up next”</b>
                      <span className="so-small">
                        A one-line recap at the start, a card naming the next episode at the end.
                      </span>
                    </span>
                  </label>
                  <label className="so-check">
                    <input
                      type="checkbox"
                      checked={series.brief.explainers !== 'off'}
                      onChange={(e) => setBrief({ explainers: e.target.checked ? 'designed' : 'off' })}
                    />
                    <span>
                      <b>Short explainers for concepts</b>
                    </span>
                  </label>
                  <label className="so-check">
                    <input
                      type="checkbox"
                      checked={series.brief.gates.storyboard}
                      onChange={(e) =>
                        setBrief({ gates: { ...series.brief.gates, storyboard: e.target.checked } })
                      }
                    />
                    <span>
                      <b>Let me check the steps before each records</b>
                    </span>
                  </label>

                  <details className="so-more">
                    <summary>
                      <Glyph name="next" size={11} className="so-caret" />
                      More options
                    </summary>
                    <div className="so-more-body">
                      {(
                        [
                          ['Audience', BRIEF_AUDIENCES, 'audience'],
                          ['Style', BRIEF_STYLES, 'style'],
                        ] as const
                      ).map(([label, options, key]) => (
                        <div className="so-field" key={key}>
                          <label className="so-lbl" htmlFor={`so-${key}`}>
                            {label}
                          </label>
                          <select
                            id={`so-${key}`}
                            className="ui-select"
                            value={series.brief[key]}
                            onChange={(e) => setBrief({ [key]: e.target.value } as Partial<SeriesBrief>)}
                          >
                            {options.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                      <div className="so-field">
                        <label className="so-lbl" htmlFor="so-notes">
                          Series notes
                        </label>
                        <textarea
                          id="so-notes"
                          className="ui-textarea"
                          rows={4}
                          key={`n:${series.notes}`}
                          defaultValue={series.notes}
                          placeholder="Names, sample data and words to use. Every episode's agent reads these."
                          onBlur={(e) => {
                            if (e.target.value !== series.notes)
                              void edit({ op: 'meta', notes: e.target.value });
                          }}
                        />
                        <ContextFiles
                          onText={(text) =>
                            void edit({ op: 'meta', notes: appendContext(series.notes, text) })
                          }
                        />
                      </div>
                      {OUTPUT_TEXTS.filter((o) => series.outputs[o.key]).map((o) => (
                        <div className="so-field" key={o.key}>
                          <label className="so-lbl" htmlFor={`so-${o.text}`}>
                            {o.label}
                          </label>
                          <input
                            id={`so-${o.text}`}
                            className="ui-input ui-mono"
                            key={`${o.text}:${series.outputs[o.text]}`}
                            defaultValue={series.outputs[o.text]}
                            onBlur={(e) => {
                              const text = e.target.value.trim();
                              if (text && text !== series.outputs[o.text]) setOutputs({ [o.text]: text });
                            }}
                          />
                          <span className="so-small">
                            {'{n}, {total}, {series} and {next} are filled in.'}
                          </span>
                        </div>
                      ))}
                      <label className="so-check">
                        <input
                          type="checkbox"
                          checked={series.outputs.recapScene}
                          onChange={(e) => setOutputs({ recapScene: e.target.checked })}
                        />
                        <span>
                          <b>Recap explainer at the start of each episode</b>
                          <span className="so-small">One scene designed once for the series, reused.</span>
                        </span>
                      </label>
                      <label className="so-check">
                        <input
                          type="checkbox"
                          checked={series.outputs.links}
                          onChange={(e) => setOutputs({ links: e.target.checked })}
                        />
                        <span>
                          <b>Previous and next links in the docs</b>
                        </span>
                      </label>
                      <label className="so-check">
                        <input
                          type="checkbox"
                          checked={series.outputs.index}
                          onChange={(e) => setOutputs({ index: e.target.checked })}
                        />
                        <span>
                          <b>Series index</b>
                          <span className="so-small">
                            README.md listing every episode, written with each export.
                          </span>
                        </span>
                      </label>
                      <label className="so-check">
                        <input
                          type="checkbox"
                          checked={series.brief.autoMode}
                          onChange={(e) => setBrief({ autoMode: e.target.checked })}
                        />
                        <span>
                          <b>Approve safe agent actions without asking</b>
                        </span>
                      </label>
                      <Button
                        variant="danger"
                        size="sm"
                        className="so-start"
                        onClick={() => setConfirmDelete(true)}
                      >
                        <Glyph name="trash" size={12} />
                        Delete series…
                      </Button>
                    </div>
                  </details>
                </ShellPanel>
              </Shell>
            </div>
          </div>
        </main>
      </div>
      <Sheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this series?"
        subtitle="The outline is removed. Tutorials already made for its episodes stay, as single tutorials."
        width={460}
      >
        <div className="so-sheet-actions">
          <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button variant="danger" disabled={busy === 'delete'} onClick={() => void remove()}>
            Delete
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
