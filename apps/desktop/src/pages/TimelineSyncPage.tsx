import { useEffect, useRef, useState } from 'react';
import { Button, Chip, MonoBox, Panel, Scrubber } from '@studio/ui';
import { currentWindowLabel, openStudioWindow } from '../engine';
import { Page } from '../shell';
import { useTimeline } from '../studio/useTimeline';

const SLUG = 'demo-http';
const fmt = (t: number) => `${t.toFixed(2)} s`;

export function TimelineSyncPage() {
  const tl = useTimeline(SLUG);
  const [label, setLabel] = useState('…');
  const [dragT, setDragT] = useState<number | null>(null);
  const drag = useRef<{ group: string; id: string } | null>(null);

  useEffect(() => {
    currentWindowLabel().then(setLabel, () => setLabel('browser'));
  }, []);

  // A pointer drag on the scrubber is one gesture: every move is a patch in the same group.
  useEffect(() => {
    const end = () => {
      drag.current = null;
      setDragT(null);
    };
    window.addEventListener('pointerup', end);
    return () => window.removeEventListener('pointerup', end);
  }, []);

  const overlays = tl.timeline?.overlays ?? [];
  const selected = overlays[0];
  const duration = tl.timeline?.takes.at(-1)?.duration ?? 60;

  function addCard() {
    const id = `card-${Date.now().toString(36)}`;
    void tl.patch(
      [
        {
          op: 'add',
          path: '/overlays/-',
          value: { id, component: 'core:TitleCard', start: 1, end: 4, props: { title: 'HTTP services' } },
        },
      ],
      { label: 'Add title card' },
    );
  }

  function move(start: number) {
    if (!selected) return;
    if (!drag.current || drag.current.id !== selected.id)
      drag.current = { id: selected.id, group: `drag-${selected.id}-${Date.now()}` };
    setDragT(start);
    const len = selected.end - selected.start;
    void tl.patch(
      [
        { op: 'replace', path: '/overlays/0/start', value: Math.round(start * 100) / 100 },
        { op: 'replace', path: '/overlays/0/end', value: Math.round((start + len) * 100) / 100 },
      ],
      { group: drag.current.group, label: 'Move overlay' },
    );
  }

  return (
    <Page
      title="Step 2.6 · Timeline sync and undo"
      intro="The engine owns tutorial.json. Every change is a validated patch that is saved and broadcast to every window. Open a second Studio window on this page, change things in one, and watch the other follow. A drag is one undo step, and an invalid patch is rejected without changing anything."
    >
      <Panel
        title={`projects/${SLUG}/tutorial.json`}
        action={
          <span style={{ display: 'flex', gap: 8 }}>
            <Chip mono>{`window ${label}`}</Chip>
            <Chip tone="info" mono>{`version ${tl.version}`}</Chip>
          </span>
        }
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <Button onClick={() => openStudioWindow('studio-2', '/timeline-sync')}>
            Open a second Studio window
          </Button>
          <Button variant="primary" onClick={addCard} disabled={!tl.timeline}>
            Add a title card
          </Button>
          <Button onClick={() => void tl.undo()} disabled={!tl.canUndo}>
            Undo
          </Button>
          <Button onClick={() => void tl.redo()} disabled={!tl.canRedo}>
            Redo
          </Button>
          <Button
            variant="danger"
            disabled={!selected}
            onClick={() =>
              void tl.patch([{ op: 'replace', path: '/overlays/0/end', value: -5 }], { label: 'Invalid' })
            }
          >
            Send an invalid patch
          </Button>
          <Button
            variant="ghost"
            disabled={!overlays.length}
            onClick={() =>
              void tl.patch([{ op: 'replace', path: '/overlays', value: [] }], { label: 'Clear overlays' })
            }
          >
            Remove all overlays
          </Button>
        </div>
        {tl.error && <Chip tone="error">{tl.error.slice(0, 200)}</Chip>}
      </Panel>

      <Panel title="Drag the first overlay (one gesture = one undo step)">
        {selected ? (
          <>
            <Scrubber
              value={dragT ?? selected.start}
              max={Math.max(1, duration - (selected.end - selected.start))}
              onChange={move}
              label="Overlay start"
              format={fmt}
              height={34}
            >
              <div
                style={{
                  position: 'relative',
                  height: 18,
                  borderRadius: 6,
                  background: 'var(--ui-gray-100)',
                }}
              >
                {overlays.map((o) => (
                  <span
                    key={o.id}
                    style={{
                      position: 'absolute',
                      top: 3,
                      height: 12,
                      borderRadius: 4,
                      background: o.id === selected.id ? 'var(--ui-orange)' : 'var(--ui-steel-300)',
                      left: `${(o.start / duration) * 100}%`,
                      width: `${((o.end - o.start) / duration) * 100}%`,
                    }}
                  />
                ))}
              </div>
            </Scrubber>
            <span className="ui-mono" style={{ fontSize: 12 }}>
              {selected.id} · {selected.component} · {selected.start.toFixed(2)}–{selected.end.toFixed(2)} s
            </span>
          </>
        ) : (
          <span style={{ color: 'var(--ui-gray-600)' }}>Add a title card first.</span>
        )}
      </Panel>

      <Panel title={`overlays (${overlays.length})`}>
        <MonoBox style={{ maxHeight: 300 }}>{JSON.stringify(overlays, null, 2)}</MonoBox>
      </Panel>
    </Page>
  );
}
