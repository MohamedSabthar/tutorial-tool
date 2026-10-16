import { useEffect, useMemo, useState } from 'react';
import type { Segment, TimelinePatch } from '@studio/core';
import { coreOverlays, resolveProps } from '@studio/overlays-core';
import { usePlayer } from '@studio/stage';
import {
  AppHeader,
  Button,
  Chip,
  EdgeAccent,
  GateBanner,
  IconButton,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  LinkButton,
  MonoBox,
  Panel,
  Pill,
  Segmented,
  Select,
} from '@studio/ui';
import { EngineChip, useEngine } from '../engine';
import { useLatestTake } from '../useTake';
import { resolveTimeline, stepAt } from './resolve';
import { StageHost } from './StageHost';
import { TimelinePanel } from './TimelinePanel';
import { useOverlayRegistry } from './useOverlayRegistry';
import { useTimeline } from './useTimeline';

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const ANCHORED = new Set([
  'core:Zoom',
  'core:Highlight',
  'core:Box',
  'core:Arrow',
  'core:Callout',
  'core:Blur',
]);
type View = 'Final' | 'With annotations' | 'Raw take';

/** The Studio window: preview, transport and the multi-lane timeline for one project. */
export function StudioScreen({ slug }: { slug: string }) {
  const { client } = useEngine();
  const tl = useTimeline(slug);
  const { take, events, media } = useLatestTake(slug);
  const { registry, reportError } = useOverlayRegistry(slug);
  const resolved = useMemo(
    () => (tl.timeline ? resolveTimeline(tl.timeline, events) : null),
    [tl.timeline, events],
  );
  const duration = resolved?.tm.duration ?? 1;
  const [player, controls] = usePlayer(duration);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>('Final');
  const [adding, setAdding] = useState('core:Callout');

  const t = player.t;
  const steps = resolved?.steps ?? [];
  const current = stepAt(steps, t);

  function seekStep(dir: -1 | 1) {
    const i = current ? steps.indexOf(current) : -1;
    const target = steps[Math.min(Math.max(i + dir, 0), steps.length - 1)];
    if (target) controls.seek(target.start);
  }

  function split() {
    if (!tl.timeline || !resolved) return;
    const pos = resolved.tm.toSource(t);
    if (!pos || pos.kind !== 'recording') return;
    const si = tl.timeline.scenes.findIndex((s) => s.id === pos.sceneId);
    const scene = tl.timeline.scenes[si];
    if (!scene || scene.kind !== 'recording') return;
    const seg = scene.segments[pos.segment];
    if (!seg || seg.kind === 'hold') return;
    const cut = pos.takeTime;
    if (cut - seg.from < 0.1 || seg.to - cut < 0.1) return;
    const parts: Segment[] = [
      { ...seg, to: cut },
      { ...seg, from: cut },
    ];
    const segments = [
      ...scene.segments.slice(0, pos.segment),
      ...parts,
      ...scene.segments.slice(pos.segment + 1),
    ];
    void tl.patch([{ op: 'replace', path: `/scenes/${si}/segments`, value: segments }], { label: 'Split' });
  }

  function addOverlay() {
    if (!tl.timeline) return;
    const meta = registry[adding]?.meta;
    const len = meta?.defaultDuration ?? 3;
    const anchored = ANCHORED.has(adding);
    const step = current && tl.timeline.steps.find((s) => s.id === current.id && s.bbox);
    const id = `${adding.split(':')[1]!.toLowerCase()}-${Date.now().toString(36)}`;
    const start = Math.round(t * 100) / 100;
    const value = {
      id,
      component: adding,
      start,
      end: Math.min(start + len, duration),
      props: adding.startsWith('core:') ? resolveProps(adding, {}) : {},
      ...(anchored && step ? { anchor: { stepId: step.id, target: 'primary' } } : {}),
    };
    void tl.patch([{ op: 'add', path: '/overlays/-', value }], { label: `Add ${meta?.name ?? adding}` });
    setSelected(id);
  }

  // Keyboard shortcuts (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void (e.shiftKey ? tl.redo() : tl.undo());
      } else if (e.key === ' ') {
        e.preventDefault();
        controls.toggle();
      } else if (e.key === 'j') controls.seek(controls.get().t - 1);
      else if (e.key === 'k') controls.pause();
      else if (e.key === 'l') controls.seek(controls.get().t + 1);
      else if (e.key === 'ArrowLeft') controls.seek(controls.get().t - 1 / 30);
      else if (e.key === 'ArrowRight') controls.seek(controls.get().t + 1 / 30);
      else if (e.key === 's') split();
      else if ((e.key === 'Backspace' || e.key === 'Delete') && selected && tl.timeline) {
        const i = tl.timeline.overlays.findIndex((o) => o.id === selected);
        if (i >= 0)
          void tl.patch([{ op: 'remove', path: `/overlays/${i}` }] as TimelinePatch, {
            label: 'Delete overlay',
          });
        setSelected(null);
      } else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const selectedOverlay = tl.timeline?.overlays.find((o) => o.id === selected) ?? null;
  const src = take ? media(take.video) : null;
  const needsRebuild = tl.timeline && tl.timeline.takes.length > 0 && tl.timeline.scenes.length === 0;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        background: 'var(--ui-gray-50)',
      }}
    >
      <EdgeAccent />
      <AppHeader
        current="studio"
        hrefs={{
          projects: '#/reference',
          studio: `#/studio/${slug}`,
          library: '#/gallery',
          settings: '#/workspace',
        }}
        center={
          <Pill
            items={[
              <strong key="t">{slug}</strong>,
              take ? `${take.id} · ${take.width}×${take.height}` : 'no take',
              `v${tl.version}`,
              tl.error ? (
                <span key="e" style={{ color: 'var(--ui-red-ink)' }}>
                  error
                </span>
              ) : (
                <span key="s" style={{ color: 'var(--ui-green-ink)' }}>
                  Saved
                </span>
              ),
            ]}
          />
        }
        actions={
          <>
            <EngineChip />
            <LinkButton href="#/reference">Re-record</LinkButton>
            <Button variant="primary" disabled title="Export arrives in Phase 7">
              Export
            </Button>
          </>
        }
      />
      {needsRebuild && (
        <GateBanner
          title="This project's take has no scenes or steps yet"
          text="It was recorded before the Studio existed. Build them from the latest take's events (overlays are kept)."
          actions={
            <Button
              variant="primary"
              onClick={() =>
                client && client.call('timeline.rebuildFromTake', { slug }).then(() => undefined)
              }
            >
              Build from take
            </Button>
          }
        />
      )}
      {tl.error && (
        <div style={{ padding: '6px 22px' }}>
          <Chip tone="error">{tl.error.slice(0, 220)}</Chip>
        </div>
      )}

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          padding: '12px 12px 12px 18px',
          alignItems: 'flex-start',
        }}
      >
        <aside
          style={{
            flex: '1 1 260px',
            maxWidth: 300,
            minWidth: 240,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <Panel title="Steps">
            <ol
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              {steps.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => controls.seek(s.start)}
                    className="ui-btn ui-btn-ghost"
                    style={{
                      width: '100%',
                      justifyContent: 'flex-start',
                      height: 'auto',
                      padding: '8px 10px',
                      background: current?.id === s.id ? 'var(--ui-orange-100)' : undefined,
                      color: current?.id === s.id ? 'var(--ui-orange-ink)' : 'var(--ui-ink)',
                    }}
                  >
                    <span className="ui-mono" style={{ fontSize: 11, width: 46, textAlign: 'left' }}>
                      {fmt(s.start).replace(/\.\d\d$/, '')}
                    </span>
                    <span
                      style={{
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {i + 1} · {s.title}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </Panel>
          <Panel title="Add overlay">
            <Select aria-label="Overlay type" value={adding} onChange={(e) => setAdding(e.target.value)}>
              {Object.keys(registry).map((id) => (
                <option key={id} value={id}>
                  {registry[id]!.meta?.name ?? id} {id.startsWith('core:') ? '' : `(${id.split(':')[0]})`}
                </option>
              ))}
            </Select>
            <Button variant="primary" onClick={addOverlay} disabled={!tl.timeline}>
              Add at playhead
            </Button>
            <span style={{ fontSize: 11, color: 'var(--ui-gray-600)' }}>
              Anchored types attach to the current step’s target.
            </span>
          </Panel>
          <Panel title="Agent">
            <span style={{ color: 'var(--ui-gray-600)' }}>
              The agent panel arrives in step 3.1; annotations in step 5.1.
            </span>
          </Panel>
        </aside>

        <main style={{ flex: '999 1 560px', minWidth: 0 }}>
          <Panel>
            {take && src && resolved ? (
              <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--ui-gray-300)' }}>
                <StageHost
                  take={take}
                  src={src}
                  events={events}
                  instances={resolved.instances}
                  t={t}
                  playing={player.playing}
                  sourceTime={resolved.sourceTime}
                  videoPlaying={player.playing && resolved.videoRuns(t)}
                  showOverlays={view !== 'Raw take'}
                  registry={registry}
                  onOverlayError={reportError}
                />
              </div>
            ) : (
              <div
                style={{
                  aspectRatio: '16 / 9',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'var(--ui-gray-600)',
                }}
              >
                {tl.timeline ? 'Record a take on page 1.5 first.' : 'Loading…'}
              </div>
            )}
            {/* progress with step ticks */}
            <div
              style={{ position: 'relative', height: 4, borderRadius: 2, background: 'var(--ui-gray-100)' }}
            >
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${(t / duration) * 100}%`,
                  background: 'var(--ui-orange)',
                  borderRadius: 2,
                }}
              />
              {steps.map((s) => (
                <span
                  key={s.id}
                  style={{
                    position: 'absolute',
                    top: -3,
                    width: 2,
                    height: 10,
                    left: `${(s.start / duration) * 100}%`,
                    background: 'var(--ui-navy)',
                  }}
                />
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <IconButton label="Previous step" onClick={() => seekStep(-1)}>
                <IconPrev size={14} />
              </IconButton>
              <IconButton
                label={player.playing ? 'Pause' : 'Play'}
                variant="primary"
                onClick={() => controls.toggle()}
              >
                {player.playing ? <IconPause size={14} /> : <IconPlay size={14} />}
              </IconButton>
              <IconButton label="Next step" onClick={() => seekStep(1)}>
                <IconNext size={14} />
              </IconButton>
              <span className="ui-mono" style={{ color: 'var(--ui-navy)' }}>
                {fmt(t)} <span style={{ color: 'var(--ui-gray-600)' }}>/ {fmt(duration)}</span>
              </span>
              <span style={{ flex: 1 }} />
              <Segmented
                label="View"
                options={['Final', 'With annotations', 'Raw take'] as const}
                value={view}
                onChange={setView}
              />
            </div>
          </Panel>
        </main>

        <aside style={{ flex: '1 1 250px', maxWidth: 300, minWidth: 240 }}>
          <Panel title="Inspector" action={selectedOverlay && <Chip mono>{selectedOverlay.id}</Chip>}>
            {selectedOverlay ? (
              <MonoBox style={{ maxHeight: 360 }}>{JSON.stringify(selectedOverlay, null, 2)}</MonoBox>
            ) : (
              <span style={{ color: 'var(--ui-gray-600)' }}>
                Select an overlay on the timeline. The editable inspector arrives in step 2.8.
              </span>
            )}
            <span style={{ fontSize: 11, color: 'var(--ui-gray-600)' }}>
              {Object.keys(coreOverlays).length} core overlays ·{' '}
              {Object.keys(registry).length - Object.keys(coreOverlays).length} workspace/project
            </span>
          </Panel>
        </aside>
      </div>

      {tl.timeline && resolved && (
        <TimelinePanel
          timeline={tl.timeline}
          resolved={resolved}
          t={t}
          onSeek={(x) => controls.seek(x)}
          selected={selected}
          onSelect={setSelected}
          patch={tl.patch}
          onSplit={split}
          canUndo={tl.canUndo}
          canRedo={tl.canRedo}
          onUndo={() => void tl.undo()}
          onRedo={() => void tl.redo()}
        />
      )}
    </div>
  );
}
