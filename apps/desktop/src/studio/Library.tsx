import { useState } from 'react';
import type { OverlayModule } from '@studio/overlay-sdk';
import { Panel, Segmented } from '@studio/ui';

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
};

/**
 * The overlay library: core, workspace and project components. Drag a tile onto the
 * timeline's Overlays lane (or click Add) to create an instance.
 */
export function Library({
  registry,
  onAdd,
}: {
  registry: Record<string, OverlayModule>;
  onAdd: (id: string) => void;
}) {
  const [tab, setTab] = useState<'Overlays' | 'Explainers'>('Overlays');
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
        <span style={{ color: 'var(--ui-gray-600)', fontSize: 12 }}>No explainer scenes yet (Phase 6).</span>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        {entries.map(([id, m]) => (
          <button
            key={id}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(OVERLAY_DRAG_TYPE, id);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => onAdd(id)}
            title={`${m.meta?.description ?? id} (drag onto the timeline, or click to add at the playhead)`}
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
              <span
                style={
                  glyphs[id] ?? { width: '50%', height: '40%', border: '2px dashed #A9C6DD', borderRadius: 6 }
                }
              />
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
        ))}
      </div>
    </Panel>
  );
}
