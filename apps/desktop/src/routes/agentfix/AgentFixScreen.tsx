import { useEffect, useMemo, useState } from 'react';
import type { Annotation, Run } from '@studio/core';
import { Button, Chip, LinkButton, Segmented, TextArea, type ChipTone } from '@studio/ui';
import { useEngine } from '../../engine';
import { useTimeline } from '../../studio/useTimeline';
import { useRuns } from '../../studio/useRuns';
import { AppFrame } from '../frame';

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

/** What an annotation's chip says, given the runs that worked on it. */
function noteStatus(a: Annotation, runs: Run[]): { label: string; tone: ChipTone } {
  const run = [...runs].reverse().find((r) => r.annotationIds.includes(a.id));
  if (a.status === 'resolved') return { label: run ? `Accepted · run #${run.n}` : 'Resolved', tone: 'ok' };
  if (run?.status === 'running') return { label: `Agent working · run #${run.n}`, tone: 'info' };
  if (run?.status === 'review') return { label: `Fixed in run #${run.n} · review`, tone: 'active' };
  if (a.status === 'sent') return { label: 'Sent to the agent', tone: 'info' };
  return { label: 'Open', tone: 'neutral' };
}

/** Diff lines with their kind, for colouring. */
function diffLines(diff: string) {
  return diff.split('\n').map((text) => ({
    text,
    kind:
      text.startsWith('+++') ||
      text.startsWith('---') ||
      text.startsWith('diff ') ||
      text.startsWith('index ')
        ? 'meta'
        : text.startsWith('@@')
          ? 'hunk'
          : text.startsWith('+')
            ? 'add'
            : text.startsWith('-')
              ? 'del'
              : 'ctx',
  }));
}

/**
 * Agent fix review: the annotations, before/after frames of the selected run at the
 * annotation's time, the file diff and timeline changes, the agent's summary and checks, and
 * Accept / Reopen / Revert run, plus a follow-up to the agent.
 */
