import { useMemo, useState } from 'react';
import {
  applyPatch,
  buildTimeMap,
  invertPatch,
  sampleTimeline,
  type Timeline,
  type TimelinePatch,
} from '@studio/core';
import { Page } from '../shell';

interface HistoryEntry {
  label: string;
  patch: TimelinePatch;
  inverse: TimelinePatch;
}

const presets: { label: string; patch: TimelinePatch }[] = [
  { label: 'Lengthen title card by 1 s', patch: [{ op: 'replace', path: '/overlays/0/end', value: 4 }] },
  {
    label: 'Add a 3 s hold in scene 1',
    patch: [{ op: 'add', path: '/scenes/0/segments/1', value: { kind: 'hold', at: 10, duration: 3 } }],
  },
  {
    label: 'Explainer length 10 s → 16 s',
    patch: [{ op: 'replace', path: '/scenes/1/duration', value: 16 }],
  },
  {
    label: 'Speed up scene 3 to 4×',
    patch: [{ op: 'replace', path: '/scenes/2/segments/1/rate', value: 4 }],
  },
  { label: 'Remove first transition', patch: [{ op: 'remove', path: '/transitions/0' }] },
  {
    label: 'Add an overlay',
    patch: [
      {
        op: 'add',
        path: '/overlays/-',
        value: { id: 'ov-new', component: 'core:Arrow', start: 12, end: 15 },
      },
    ],
  },
  { label: 'Invalid: end before start', patch: [{ op: 'replace', path: '/overlays/0/end', value: -1 }] },
  { label: 'Invalid: unknown path', patch: [{ op: 'replace', path: '/overlays/9/end', value: 1 }] },
];

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

