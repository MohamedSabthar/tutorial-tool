import { useCallback, useEffect, useState } from 'react';
import type { RpcResult } from '@studio/core';
import type { OverlayModule } from '@studio/overlay-sdk';
import { Button, Chip, Panel, Segmented } from '@studio/ui';
import { useEngine } from '../engine';

export const OVERLAY_DRAG_TYPE = 'application/x-studio-overlay';

/** Small icon-like previews for the built-ins; custom components get a generic tile. */
const glyphs: Record<string, React.CSSProperties> = {
  'core:Callout': { width: '62%', height: '44%', background: '#FFFFFF', borderRadius: 4 },
  'core:Zoom': { width: '44%', height: '50%', border: '2px solid #A9C6DD', borderRadius: 4 },
  'core:Arrow': { width: '50%', height: 4, background: '#FF5800', borderRadius: 2 },
  'core:ClickRipple': { width: 22, height: 22, border: '3px solid #FF5800', borderRadius: '50%' },
  'core:TitleCard': { width: '70%', height: '30%', background: '#2B3E5E', borderLeft: '4px solid #FF5800' },
  'core:Highlight': { width: 24, height: 24, borderRadius: 6, boxShadow: '0 0 0 40px rgba(0,0,0,0.55)' },
  'core:Box': { width: '50%', height: '42%', border: '3px solid #FF5800', borderRadius: 6 },
  'core:Blur': {
    width: '56%',
    height: '34%',
    background: 'rgba(255,255,255,0.4)',
    filter: 'blur(3px)',
    borderRadius: 4,
  },
  'core:Cursor': {
    width: 0,
    height: 0,
    borderLeft: '9px solid transparent',
    borderRight: '9px solid transparent',
    borderBottom: '16px solid #FFFFFF',
    transform: 'rotate(-30deg)',
  },
  'core:Keystroke': {
    width: 26,
    height: 22,
    background: '#FFFFFF',
    borderRadius: 5,
    borderBottom: '4px solid #D7D7D7',
  },
  'core:Captions': {
    width: '70%',
    height: 10,
    background: 'rgba(255,255,255,0.8)',
    borderRadius: 3,
    marginTop: 24,
  },
  'core:TextLabel': { width: '40%', height: 14, background: '#FF5800', borderRadius: 4 },
  'core:ConceptCards': {
    width: '66%',
    height: '46%',
    background: 'repeating-linear-gradient(90deg, #FFFFFF 0 28%, transparent 28% 36%)',
    opacity: 0.85,
  },
  'core:BlueprintFlow': {
    width: '72%',
    height: '40%',
    border: '1.5px solid #A9C6DD',
    borderRadius: 4,
    background:
      'radial-gradient(circle at 70% 50%, #FF5800 0 4px, transparent 5px), repeating-linear-gradient(90deg, rgba(169,198,221,0.35) 0 1px, transparent 1px 10px)',
  },
  'core:LayeredPanels': {
    width: '46%',
    height: '36%',
    background: '#2B3E5E',
    border: '1.5px solid #FF5800',
    borderRadius: 5,
    boxShadow: '8px 8px 0 -1px #A9C6DD, 16px 16px 0 -2px rgba(169,198,221,0.5)',
  },
  'core:CodeTrace': {
    width: '64%',
    height: '50%',
    background:
      'linear-gradient(90deg, transparent 0 62%, #FF5800 62% 64%, transparent 64%), repeating-linear-gradient(180deg, #A9C6DD 0 3px, transparent 3px 8px)',
    borderLeft: '3px solid #FF5800',
  },
  'core:ArchitectureZoom': {
    width: '30%',
    height: '46%',
    border: '2px solid #FF5800',
    borderRadius: 4,
    boxShadow: '-26px 0 0 -6px #A9C6DD, 26px 0 0 -6px #A9C6DD',
  },
};

/**
 * The overlay library: core, workspace and project components. Drag a tile onto the
 * timeline's Overlays lane (or click Add) to create an instance.
 */