export function AgentFixScreen({ slug, initialRun }: { slug: string; initialRun: number | null }) {
  const { client, info } = useEngine();
  const tl = useTimeline(slug);
  const { runs } = useRuns(slug);
  const [n, setN] = useState<number | null>(initialRun);
  const [detail, setDetail] = useState<{ run: Run; diff: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [filter, setFilter] = useState<'All' | 'Open'>('All');
  const [zoom, setZoom] = useState<'Close-up' | 'Full frame'>('Close-up');
  const [followUp, setFollowUp] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Default to the newest run waiting for review (or the newest run).
  const current =
    n ??
    [...runs].reverse().find((r) => r.status === 'review' || r.status === 'running')?.n ??
    runs.at(-1)?.n ??
    null;
  const summary = runs.find((r) => r.n === current) ?? null;
  useEffect(() => {
    if (!client || current === null) return;
    let live = true;
    void client.call('runs.get', { slug, n: current }).then(
      (d) => live && setDetail(d),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
    // Re-fetch when the run's record changes (frames arrive, status changes).
  }, [client, slug, current, summary?.status, summary?.after, JSON.stringify(summary?.frames ?? {})]);

  const run = detail?.run.n === current ? detail.run : null;
  const notes = tl.timeline?.annotations ?? [];
  const numbered = notes.map((a, i) => ({ a, n: i + 1 }));
  const shown = numbered.filter(({ a }) => filter === 'All' || a.status !== 'resolved');
  const selected = note ?? run?.annotationIds[0] ?? null;
  const selectedNote = numbered.find(({ a }) => a.id === selected);
  const frames = selected && run ? run.frames[selected] : undefined;
  // The close-up centres on the annotation (its point, or its region's centre).
  const focus = selectedNote
    ? (() => {
        const sh = selectedNote.a.shape;
        const x = sh.kind === 'point' ? sh.x : sh.x + sh.w / 2;
        const y = sh.kind === 'point' ? sh.y : sh.y + sh.h / 2;
        return { x: (x / 1920) * 100, y: (y / 1080) * 100 };
      })()
    : null;
  const media = (rel: string) =>
    info ? `http://127.0.0.1:${info.port}/media/${slug}/${rel}?token=${encodeURIComponent(info.token)}` : '';
  const lines = useMemo(() => diffLines(detail?.diff ?? ''), [detail?.diff]);
  const prev = run ? [...runs].reverse().find((r) => r.n < run.n) : undefined;

  const act = async (label: string, fn: () => Promise<unknown>) => {
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

  return (
    <AppFrame current="studio" slug={slug}>
      <div className="agentfix">
        <aside className="agentfix-notes" aria-label="Annotations">
          <div className="agentfix-head">
            <span className="agentfix-h">Annotations</span>
            <Segmented
              label="Filter"
              options={['All', 'Open'] as const}
              value={filter}
              onChange={setFilter}
            />
          </div>
          {shown.length === 0 && (
            <span className="brief-muted">No annotations{filter === 'Open' ? ' open' : ''}.</span>
          )}
          {shown.map(({ a, n: k }) => {
            const st = noteStatus(a, runs);
            return (
              <button
                key={a.id}
                type="button"
                className="agentfix-note"
                aria-current={a.id === selected || undefined}
                onClick={() => {
                  setNote(a.id);
                  const r = [...runs].reverse().find((x) => x.annotationIds.includes(a.id));
                  if (r) setN(r.n);
                }}
              >
                <span className="agentfix-note-top">
                  <span className="ui-pin" data-resolved={a.status === 'resolved' || undefined}>
                    {k}
                  </span>
                  <span className="ui-mono agentfix-meta">{fmt(a.t)}</span>
                </span>
                <span className="agentfix-note-text">{a.comment}</span>
                <Chip tone={st.tone}>{st.label}</Chip>
              </button>
            );
          })}
          {runs.length > 0 && (
            <>
              <span className="agentfix-h" style={{ marginTop: 8 }}>
                Runs
              </span>
              <div className="agentfix-runs">
                {[...runs].reverse().map((r) => (
                  <button
                    key={r.n}
                    type="button"
                    className="agentfix-run"
                    aria-current={r.n === current || undefined}
                    onClick={() => {
                      setN(r.n);
                      setNote(null);
                    }}
                  >
                    <span className="ui-mono">#{r.n}</span>
                    <span className="agentfix-run-text">{r.prompt || 'Chat'}</span>
                    <span className="agentfix-meta">{r.status}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </aside>

        <main className="agentfix-main">
          {error && (
            <span role="alert" className="app-error">
              {error}
            </span>
          )}
          {!run ? (
            <div className="storyboard-empty">
              {runs.length
                ? 'Loading the run…'
                : 'No agent runs yet. Send an annotation or ask the agent for a change in the Studio.'}
            </div>
          ) : (
            <>
              <div className="agentfix-head">
                <span className="agentfix-meta">
                  {run.prompt ? `“${run.prompt.slice(0, 120)}”` : `Run #${run.n}`}
                </span>
                <Segmented
                  label="Frame view"
                  options={['Close-up', 'Full frame'] as const}
                  value={zoom}
                  onChange={setZoom}
                />
              </div>
              <div className="agentfix-views">
                {(['before', 'after'] as const).map((which) => (
                  <figure key={which} className="agentfix-view">
                    <figcaption>
                      <b>
                        {which === 'before'
                          ? `Before · ${prev ? `run #${prev.n}` : 'original'}`
                          : `After · run #${run.n}`}
                      </b>
                      {selectedNote && <span className="ui-mono">@ {fmt(selectedNote.a.t)}</span>}
                    </figcaption>
                    {frames?.[which] ? (
                      zoom === 'Close-up' && focus ? (
                        <div
                          role="img"
                          aria-label={`${which === 'before' ? 'Before' : 'After'} run #${run.n}, close-up`}
                          className="agentfix-closeup"
                          style={{
                            backgroundImage: `url(${media(frames[which]!)})`,
                            backgroundPosition: `${focus.x}% ${focus.y}%`,
                          }}
                        />
                      ) : (
                        <img
                          src={media(frames[which]!)}
                          alt={`${which === 'before' ? 'Before' : 'After'} run #${run.n}`}
                        />
                      )
                    ) : (
                      <div className="agentfix-noframe">
                        {run.status === 'running' && which === 'after'
                          ? 'The agent is still working…'
                          : (run.framesNote ??
                            (run.annotationIds.length
                              ? 'No frame for this annotation.'
                              : 'This run has no annotation to frame.'))}
                      </div>
                    )}
                  </figure>
                ))}
              </div>
              <section aria-label="Diff" className="agentfix-diff">
                <div className="agentfix-diff-head">
                  {run.files.length === 0 && run.timeline.length === 0 ? (
                    <span className="agentfix-meta">
                      {run.status === 'running'
                        ? 'Changes appear when the run finishes.'
                        : 'No file changes.'}
                    </span>
                  ) : (
                    run.files.map((f) => (
                      <span key={f.path} className="agentfix-file">
                        <span className="ui-mono">{f.path.replace(`projects/${slug}/`, 'project/')}</span>
                        <span className="agentfix-add">+{f.added}</span>
                        <span className="agentfix-del">−{f.removed}</span>
                      </span>
                    ))
                  )}
                  <span style={{ flex: 1 }} />
                  <span className="agentfix-meta">
                    {prev ? `run #${prev.n} → #${run.n}` : `run #${run.n}`}
                  </span>
                </div>
                {run.timeline.length > 0 && (
                  <ul className="agentfix-timeline">
                    {run.timeline.map((l) => (
                      <li key={l}>tutorial.json · {l}</li>
                    ))}
                  </ul>
                )}
                {lines.length > 1 && (
                  <pre className="agentfix-pre">
                    {lines.map((l, i) => (
                      <span key={i} data-kind={l.kind}>
                        {l.text || ' '}
                      </span>
                    ))}
                  </pre>
                )}
              </section>
            </>
          )}
        </main>

        <aside className="agentfix-side" aria-label="Agent summary">
          <span className="agentfix-h">Agent summary</span>
          {run ? (
            <>
              <div className="agentfix-summary">
                {run.summary ? (
                  <Markdown text={run.summary} />
                ) : run.status === 'running' ? (
                  'The agent is working on it…'
                ) : (
                  'No summary.'
                )}
              </div>
              <div className="agentfix-checks ui-mono">
                {run.checks.map((c, i) => (
                  <span key={i} data-ok={c.startsWith('✓') || undefined}>
                    {c}
                  </span>
                ))}
                {run.endedAt && (
                  <span className="agentfix-meta">
                    · ${run.costUsd.toFixed(2)} · {Math.round(run.durationMs / 1000)} s · {run.status}
                  </span>
                )}
              </div>
              <label htmlFor="follow" className="agentfix-h" style={{ fontSize: 13 }}>
                Follow-up
              </label>
              <TextArea
                id="follow"
                rows={3}
                placeholder="e.g. make it bounce once on arrival"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
              />
              <Button
                disabled={!followUp.trim() || !!busy || run.status === 'running'}
                onClick={() =>
                  void act('follow', async () => {
                    await client!.call('runs.followUp', { slug, n: run.n, text: followUp.trim() });
                    setFollowUp('');
                    setN(null);
                  })
                }
              >
                {busy === 'follow' ? 'Sending…' : 'Send follow-up'}
              </Button>
              <Button
                variant="primary"
                disabled={!!busy || run.status !== 'review'}
                onClick={() => void act('accept', () => client!.call('runs.accept', { slug, n: run.n }))}
              >
                Accept changes
              </Button>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  style={{ flex: 1 }}
                  disabled={!!busy || run.status === 'running' || run.status === 'reverted'}
                  onClick={() => void act('reopen', () => client!.call('runs.reopen', { slug, n: run.n }))}
                >
                  Reopen
                </Button>
                <Button
                  style={{ flex: 1 }}
                  variant="danger"
                  disabled={!!busy || !run.after || run.status === 'reverted'}
                  onClick={() => {
                    if (window.confirm(`Revert run #${run.n}? Its file and timeline changes are undone.`))
                      void act('revert', () => client!.call('runs.revert', { slug, n: run.n }));
                  }}
                >
                  Revert run
                </Button>
              </div>
              <LinkButton variant="ghost" href={`#/studio/${slug}`}>
                Back to the Studio
              </LinkButton>
            </>
          ) : (
            <span className="brief-muted">Pick a run.</span>
          )}
        </aside>
      </div>
    </AppFrame>
  );
}

/** The agent's summary: paragraphs, "- " bullets, **bold** and `code`; nothing else is interpreted. */
function Markdown({ text }: { text: string }) {
  const inline = (line: string) =>
    line
      .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
      .map((part, i) =>
        part.startsWith('**') ? (
          <b key={i}>{part.slice(2, -2)}</b>
        ) : part.startsWith('`') ? (
          <code key={i}>{part.slice(1, -1)}</code>
        ) : (
          part
        ),
      );
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*] /.test(line);
    if (!line.trim()) {
      blocks.push({ list: false, lines: [] });
      continue;
    }
    const last = blocks.at(-1);
    if (last && last.list === bullet && last.lines.length) last.lines.push(line.replace(/^\s*[-*] /, ''));
    else blocks.push({ list: bullet, lines: [line.replace(/^\s*[-*] /, '')] });
  }
  return (
    <>
      {blocks
        .filter((b) => b.lines.length)
        .map((b, i) =>
          b.list ? (
            <ul key={i}>
              {b.lines.map((l, j) => (
                <li key={j}>{inline(l)}</li>
              ))}
            </ul>
          ) : (
            <p key={i}>{inline(b.lines.join(' '))}</p>
          ),
        )}
    </>
  );
}