export function TimelinePlayground() {
  const [timeline, setTimeline] = useState<Timeline>(sampleTimeline);
  const [undo, setUndo] = useState<HistoryEntry[]>([]);
  const [redo, setRedo] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<string | null>(null);
  const [custom, setCustom] = useState(
    '[\n  { "op": "replace", "path": "/overlays/1/start", "value": 38 }\n]',
  );
  const [t, setT] = useState(31.5);

  const tm = useMemo(() => buildTimeMap(timeline), [timeline]);
  const active = tm.activeAt(t);

  function apply(label: string, patch: TimelinePatch) {
    try {
      const next = applyPatch(timeline, patch);
      setUndo((u) => [...u, { label, patch, inverse: invertPatch(timeline, patch) }]);
      setRedo([]);
      setTimeline(next);
      setError(null);
      setLastOk(`Applied: ${label}`);
    } catch (e) {
      setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      setLastOk(null);
    }
  }

  function doUndo() {
    const entry = undo[undo.length - 1];
    if (!entry) return;
    setTimeline((tl) => applyPatch(tl, entry.inverse));
    setUndo((u) => u.slice(0, -1));
    setRedo((r) => [...r, entry]);
    setLastOk(`Undid: ${entry.label}`);
    setError(null);
  }

  function doRedo() {
    const entry = redo[redo.length - 1];
    if (!entry) return;
    setTimeline((tl) => applyPatch(tl, entry.patch));
    setRedo((r) => r.slice(0, -1));
    setUndo((u) => [...u, entry]);
    setLastOk(`Redid: ${entry.label}`);
    setError(null);
  }

  function applyCustom() {
    try {
      apply('Custom patch', JSON.parse(custom) as TimelinePatch);
    } catch (e) {
      if (e instanceof SyntaxError) setError(`JSON: ${e.message}`);
    }
  }

  const pct = (s: number) => `${(s / tm.duration) * 100}%`;

  return (
    <Page
      title="Step 0.2 · Timeline core"
      intro="The sample tutorial below has two recorded scenes from one take, an explainer between them, and transitions on both sides. Apply patches, undo and redo them, and scrub to see how output time maps to scene and take time."
    >
      <section className="panel panel-pad" aria-label="Time map">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 className="panel-title">Time map</h2>
          <span className="mono" style={{ color: 'var(--gray-600)' }}>
            total {fmt(tm.duration)}
          </span>
        </div>

        <div style={{ position: 'relative', height: 104, marginBottom: 8 }}>
          {tm.scenes.map((s, i) => (
            <div
              key={s.sceneId}
              title={`${s.sceneId}: ${fmt(s.start)} – ${fmt(s.end)}`}
              style={{
                position: 'absolute',
                top: i % 2 ? 26 : 0,
                height: 24,
                left: pct(s.start),
                width: pct(s.end - s.start),
                borderRadius: 6,
                boxSizing: 'border-box',
                padding: '4px 8px',
                fontSize: 11,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                background: s.kind === 'explainer' ? 'var(--orange-100)' : '#E4EAF2',
                border: `1px solid ${s.kind === 'explainer' ? 'var(--orange)' : '#B9C6D6'}`,
                color: s.kind === 'explainer' ? 'var(--orange-ink)' : 'var(--navy)',
                fontWeight: s.kind === 'explainer' ? 600 : 400,
              }}
            >
              {s.sceneId} · {s.kind}
            </div>
          ))}
          {tm.segments.map((g) => (
            <div
              key={`${g.sceneId}-${g.index}`}
              title={`${g.segment.kind} ${fmt(g.start)} – ${fmt(g.end)}`}
              style={{
                position: 'absolute',
                top: 56,
                height: 18,
                left: pct(g.start),
                width: pct(g.end - g.start),
                boxSizing: 'border-box',
                borderRadius: 4,
                fontSize: 10,
                padding: '2px 4px',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                background:
                  g.segment.kind === 'src'
                    ? 'var(--white)'
                    : g.segment.kind === 'hold'
                      ? '#FFF4E5'
                      : 'var(--steel-100)',
                border: '1px solid var(--gray-300)',
              }}
            >
              {g.segment.kind}
              {g.segment.kind === 'speed' ? ` ${g.segment.rate}×` : ''}
            </div>
          ))}
          {timeline.overlays.map((o) => (
            <div
              key={o.id}
              title={`${o.id}: ${o.component}`}
              style={{
                position: 'absolute',
                top: 80,
                height: 18,
                left: pct(o.start),
                width: pct(o.end - o.start),
                boxSizing: 'border-box',
                borderRadius: 4,
                fontSize: 10,
                padding: '2px 4px',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                background: 'var(--steel-100)',
                border: '1px solid var(--steel)',
                color: 'var(--steel-ink)',
              }}
            >
              {o.component}
            </div>
          ))}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: -4,
              bottom: -4,
              left: pct(t),
              width: 2,
              background: 'var(--navy)',
            }}
          />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="mono" style={{ width: 80 }}>
            {fmt(t)}
          </span>
          <input
            type="range"
            min={0}
            max={tm.duration}
            step={0.05}
            value={Math.min(t, tm.duration)}
            onChange={(e) => setT(Number(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--orange)' }}
            aria-label="Output time"
          />
        </label>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 10,
            marginTop: 14,
          }}
        >
          {active.map((a) => (
            <div
              key={a.position.sceneId}
              style={{ background: 'var(--gray-50)', borderRadius: 10, padding: 12 }}
            >
              <div style={{ fontWeight: 600, color: 'var(--navy)', marginBottom: 6 }}>
                {a.position.sceneId} · {a.position.kind}
                {a.transitionId && (
                  <span className="chip" style={{ marginLeft: 8 }}>
                    {a.transitionId} · weight {a.weight.toFixed(2)}
                  </span>
                )}
              </div>
              <div className="mono" style={{ fontSize: 12, lineHeight: 1.7 }}>
                scene time {fmt(a.position.local)}
                {a.position.kind === 'recording' && (
                  <>
                    <br />
                    {a.position.take} @ {fmt(a.position.takeTime)} (segment {a.position.segment})
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
        <section className="panel panel-pad" style={{ flex: '1 1 420px' }} aria-label="Patches">
          <h2 className="panel-title">Patches</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {presets.map((p) => (
              <button key={p.label} type="button" className="btn" onClick={() => apply(p.label, p.patch)}>
                {p.label}
              </button>
            ))}
          </div>
          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              marginTop: 16,
              fontWeight: 600,
              color: 'var(--navy)',
            }}
          >
            Custom JSON patch
            <textarea
              className="field mono"
              rows={5}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              style={{ fontWeight: 400, fontSize: 12 }}
            />
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" className="btn btn-primary" onClick={applyCustom}>
              Apply patch
            </button>
            <button type="button" className="btn" onClick={doUndo} disabled={!undo.length}>
              Undo ({undo.length})
            </button>
            <button type="button" className="btn" onClick={doRedo} disabled={!redo.length}>
              Redo ({redo.length})
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setTimeline(sampleTimeline());
                setUndo([]);
                setRedo([]);
                setError(null);
                setLastOk('Reset to the sample timeline');
              }}
            >
              Reset
            </button>
          </div>
          <div role="status" style={{ marginTop: 12 }}>
            {error && (
              <pre
                className="mono"
                style={{
                  margin: 0,
                  padding: 10,
                  borderRadius: 9,
                  background: 'var(--red-bg)',
                  color: 'var(--red)',
                  whiteSpace: 'pre-wrap',
                  fontSize: 12,
                }}
              >
                {error}
              </pre>
            )}
            {lastOk && <span className="chip chip-ok">{lastOk}</span>}
          </div>
        </section>

        <section
          className="panel panel-pad"
          style={{ flex: '1 1 420px', minWidth: 0 }}
          aria-label="Timeline JSON"
        >
          <h2 className="panel-title">tutorial.json</h2>
          <pre
            className="mono"
            style={{
              margin: 0,
              maxHeight: 420,
              overflow: 'auto',
              fontSize: 11,
              lineHeight: 1.5,
              background: 'var(--gray-50)',
              padding: 12,
              borderRadius: 9,
            }}
          >
            {JSON.stringify(timeline, null, 2)}
          </pre>
        </section>
      </div>
    </Page>
  );
}
