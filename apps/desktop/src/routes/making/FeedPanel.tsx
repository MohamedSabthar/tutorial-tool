import { useEffect, useRef, useState } from 'react';
import { Elapsed, Glyph, Inset, Shell, ShellHeader } from '@studio/ui';
import type { FeedRow, RunningRow } from './feedRows';

const MARK: Record<FeedRow['tone'], { icon: 'check' | 'warn' | 'x' | 'arrow'; label: string }> = {
  ok: { icon: 'check', label: 'Done' },
  warn: { icon: 'warn', label: 'Stopped' },
  fail: { icon: 'x', label: 'Didn’t work' },
  you: { icon: 'arrow', label: 'You' },
};

/** "What it did": plain lines, each opening its technical details, and the running line. */
export function Feed({ rows, running }: { rows: FeedRow[]; running: RunningRow | null }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  // The newest line stays in view as lines arrive.
  const list = useRef<HTMLDivElement>(null);
  const last = `${rows.at(-1)?.key ?? ''}:${running?.text ?? ''}`;
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last]);
  return (
    <Shell aria-label="What it did">
      <ShellHeader
        icon="spark"
        title="What it did"
        subtitle="Click a line for the technical details"
        aside={<span className="mk-count">{rows.length}</span>}
      />
      <div className="k-panel mk-feed" ref={list}>
        {rows.length === 0 && !running && <p className="mk-feed-empty">Nothing yet.</p>}
        <ol className="mk-feed-list">
          {rows.map((r) => (
            <li key={r.key}>
              <button
                type="button"
                className="mk-row"
                aria-expanded={!!open[r.key]}
                onClick={() => toggle(r.key)}
              >
                <span className="mk-row-mark" data-tone={r.tone}>
                  <Glyph name={MARK[r.tone].icon} size={12} />
                  <span className="ui-sr-only">{MARK[r.tone].label}:</span>
                </span>
                <span className="mk-row-text">{r.text}</span>
                {r.took && <span className="mk-row-took">{r.took}</span>}
                <span className="mk-row-chev" data-open={open[r.key] ? 'true' : undefined}>
                  <Glyph name="next" size={12} />
                </span>
              </button>
              {open[r.key] && (
                <Inset className="mk-row-details">
                  {r.details.map((d) => (
                    <div key={d.label}>
                      <span className="mk-row-dlabel">{d.label}:</span> {d.value}
                    </div>
                  ))}
                  {!!r.tools?.length && (
                    <div>
                      <span className="mk-row-dlabel">Tools:</span>
                      <ul>
                        {r.tools.map((t, i) => (
                          <li key={i}>
                            {t.name} · {t.summary}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {!r.details.length && !r.tools?.length && <div>No details.</div>}
                </Inset>
              )}
            </li>
          ))}
          {running && (
            <li aria-live="polite">
              <button
                type="button"
                className="mk-row"
                aria-expanded={!!open.run}
                onClick={() => toggle('run')}
              >
                <span className="mk-row-mark" data-tone="run">
                  <span className="k-spin" />
                  <span className="ui-sr-only">Working:</span>
                </span>
                <span className="mk-row-text">{running.text}…</span>
                <span className="mk-row-took">
                  {running.since ? <Elapsed since={running.since} /> : 'now'}
                </span>
                <span className="mk-row-chev" data-open={open.run ? 'true' : undefined}>
                  <Glyph name="next" size={12} />
                </span>
              </button>
              {open.run && (
                <Inset className="mk-row-details">
                  <div>
                    <span className="mk-row-dlabel">Stage:</span> {running.stage}
                  </div>
                  {running.said && (
                    <div>
                      <span className="mk-row-dlabel">Agent says:</span> {running.said}
                    </div>
                  )}
                  {running.items.length > 0 && (
                    <ul>
                      {running.items.map((it) => (
                        <li key={it.id}>
                          {it.state === 'done'
                            ? '✓'
                            : it.state === 'active'
                              ? '•'
                              : it.state === 'failed'
                                ? '✗'
                                : '○'}{' '}
                          {it.label}
                          {it.detail ? ` · ${it.detail}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                  {running.tools.length > 0 && (
                    <div>
                      <span className="mk-row-dlabel">Latest tools:</span>
                      <ul>
                        {running.tools.map((t, i) => (
                          <li key={i}>
                            {t.name} · {t.summary}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Inset>
              )}
            </li>
          )}
        </ol>
      </div>
    </Shell>
  );
}