export function Library({
  slug,
  registry,
  onAdd,
  onInsertScene,
}: {
  slug: string;
  registry: Record<string, OverlayModule>;
  onAdd: (id: string) => void;
  /** Explainers tab: insert the scene at the playhead. */
  onInsertScene?: (id: string) => void;
}) {
  const [tab, setTab] = useState<'Overlays' | 'Explainers'>('Overlays');
  const { client, info, state } = useEngine();
  const [index, setIndex] = useState<RpcResult<'library.index'>>([]);
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'error' | 'info' } | null>(null);
  const loadIndex = useCallback(async () => {
    if (client) setIndex(await client.call('library.index', {}).catch(() => []));
  }, [client]);
  useEffect(() => {
    if (!client || state !== 'open') return;
    void Promise.resolve().then(loadIndex);
    return client.on('workspace.changed', () => void loadIndex());
  }, [client, state, loadIndex]);
  const thumb = (id: string) => {
    const e = index.find((x) => x.id === id);
    return e?.thumbnail && info
      ? `http://127.0.0.1:${info.port}/library/thumb/${id.split(':')[1]}?token=${encodeURIComponent(info.token)}&kind=${e.kind}&v=${encodeURIComponent(e.promotedAt)}`
      : null;
  };
  const promote = async (id: string) => {
    if (!client) return;
    const name = registry[id]?.meta?.name ?? id;
    if (!window.confirm(`Move ${name} into the shared library so every tutorial can use it?`)) return;
    setNote({ text: `Checking and promoting ${name}…`, tone: 'info' });
    try {
      await client.call('library.promote', { slug, id });
      setNote({ text: `${name} is in the library`, tone: 'ok' });
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), tone: 'error' });
    }
  };
  const entries = Object.entries(registry).filter(
    ([, m]) => (m.meta?.kind ?? 'overlay') === (tab === 'Overlays' ? 'overlay' : 'scene'),
  );
  return (
    <Panel title="Library">
      <Segmented
        label="Library type"
        options={['Overlays', 'Explainers'] as const}
        value={tab}
        onChange={setTab}
        block
      />
      {entries.length === 0 && (
        <span style={{ color: 'var(--ui-gray-600)', fontSize: 12 }}>No explainer scenes yet.</span>
      )}
      {note && <Chip tone={note.tone}>{note.text}</Chip>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        {entries.map(([id, m]) => (
          <div key={id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(OVERLAY_DRAG_TYPE, id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => (tab === 'Explainers' && onInsertScene ? onInsertScene(id) : onAdd(id))}
              title={
                tab === 'Explainers'
                  ? `${m.meta?.description ?? id} (click to insert at the playhead)`
                  : `${m.meta?.description ?? id} (drag onto the timeline, or click to add at the playhead)`
              }
              style={{
                background: 'var(--ui-white)',
                border: '1px solid var(--ui-gray-300)',
                borderRadius: 10,
                overflow: 'hidden',
                padding: 0,
                cursor: 'grab',
                textAlign: 'left',
              }}
            >
              <span
                style={{
                  height: 50,
                  background: 'var(--ui-navy)',
                  display: 'grid',
                  placeItems: 'center',
                  overflow: 'hidden',
                }}
              >
                {thumb(id) ? (
                  <img
                    src={thumb(id)!}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <span
                    style={
                      glyphs[id] ?? {
                        width: '50%',
                        height: '40%',
                        border: '2px dashed #A9C6DD',
                        borderRadius: 6,
                      }
                    }
                  />
                )}
              </span>
              <span
                style={{
                  display: 'block',
                  padding: '6px 8px',
                  fontSize: 11,
                  color: 'var(--ui-navy)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {m.meta?.name ?? id}
                {!id.startsWith('core:') && (
                  <span style={{ color: 'var(--ui-gray-600)' }}> · {id.split(':')[0]}</span>
                )}
              </span>
            </button>
            {id.startsWith('project:') && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void promote(id)}
                title="Move into the shared library"
              >
                Promote
              </Button>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}
