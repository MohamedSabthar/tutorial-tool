import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  BRIEF_AUDIENCES,
  BRIEF_LENGTHS,
  BRIEF_STYLES,
  type PartStatus,
  type ProjectSummary,
  type Series,
  type SeriesBrief,
  type SeriesEdit,
} from '@studio/core';
import {
  Button,
  Chip,
  Field,
  GateBanner,
  IconArrowRight,
  IconButton,
  IconChevron,
  IconTrash,
  Input,
  LinkButton,
  Select,
  TextArea,
} from '@studio/ui';
import { useEngine } from '../../engine';
import { AppFrame, navigate } from '../frame';
import { projectChip, projectRoute } from '../projects/ProjectsScreen';

const BRIEF_FIELDS = [
  ['Audience', BRIEF_AUDIENCES, 'audience'],
  ['Length of each part', BRIEF_LENGTHS, 'length'],
  ['Style', BRIEF_STYLES, 'style'],
] as const;

/** Under a part's start picker: what its runs open. */
function startHint(st: PartStatus | undefined, partNumber: (id: string) => number): string {
  if (!st || st.start === 'clean') return "Its runs open the script's own fixture.";
  const n = partNumber(st.start);
  return st.blocked
    ? `Its runs open part ${n}'s project as its recording ends, once part ${n} is recorded.`
    : `Its runs open part ${n}'s project as its recording ended.`;
}

