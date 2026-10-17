import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import {
  BRIEF_AUDIENCES,
  BRIEF_LENGTHS,
  BRIEF_STYLES,
  BRIEF_WORKSPACES,
  Brief,
  type Project,
  type RpcParams,
  type SkillCoverage,
} from '@studio/core';
import { Button, Chip, Field, Input, Panel, Segmented, Select, Switch, TextArea, Title } from '@studio/ui';
import { isTauri, openLiveWindow, useEngine } from '../../engine';
import { AppFrame, navigate } from '../frame';

type Source = RpcParams<'brief.addReference'>['source'];

const readBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error ?? new Error('could not read the file'));
    r.readAsDataURL(file);
  });

const GATES: { key: keyof Brief['gates']; label: string; ready: boolean }[] = [
  { key: 'storyboard', label: 'After storyboard', ready: true },
  { key: 'recording', label: 'After recording', ready: false },
  { key: 'export', label: 'Before export', ready: false },
];

export function BriefScreen({ slug }: { slug: string }) {
  const { client, state } = useEngine();
  const [project, setProject] = useState<Project | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [dirty, setDirty] = useState(false);
  const [coverage, setCoverage] = useState<SkillCoverage | null>(null);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [link, setLink] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!client || state !== 'open') return;
    void Promise.all([
      client.call('project.open', { slug }),
      client.call('brief.get', { slug }),
      client.call('knowledge.summary', {}),
    ]).then(
      ([open, b, k]) => {
        setProject(open.project);
        setBrief(b);
        setProducts(k.products);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [client, state, slug]);

  const update = (patch: Partial<Brief>) => {
    setBrief((b) => (b ? { ...b, ...patch } : b));
    setDirty(true);
    setSaved(false);
  };

  // Skill coverage follows the goal (debounced).
  const goal = brief?.goal ?? '';
  const product = project?.product;
  useEffect(() => {
    if (!client || !product) return;
    const t = setTimeout(() => {
      void client.call('skills.coverage', { product, goal }).then(setCoverage, () => undefined);
    }, 400);
    return () => clearTimeout(t);
  }, [client, product, goal]);

  const persist = useCallback(async () => {
    if (!client || !brief) return null;
    const b = await client.call('brief.save', { slug, brief: Brief.parse(brief) });
    setBrief(b);
    setDirty(false);
    return b;
  }, [client, brief, slug]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const addReferences = useCallback(
    (sources: Source[]) =>
      run('references', async () => {
        if (!client || !sources.length) return;
        if (dirty) await persist();
        let b: Brief | null = null;
        for (const source of sources) b = await client.call('brief.addReference', { slug, source });
        if (b) setBrief(b);
      }),
    [client, dirty, persist, slug],
  );

  // Inside Tauri, file drops arrive as paths through the webview's drag-and-drop event.
  const addRef = useRef(addReferences);
  useEffect(() => {
    addRef.current = addReferences;
  }, [addReferences]);
  useEffect(() => {
    if (!isTauri()) return;
    let off: (() => void) | undefined;
    let live = true;
    void import('@tauri-apps/api/webview').then(async ({ getCurrentWebview }) => {
      const unlisten = await getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type === 'enter' || e.payload.type === 'over') setDragging(true);
        else if (e.payload.type === 'leave') setDragging(false);
        else {
          setDragging(false);
          void addRef.current(e.payload.paths.map((path) => ({ kind: 'path' as const, path })));
        }
      });
      if (live) off = unlisten;
      else unlisten();
    });
    return () => {
      live = false;
      off?.();
    };
  }, []);

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = [...e.dataTransfer.files];
    if (files.length) {
      void addReferences(
        await Promise.all(
          files.map(async (f) => ({ kind: 'data' as const, name: f.name, base64: await readBase64(f) })),
        ),
      );
      return;
    }
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (/^https?:\/\//.test(url.trim())) void addReferences([{ kind: 'url', url: url.trim() }]);
  };

  const planAndRecord = () =>
    run('start', async () => {
      if (!client || !brief) return;
      if (!brief.goal.trim()) throw new Error('Say what the viewer should learn first.');
      const b = await persist();
      await client.call('pipeline.start', { slug, gates: { storyboard: b?.gates.storyboard ?? true } });
      await openLiveWindow();
      navigate(`/storyboard/${slug}`);
    });

  const relevant = coverage?.items.filter((i) => i.relevant) ?? [];
  const productName = products.find((p) => p.id === project?.product)?.name ?? project?.product ?? '';

  return (
    <AppFrame
      current="projects"
      slug={slug}
      footer={
        <>
          {error && (
            <span role="alert" className="app-error" style={{ marginRight: 'auto' }}>
              {error}
            </span>
          )}
          {!error && (dirty || saved) && (
            <span className="brief-saved" role="status">
              {dirty ? 'Unsaved changes' : 'Draft saved'}
            </span>
          )}
          <a className="ui-btn ui-btn-ghost ui-btn-lg" href="#/projects">
            Cancel
          </a>
          <Button
            size="lg"
            disabled={!brief || !!busy}
            onClick={() =>
              void run('save', async () => {
                await persist();
                setSaved(true);
              })
            }
          >
            Save draft
          </Button>
          <Button
            size="lg"
            variant="primary"
            disabled={!brief || !!busy}
            onClick={() => void planAndRecord()}
          >
            {busy === 'start' ? 'Starting…' : 'Plan and record'}
          </Button>
        </>
      }
    >
      <div className="brief">
        {!brief ? (
          <div className="brief-form">
            {state === 'open' ? 'Loading the brief…' : 'Waiting for the engine…'}
          </div>
        ) : (
          <form className="brief-form" onSubmit={(e) => e.preventDefault()} aria-label="Tutorial brief">
            <Title size={30} dot={false}>
              Tutorial brief
            </Title>
            <Field label="What should the viewer learn?">
              {(id) => (
                <TextArea
                  id={id}
                  rows={3}
                  className="brief-goal"
                  value={brief.goal}
                  placeholder="Create an HTTP service with a GET /greeting resource that returns JSON, run it, and call it from the Try It panel."
                  onChange={(e) => update({ goal: e.target.value })}
                />
              )}
            </Field>
            <div className="brief-grid">
              <Field label="Product" hint="Chosen when the tutorial was created.">
                {(id) => (
                  <Select id={id} value={project?.product ?? ''} disabled>
                    <option value={project?.product ?? ''}>{productName}</option>
                  </Select>
                )}
              </Field>
              <Field label="Starting workspace">
                {(id) => (
                  <Select
                    id={id}
                    value={brief.workspace}
                    onChange={(e) => update({ workspace: e.target.value as Brief['workspace'] })}
                  >
                    {BRIEF_WORKSPACES.map((w) => (
                      <option key={w.value} value={w.value}>
                        {w.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            {(
              [
                ['Audience', BRIEF_AUDIENCES, 'audience'],
                ['Length', BRIEF_LENGTHS, 'length'],
                ['Style', BRIEF_STYLES, 'style'],
              ] as const
            ).map(([label, options, key]) => (
              <div key={key} className="brief-seg-row">
                <span className="brief-seg-label">{label}</span>
                <Segmented
                  label={label}
                  options={options.map((o) => ({ value: o.value, label: o.label }))}
                  value={brief[key]}
                  onChange={(v) => update({ [key]: v } as Partial<Brief>)}
                />
              </div>
            ))}
            <div className="brief-grid">
              <Field label="Voice (ElevenLabs)" hint="Voices load once ElevenLabs is connected.">
                {(id) => (
                  <Select id={id} value="" disabled>
                    <option value="">Default voice</option>
                  </Select>
                )}
              </Field>
              <div style={{ alignSelf: 'end' }}>
                <Switch
                  label="Let the agent propose explainers"
                  checked={brief.explainers}
                  onChange={(v) => update({ explainers: v })}
                />
              </div>
            </div>
            <fieldset className="brief-gates">
              <legend>Review gates: pause for my approval</legend>
              <div className="brief-gate-list">
                {GATES.map((g) => (
                  <label
                    key={g.key}
                    className="brief-gate"
                    data-on={brief.gates[g.key] && g.ready ? 'true' : undefined}
                    title={g.ready ? undefined : 'This gate is not available yet'}
                  >
                    <input
                      type="checkbox"
                      checked={g.ready && brief.gates[g.key]}
                      disabled={!g.ready}
                      onChange={(e) => update({ gates: { ...brief.gates, [g.key]: e.target.checked } })}
                    />
                    {g.label}
                    {!g.ready && <span className="brief-gate-soon">soon</span>}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Notes for the agent">
              {(id) => (
                <TextArea
                  id={id}
                  rows={2}
                  value={brief.notes}
                  placeholder="Use port 9090. Blur the workspace path in the title bar."
                  onChange={(e) => update({ notes: e.target.value })}
                />
              )}
            </Field>
          </form>
        )}

        <aside className="brief-side">
          <Panel title="References">
            <div
              className="brief-drop"
              data-dragging={dragging ? 'true' : undefined}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => void onDrop(e)}
            >
              Drop docs, a VSIX, or links.
              <br />
              The agent reads them during planning.
              <Button
                size="sm"
                disabled={!brief || busy === 'references'}
                onClick={() => fileInput.current?.click()}
              >
                {busy === 'references' ? 'Adding…' : 'Choose files…'}
              </Button>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                aria-label="Reference files"
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = '';
                  void Promise.all(
                    files.map(async (f) => ({
                      kind: 'data' as const,
                      name: f.name,
                      base64: await readBase64(f),
                    })),
                  ).then(addReferences);
                }}
              />
            </div>
            <form
              className="brief-link"
              onSubmit={(e) => {
                e.preventDefault();
                const url = link.trim();
                if (!/^https?:\/\/\S+$/.test(url)) {
                  setError('Links start with http:// or https://');
                  return;
                }
                setLink('');
                void addReferences([{ kind: 'url', url }]);
              }}
            >
              <Input
                aria-label="Reference link"
                placeholder="https://bi.docs.wso2.com/…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
              <Button type="submit" size="sm" disabled={!link.trim() || !brief}>
                Add
              </Button>
            </form>
            {!!brief?.references.length && (
              <ul className="brief-refs" aria-label="Attached references">
                {brief.references.map((r, i) => (
                  <li key={r.kind === 'url' ? r.url : r.path}>
                    <span className="brief-ref">
                      {r.kind === 'url' ? r.url.replace(/^https?:\/\//, '') : r.name}
                    </span>
                    <button
                      type="button"
                      className="brief-ref-remove"
                      aria-label={`Remove ${r.kind === 'url' ? r.url : r.name}`}
                      onClick={() =>
                        void run('references', async () => {
                          if (dirty) await persist();
                          setBrief(await client!.call('brief.removeReference', { slug, index: i }));
                        })
                      }
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="What the agent already knows">
            {!coverage ? (
              <span className="brief-muted">Checking the knowledge base…</span>
            ) : !coverage.skill ? (
              <span className="brief-muted">
                There is no skill for this product yet. The agent will research every step.
              </span>
            ) : (
              <>
                {coverage.items.length === 0 && (
                  <span className="brief-muted">The {coverage.skill} skill has no component notes yet.</span>
                )}
                <ul className="brief-coverage">
                  {coverage.items.map((c) => (
                    <li key={c.name} data-relevant={c.relevant ? 'true' : undefined}>
                      <span className="ui-mono" title={c.title}>
                        {c.name}
                      </span>
                      <span style={{ display: 'flex', gap: 6 }}>
                        {c.relevant && <Chip tone="info">likely used</Chip>}
                        {c.lastVerified ? (
                          <Chip tone="ok" title={`Last verified ${c.lastVerified}`}>
                            verified
                          </Chip>
                        ) : (
                          <Chip>unverified</Chip>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                <span className={relevant.length ? 'brief-coverage-ok' : 'brief-muted'}>
                  {!goal.trim()
                    ? 'Describe the goal to see which notes apply.'
                    : relevant.length
                      ? `${relevant.length} note${relevant.length === 1 ? ' matches' : 's match'} this goal. Steps outside ${relevant.length === 1 ? 'it' : 'them'} need research during the dry run.`
                      : 'No notes match this goal yet. Expect research during the dry run.'}
                </span>
              </>
            )}
          </Panel>

          <Panel title="What happens next" tone="dark">
            <ol className="brief-next">
              <li>Plan the steps{brief?.explainers ? ' and propose explainers' : ''}</li>
              {brief?.gates.storyboard && <li>Storyboard review (your gate)</li>}
              <li>Write the script, dry run, record</li>
              <li>Narration, then a retrospective that updates the skills</li>
            </ol>
            <span className="ui-mono brief-next-meta">
              The Live window opens so you can watch the agent work.
            </span>
          </Panel>
        </aside>
      </div>
    </AppFrame>
  );
}
