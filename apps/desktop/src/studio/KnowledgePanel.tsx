import { useEffect, useState } from 'react';
import type { RpcResult } from '@studio/core';
import { Chip, Panel } from '@studio/ui';
import { useEngine } from '../engine';
import { DiffView } from './DiffView';

type Commit = RpcResult<'workspace.log'>[number];

const KNOWLEDGE = /^(skills|lessons)[(:]/;

/** What the agent has learned: skill fixes and retrospective lessons, newest first, with their diffs. */
export function KnowledgePanel() {
  const { client, state } = useEngine();
  const [commits, setCommits] = useState<Commit[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [diff, setDiff] = useState<string>('');

  useEffect(() => {
    if (!client || state !== 'open') return;
    const load = async () => {
      const log = await client.call('workspace.log', { limit: 100 }).catch(() => []);
      setCommits(log.filter((c) => KNOWLEDGE.test(c.subject)).slice(0, 15));
    };
    void Promise.resolve().then(load);
    return client.on('workspace.changed', () => void load());
  }, [client, state]);

  async function toggle(hash: string) {
    if (open === hash) return setOpen(null);
    setOpen(hash);
    setDiff('');
    const r = await client?.call('workspace.show', { hash }).catch(() => null);
    setDiff(r?.diff ?? 'Could not load this commit.');
  }

  return (
    <Panel title="Knowledge" action={<Chip mono>{commits.length}</Chip>}>
      {commits.length === 0 && (
        <span style={{ color: 'var(--ui-gray-600)', fontSize: 12 }}>
          Skill fixes and lessons the agent commits appear here.
        </span>
      )}
      <ul
        style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}
      >
        {commits.map((c) => (
          <li key={c.hash} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              type="button"
              aria-expanded={open === c.hash}
              onClick={() => void toggle(c.hash)}
              style={{
                textAlign: 'left',
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              <span style={{ fontSize: 12, color: 'var(--ui-navy)', lineHeight: 1.4 }}>{c.subject}</span>
              <span className="ui-mono" style={{ fontSize: 10, color: 'var(--ui-gray-600)' }}>
                {c.hash} · {new Date(c.date).toLocaleString()}
              </span>
            </button>
            {open === c.hash && (diff ? <DiffView diff={diff} maxHeight={260} /> : <span>Loading…</span>)}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
