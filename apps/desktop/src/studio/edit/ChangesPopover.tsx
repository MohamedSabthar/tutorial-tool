import type { Run } from '@studio/core';
import { Button, Glyph } from '@studio/ui';
import type { HistoryItem } from './backend';

const ago = (at: number) => {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const RUN_STATE: Partial<Record<Run['status'], string>> = {
  review: 'to review',
  accepted: 'kept',
  reverted: 'undone',
  running: 'working',
  reopened: 'reopened',
};

/**
 * Everything you or the agent changed, newest first: the timeline's undo history and the
 * agent's runs. Undo reverts the latest timeline change.
 */
export function ChangesList({
  history,
  runs,
  onUndo,
  onOpenRun,
}: {
  history: HistoryItem[];
  runs: Run[];
  onUndo: () => void;
  onOpenRun: (run: Run) => void;
}) {
  type Row = { key: string; at: number; who: 'you' | 'agent'; label: string; latest?: boolean; run?: Run };
  const rows: Row[] = [
    ...history.map((h, i) => ({
      key: `h${i}`,
      at: h.at,
      who: h.author === 'agent' ? ('agent' as const) : ('you' as const),
      label: h.author === 'auto' ? `${h.label} (automatic)` : h.label,
      latest: i === history.length - 1,
    })),
    ...runs
      .filter((r) => r.status !== 'empty')
      .map((r) => ({
        key: `r${r.n}`,
        at: r.endedAt ?? r.startedAt,
        who: 'agent' as const,
        label: (r.summary.split('\n').find((l) => l.trim()) ?? r.prompt).replace(/^#+\s*/, '').slice(0, 90),
        run: r,
      })),
  ].sort((a, b) => b.at - a.at);
  if (!rows.length)
    return (
      <p className="ed-muted ed-s13 ed-hist-empty">
        No changes yet. Everything you or the agent changes shows here, and you can undo it.
      </p>
    );
  return (
    <ul className="ed-hist" aria-label="Changes">
      {rows.map((r) => (
        <li key={r.key} className="ed-hrow">
          <span className="ed-who" data-who={r.who} title={r.who === 'agent' ? 'The agent' : 'You'}>
            {r.who === 'agent' ? <Glyph name="spark" size={11} /> : 'You'}
            <span className="ed-sr">{r.who === 'agent' ? 'Agent:' : 'You:'}</span>
          </span>
          <span className="ed-grow ed-hlabel">
            {r.label}
            {r.run && RUN_STATE[r.run.status] && <small className="ed-muted"> · {RUN_STATE[r.run.status]}</small>}
          </span>
          <span className="ed-s12 ed-muted ed-tab">{ago(r.at)}</span>
          {r.latest && (
            <Button size="sm" variant="quiet" onClick={onUndo}>
              Undo
            </Button>
          )}
          {r.run && (
            <Button size="sm" variant="quiet" onClick={() => onOpenRun(r.run!)}>
              Review
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