/** Objectives are edited one per line. */
const objectiveLines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.replace(/^\s*[-•*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 10);

/**
 * A series: its title and topic, the parts in order (each editable, reorderable and removable),
 * and the brief and notes every part shares.
 */
export function SeriesScreen({ slug }: { slug: string }) {
  const { client, state } = useEngine();
  const [series, setSeries] = useState<Series | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [starts, setStarts] = useState<PartStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newPart, setNewPart] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [activity, setActivity] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      const [s, list, st] = await Promise.all([
        client.call('series.get', { slug }),
        client.call('project.list', {}),
        client.call('series.starts', { slug }),
      ]);
      setSeries(s);
      setProjects(list);
      setStarts(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client, slug]);

  useEffect(() => {
    if (!client || state !== 'open') return;
    void Promise.resolve().then(load);
    const offs = [
      client.on('series.changed', (d) => d.slug === slug && void load()),
      client.on('project.changed', () => void load()),
      client.on('series.activity', (d) => d.slug === slug && setActivity(d.text)),
    ];
    return () => offs.forEach((off) => off());
  }, [client, state, slug, load]);

  const edit = async (e: SeriesEdit) => {
    if (!client) return;
    setError(null);
    try {
      setSeries(await client.call('series.edit', { slug, edit: e }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const addPart = async (e: FormEvent) => {
    e.preventDefault();
    const title = newPart.trim();
    if (!title) return;
    // Clear at once, so a title typed while this one saves isn't wiped.
    setNewPart('');
    await edit({ op: 'addPart', title });
  };

  /** Runs a series action, showing its error. */
  const act = async (label: string, fn: () => Promise<Series>) => {
    setBusy(label);
    setError(null);
    try {
      setSeries(await fn());
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const plan = (text?: string) =>
    client &&
    act('plan', async () => {
      setActivity('');
      return client.call('series.plan', { slug, ...(text ? { feedback: text } : {}) });
    });
  const revise = async (e: FormEvent) => {
    e.preventDefault();
    const text = feedback.trim();
    if (text && (await plan(text))) setFeedback('');
  };
  const approve = () => client && act('approve', () => client.call('series.approve', { slug }));
  const cancelPlan = () => client && act('cancel', () => client.call('series.cancelPlan', { slug }));

  const remove = async () => {
    if (!client) return;
    try {
      await client.call('series.delete', { slug });
      navigate('/projects');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!series)
    return (
      <AppFrame current="projects">
        <main className="series">
          {error ? (
            <span role="alert" className="app-error">
              {error}
            </span>
          ) : (
            <span className="projects-empty">Loading…</span>
          )}
        </main>
      </AppFrame>
    );

  const project = (s: string | null) => (s ? projects.find((p) => p.slug === s) : undefined);
  const setBrief = (brief: Partial<SeriesBrief>) => void edit({ op: 'meta', brief });
  const planning = series.outline === 'planning';
  const unmade = series.parts.filter((p) => !p.project).length;

  /** The first part whose tutorial hasn't been started: "Make next part" opens its brief. */
  const next = series.parts.findIndex((part) => {
    const p = project(part.project);
    const recorded = starts.find((x) => x.part === part.id)?.recordedAt;
    return p && !recorded && p.status === 'draft' && p.pipeline.status === 'idle';
  });
  const status = (id: string) => starts.find((x) => x.part === id);
  const partNumber = (id: string) => series.parts.findIndex((x) => x.id === id) + 1;
  const nextStatus = next >= 0 ? status(series.parts[next]!.id) : undefined;
  /** The part the next one waits for, when its start isn't recorded yet. */
  const waitsFor = nextStatus?.blocked ? series.parts.find((x) => x.id === nextStatus.start) : undefined;
  const waitsForProject = project(waitsFor?.project ?? null);
  const stale = series.parts.filter((x) => status(x.id)?.stale);
  const footer =
    series.outline === 'approved' && unmade === 0 && next >= 0 ? (
      <>
        <span className="series-hint" style={{ marginRight: 'auto' }}>
          {waitsFor
            ? `Part ${next + 1} starts from part ${partNumber(waitsFor.id)} as its recording ends, so part ${partNumber(waitsFor.id)} is recorded first.`
            : "Parts are made one at a time. Each part's agent knows what the parts before it covered."}
        </span>
        {waitsFor && waitsForProject ? (
          <LinkButton variant="primary" href={`#${projectRoute(waitsForProject)}`}>
            Finish part {partNumber(waitsFor.id)}
            <IconArrowRight />
          </LinkButton>
        ) : (
          <LinkButton variant="primary" href={`#/brief/${series.parts[next]!.project!}`}>
            Make part {next + 1}
            <IconArrowRight />
          </LinkButton>
        )}
      </>
    ) : unmade > 0 && !planning ? (
      <>
        <span className="series-hint" style={{ marginRight: 'auto' }}>
          {series.outline === 'approved'
            ? `${unmade} new part${unmade === 1 ? '' : 's'} without a tutorial yet.`
            : `Approving creates ${unmade} draft tutorial${unmade === 1 ? '' : 's'}. You make them one at a time.`}
        </span>
        <Button variant="primary" disabled={!!busy} onClick={() => void approve()}>
          {busy === 'approve'
            ? 'Creating tutorials…'
            : series.outline === 'approved'
              ? 'Create their tutorials'
              : 'Approve outline'}
          <IconArrowRight />
        </Button>
      </>
    ) : undefined;

  return (
    <AppFrame current="projects" footer={footer}>
      <main className="series">
        <section className="series-main" aria-labelledby="series-title">
          <span className="ui-eyebrow">
            Series · {series.parts.length} part{series.parts.length === 1 ? '' : 's'}
          </span>
          <label htmlFor="series-title" className="ui-sr-only">
            Series title
          </label>
          <Input
            id="series-title"
            key={`title:${series.title}`}
            className="series-title-input"
            defaultValue={series.title}
            onBlur={(e) => {
              const title = e.target.value.trim();
              if (title && title !== series.title) void edit({ op: 'meta', title });
            }}
          />
          {series.topic && <p className="series-topic">{series.topic}</p>}
          {error && (
            <span role="alert" className="app-error">
              {error}
            </span>
          )}
          {series.planError && !planning && (
            <span role="alert" className="app-error">
              {series.planError}
            </span>
          )}
          {planning && (
            <GateBanner
              title="The agent is writing the outline…"
              text={activity || 'Reading the product skill'}
              actions={
                <Button size="sm" disabled={!!busy} onClick={() => void cancelPlan()}>
                  Stop
                </Button>
              }
            />
          )}
          {series.outline === 'draft' && !planning && (
            <GateBanner
              title="Let the agent propose the parts"
              text="It reads the product skill and splits the topic into parts that build on each other. You can also add parts by hand."
              actions={
                <Button variant="primary" size="sm" disabled={!!busy} onClick={() => void plan()}>
                  {busy === 'plan' ? 'Starting…' : 'Plan with the agent'}
                </Button>
              }
            />
          )}
          {stale.map((x) => {
            const st = status(x.id)!;
            const n = partNumber(st.start);
            const p = project(x.project);
            return (
              <GateBanner
                key={x.id}
                title={`Part ${partNumber(x.id)} may be out of date.`}
                text={`It starts from part ${n}, which was recorded again (or its start changed) after part ${partNumber(x.id)} was recorded, so its recording may no longer match.`}
                actions={
                  <>
                    {p && (
                      <LinkButton size="sm" href={`#${projectRoute(p)}`}>
                        Record part {partNumber(x.id)} again
                      </LinkButton>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        client &&
                        void client
                          .call('series.keep', { slug, part: x.id })
                          .then(setStarts, (e: unknown) =>
                            setError(e instanceof Error ? e.message : String(e)),
                          )
                      }
                    >
                      It still matches
                    </Button>
                  </>
                }
              />
            );
          })}
          {series.outline === 'review' && (
            <GateBanner
              title={`The agent proposed ${series.parts.length} part${series.parts.length === 1 ? '' : 's'}.`}
              text="Rename, reorder or remove parts, or ask the agent to change the outline. Nothing is recorded until you approve it."
            />
          )}

          {series.parts.length === 0 && !planning && (
            <span className="projects-empty">
              No parts yet. Let the agent propose them, or add them below.
            </span>
          )}
          <fieldset className="series-lock" disabled={planning}>
            <ol className="series-parts">
              {series.parts.map((part, i) => {
                const p = project(part.project);
                const chip = p ? projectChip(p) : null;
                const last = i === series.parts.length - 1;
                return (
                  <li key={part.id} className="series-part">
                    <span className="series-part-n" aria-hidden="true">
                      {i + 1}
                    </span>
                    <div className="series-part-body">
                      <Field label={`Part ${i + 1} title`}>
                        {(id) => (
                          <Input
                            id={id}
                            key={`t:${part.title}`}
                            defaultValue={part.title}
                            onBlur={(e) => {
                              const title = e.target.value.trim();
                              if (title && title !== part.title)
                                void edit({ op: 'editPart', id: part.id, title });
                            }}
                          />
                        )}
                      </Field>
                      <Field label="Goal">
                        {(id) => (
                          <TextArea
                            id={id}
                            rows={2}
                            key={`g:${part.goal}`}
                            defaultValue={part.goal}
                            placeholder="What this part shows, in a sentence or two"
                            onBlur={(e) => {
                              if (e.target.value !== part.goal)
                                void edit({ op: 'editPart', id: part.id, goal: e.target.value });
                            }}
                          />
                        )}
                      </Field>
                      <Field
                        label="Learning objectives"
                        hint="One per line: what a viewer can do after this part."
                      >
                        {(id) => (
                          <TextArea
                            id={id}
                            rows={Math.max(2, part.objectives.length)}
                            key={`o:${part.objectives.join('\n')}`}
                            defaultValue={part.objectives.join('\n')}
                            onBlur={(e) => {
                              const objectives = objectiveLines(e.target.value);
                              if (objectives.join('\n') !== part.objectives.join('\n'))
                                void edit({ op: 'editPart', id: part.id, objectives });
                            }}
                          />
                        )}
                      </Field>
                      {i > 0 && (
                        <Field label="Starts from" hint={startHint(status(part.id), partNumber)}>
                          {(id) => (
                            <Select
                              id={id}
                              value={part.startFrom}
                              onChange={(e) =>
                                void edit({ op: 'editPart', id: part.id, startFrom: e.target.value })
                              }
                            >
                              <option value="previous">
                                The previous part's project (part {i}: {series.parts[i - 1]!.title})
                              </option>
                              {series.parts.slice(0, i - 1).map((earlier, k) => (
                                <option key={earlier.id} value={earlier.id}>
                                  Part {k + 1}'s project ({earlier.title})
                                </option>
                              ))}
                              <option value="clean">A clean project</option>
                            </Select>
                          )}
                        </Field>
                      )}
                      {p && chip && (
                        <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                          <Chip tone={chip.tone}>{chip.label}</Chip>
                          {status(part.id)?.blocked && (
                            <Chip tone="info">Waiting for part {partNumber(status(part.id)!.start)}</Chip>
                          )}
                          {status(part.id)?.stale && <Chip tone="error">Out of date</Chip>}
                          <a href={`#${projectRoute(p)}`}>Open the tutorial</a>
                        </span>
                      )}
                    </div>
                    <div className="series-part-actions">
                      <IconButton
                        label={`Move part ${i + 1} up`}
                        disabled={i === 0}
                        onClick={() => void edit({ op: 'movePart', id: part.id, to: i - 1 })}
                      >
                        <IconChevron size={14} style={{ transform: 'rotate(-90deg)' }} />
                      </IconButton>
                      <IconButton
                        label={`Move part ${i + 1} down`}
                        disabled={last}
                        onClick={() => void edit({ op: 'movePart', id: part.id, to: i + 1 })}
                      >
                        <IconChevron size={14} style={{ transform: 'rotate(90deg)' }} />
                      </IconButton>
                      <IconButton
                        label={`Remove part ${i + 1}`}
                        disabled={!!part.project}
                        onClick={() => void edit({ op: 'removePart', id: part.id })}
                      >
                        <IconTrash size={14} />
                      </IconButton>
                    </div>
                  </li>
                );
              })}
            </ol>
            <form className="series-add" onSubmit={(e) => void addPart(e)}>
              <label htmlFor="new-part" className="ui-sr-only">
                New part title
              </label>
              <Input
                id="new-part"
                placeholder="Title of a new part"
                value={newPart}
                onChange={(e) => setNewPart(e.target.value)}
              />
              <Button type="submit" disabled={!newPart.trim() || series.parts.length >= 20}>
                + Add a part
              </Button>
            </form>
          </fieldset>
          {series.outline !== 'approved' && series.parts.length > 0 && (
            <form className="series-revise" onSubmit={(e) => void revise(e)}>
              <Field label="Ask the agent to change the outline">
                {(id) => (
                  <TextArea
                    id={id}
                    rows={3}
                    value={feedback}
                    disabled={planning}
                    placeholder="e.g. Split part 4 in two, and use the same sample data in every part."
                    onChange={(e) => setFeedback(e.target.value)}
                  />
                )}
              </Field>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button type="submit" variant="steel" disabled={planning || !!busy || !feedback.trim()}>
                  Revise outline
                </Button>
              </div>
            </form>
          )}
        </section>

        <aside className="series-side" aria-labelledby="shared-h">
          <h2 id="shared-h" className="series-side-h">
            Shared brief
          </h2>
          <span className="series-hint">
            Every part starts with these. A part can change them in its own brief.
          </span>
          {BRIEF_FIELDS.map(([label, options, key]) => (
            <Field key={key} label={label}>
              {(id) => (
                <Select
                  id={id}
                  value={series.brief[key]}
                  onChange={(e) => setBrief({ [key]: e.target.value } as Partial<SeriesBrief>)}
                >
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ))}
          <Field
            label="Series notes"
            hint="Names, sample data and words to use. Every part's agent reads these."
          >
            {(id) => (
              <TextArea
                id={id}
                rows={5}
                key={`n:${series.notes}`}
                defaultValue={series.notes}
                onBlur={(e) => {
                  if (e.target.value !== series.notes) void edit({ op: 'meta', notes: e.target.value });
                }}
              />
            )}
          </Field>
          {confirmDelete ? (
            <div className="series-confirm" role="alertdialog" aria-label={`Delete ${series.title}?`}>
              <strong>Delete this series?</strong>
              <span>
                The outline is removed. Tutorials already made for its parts stay, as single tutorials.
              </span>
              <div className="series-confirm-actions">
                <Button size="sm" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
                <Button size="sm" variant="danger" autoFocus onClick={() => void remove()}>
                  Delete
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
              Delete series
            </Button>
          )}
        </aside>
      </main>
    </AppFrame>
  );
}
