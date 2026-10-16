import { useMemo, useState } from 'react';
import type { RecorderEvent } from '@studio/core';
import { coreOverlays, resolveProps } from '@studio/overlays-core';
import { fitSource, sourceToStage, usePlayer } from '@studio/stage';
import { Chip, IconButton, IconPause, IconPlay, IconPrev, Panel, Scrubber } from '@studio/ui';
import { Page } from '../shell';
import { STAGE, StageHost, type HostInstance } from '../studio/StageHost';
import { useLatestTake } from '../useTake';

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
type Targeted = Extract<RecorderEvent, { kind: 'click' | 'type' }>;

/** Builds a showcase: each core overlay placed on a real moment of the reference take. */
function buildShowcase(
  events: RecorderEvent[],
  fit: ReturnType<typeof fitSource>,
  duration: number,
): HostInstance[] {
  const targets = events.filter((e): e is Targeted => e.kind === 'click' || e.kind === 'type');
  const steps = events.filter(
    (e): e is Extract<RecorderEvent, { kind: 'step-start' }> => e.kind === 'step-start',
  );
  const find = (re: RegExp) => targets.find((e) => re.test(e.target));
  const out: HostInstance[] = [];
  const add = (
    component: string,
    start: number,
    end: number,
    props: Record<string, unknown>,
    target?: Targeted,
  ) =>
    out.push({
      id: `${component.slice(5).toLowerCase()}-${out.length}`,
      component,
      start: Math.max(0, start),
      end: Math.min(duration, end),
      props: resolveProps(component, props),
      anchor: target ? sourceToStage(target.bbox, fit) : null,
    });

  add('core:Cursor', 0, duration, {});
  add('core:ClickRipple', 0, duration, {});
  add('core:TitleCard', 0.2, 2.4, { title: 'Create an HTTP service', subtitle: 'WSO2 Integrator' });
  const artifacts = find(/Add Artifact/);
  if (artifacts) add('core:Box', artifacts.t - 1.2, artifacts.t + 0.4, {}, artifacts);
  const card = find(/HTTP Service card/);
  if (card) add('core:Arrow', card.t - 1.6, card.t + 0.2, { from: 'right', label: 'HTTP Service' }, card);
  const base = targets.find((e) => e.kind === 'type' && /Base Path/.test(e.target));
  if (base) {
    add('core:Zoom', base.t - 0.8, base.t + 2.6, { zoom: 1.7 }, base);
    add(
      'core:Callout',
      base.t + 0.2,
      base.t + 2.6,
      { title: 'Service base path', text: 'Clients reach the service at this path.', side: 'bottom' },
      base,
    );
  }
  const create = find(/^Create$/);
  if (create) add('core:Highlight', create.t - 1, create.t + 0.3, {}, create);
  const method = find(/GET method/);
  if (method) add('core:Keystroke', method.t - 0.4, method.t + 1.2, { keys: ['G', 'E', 'T'] });
  const resPath = targets.find((e) => e.kind === 'type' && /Resource Path/.test(e.target));
  if (resPath) add('core:Blur', resPath.t + 0.6, resPath.t + 2.4, {}, resPath);
  steps.forEach((s, i) => {
    const next = steps[i + 1]?.t ?? duration;
    add('core:Captions', s.t + 0.1, next - 0.1, { text: s.title });
    add('core:TextLabel', s.t + 0.1, Math.min(s.t + 2, next), {
      text: `Step ${i + 1}`,
      x: 96,
      y: 70,
      tone: 'orange',
    });
  });
  return out;
}

export function GalleryPage() {
  const { take, events, error, media } = useLatestTake('demo-http');
  const [player, controls] = usePlayer(take?.duration ?? 1);
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(Object.keys(coreOverlays).map((k) => [k, true])),
  );
  const [errors, setErrors] = useState<string[]>([]);

  const showcase = useMemo(
    () => (take ? buildShowcase(events, fitSource(take, STAGE), take.duration) : []),
    [take, events],
  );
  const instances = showcase.filter((i) => enabled[i.component]);
  const src = take ? media(take.video) : null;
  const firstOf = (ref: string) => showcase.find((i) => i.component === ref);

  return (
    <Page
      title="Step 2.4 · Core overlays"
      intro="Every built-in overlay placed on a real moment of the reference take: cursor and click ripples from the recorded events, a title card, box, arrow, zoom + callout, spotlight, keystrokes, blur, captions and step labels. Toggle them, jump to each, and scrub."
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <Panel
          title={take ? `demo-http · ${take.id}` : 'Loading take…'}
          action={
            errors.length > 0 ? (
              <Chip tone="error">{errors[errors.length - 1]}</Chip>
            ) : (
              <Chip mono>{fmt(player.t)}</Chip>
            )
          }
          style={{ flex: '999 1 640px' }}
        >
          {error && <Chip tone="error">{error}</Chip>}
          {take && src && (
            <>
              <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--ui-gray-300)' }}>
                <StageHost
                  take={take}
                  src={src}
                  events={events}
                  instances={instances}
                  t={player.t}
                  playing={player.playing}
                  onOverlayError={(id, e) => setErrors((x) => [...x, `${id}: ${e.message}`])}
                />
              </div>
              <Scrubber
                value={player.t}
                max={take.duration}
                onChange={(t) => controls.seek(t)}
                label="Stage time"
                format={fmt}
                height={30}
              >
                <div
                  style={{
                    position: 'relative',
                    height: 14,
                    borderRadius: 6,
                    background: 'var(--ui-gray-100)',
                  }}
                >
                  {instances
                    .filter((i) => i.end - i.start < take.duration - 0.5)
                    .map((i) => (
                      <span
                        key={i.id}
                        title={i.component}
                        style={{
                          position: 'absolute',
                          top: 3,
                          height: 8,
                          borderRadius: 3,
                          opacity: 0.6,
                          background: i.component === 'core:Zoom' ? 'var(--ui-steel)' : 'var(--ui-orange)',
                          left: `${(i.start / take.duration) * 100}%`,
                          width: `${((i.end - i.start) / take.duration) * 100}%`,
                        }}
                      />
                    ))}
                </div>
              </Scrubber>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <IconButton label="Back to start" onClick={() => controls.seek(0)}>
                  <IconPrev size={14} />
                </IconButton>
                <IconButton
                  label={player.playing ? 'Pause' : 'Play'}
                  variant="primary"
                  onClick={() => controls.toggle()}
                >
                  {player.playing ? <IconPause size={14} /> : <IconPlay size={14} />}
                </IconButton>
              </div>
            </>
          )}
        </Panel>

        <Panel title="Core overlays" style={{ flex: '1 1 300px', maxWidth: 380 }}>
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {Object.entries(coreOverlays).map(([ref, mod]) => {
              const first = firstOf(ref);
              return (
                <li
                  key={ref}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '22px minmax(0,1fr) auto',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <input
                    type="checkbox"
                    aria-label={`Show ${mod.meta.name}`}
                    checked={enabled[ref] ?? true}
                    onChange={(e) => setEnabled((x) => ({ ...x, [ref]: e.target.checked }))}
                    style={{ accentColor: 'var(--ui-orange)', width: 16, height: 16 }}
                  />
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <strong style={{ color: 'var(--ui-navy)' }}>{mod.meta.name}</strong>
                    <span style={{ fontSize: 11, color: 'var(--ui-gray-600)', lineHeight: 1.35 }}>
                      {mod.meta.description}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="ui-btn ui-btn-sm"
                    disabled={!first}
                    onClick={() => first && controls.seek(Math.min(first.start + 0.5, first.end))}
                  >
                    Jump
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
    </Page>
  );
}
