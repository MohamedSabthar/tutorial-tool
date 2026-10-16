import { useMemo, useState } from 'react';
import type { RecorderEvent } from '@studio/core';
import { fitSource, sourceToStage, usePlayer } from '@studio/stage';
import { Button, Chip, IconButton, IconPause, IconPlay, Panel, Scrubber } from '@studio/ui';
import { useEngine } from '../engine';
import { Page } from '../shell';
import { STAGE, StageHost, type HostInstance } from '../studio/StageHost';
import { useOverlayRegistry } from '../studio/useOverlayRegistry';
import { useLatestTake } from '../useTake';

const SLUG = 'demo-http';

/** The overlay's default props, or {} if its schema can't produce them. */
function defaultProps(
  schema: { safeParse?: (v: unknown) => { success: boolean; data?: unknown } } | undefined,
) {
  const r = schema?.safeParse?.({});
  return r?.success && r.data && typeof r.data === 'object' ? (r.data as Record<string, unknown>) : {};
}
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
type Targeted = Extract<RecorderEvent, { kind: 'click' | 'type' }>;

export function HotReloadPage() {
  const { client } = useEngine();
  const { take, events, error, media } = useLatestTake(SLUG);
  const { registry, status, reportError, ready } = useOverlayRegistry(SLUG);
  const [player, controls] = usePlayer(take?.duration ?? 1);
  const [sample, setSample] = useState<{ path: string; absolutePath: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const fit = useMemo(() => (take ? fitSource(take, STAGE) : null), [take]);
  const anchorEvent = useMemo(() => events.find((e): e is Targeted => e.kind === 'type'), [events]);
  // Every non-core overlay gets an instance across the whole take, anchored to the first typed field.
  const instances: HostInstance[] = useMemo(() => {
    if (!take || !fit) return [];
    return Object.keys(registry)
      .filter((id) => !id.startsWith('core:'))
      .map((id) => {
        const mod = registry[id]!;
        const props = defaultProps(mod.meta?.props);
        return {
          id,
          component: id,
          start: 0,
          end: take.duration,
          props,
          anchor: anchorEvent ? sourceToStage(anchorEvent.bbox, fit) : null,
        };
      });
  }, [registry, take, fit, anchorEvent]);

  async function createSample() {
    if (!client) return;
    const r = await client.call('overlays.writeSample', { slug: SLUG });
    setSample(r);
    if (anchorEvent) controls.seek(anchorEvent.t + 0.8);
  }

  async function openInEditor(path: string) {
    if (!client) return;
    const { opened } = await client.call('workspace.openInEditor', { path });
    setNote(
      opened
        ? 'Opened in VS Code. Edit the text or colours and save.'
        : 'Could not run `code`; open the file yourself.',
    );
  }

  const src = take ? media(take.video) : null;
  const custom = Object.values(status);
  return (
    <Page
      title="Step 2.5 · Overlay hot-loading"
      intro="The engine compiles overlay files from the workspace on demand and the preview imports them, sharing the app’s React, three.js, GSAP and SDK. Create the sample overlay, open it in your editor, change something and save: the preview updates in about a second without losing the playhead. Introduce an error to see it isolated to that overlay."
    >
      <Panel
        title="Workspace overlays (demo-http)"
        action={<Chip tone={ready ? 'ok' : 'neutral'}>{ready ? 'overlay server ready' : 'starting…'}</Chip>}
      >
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button variant="primary" onClick={createSample} disabled={!client}>
            Create HelloOverlay.tsx
          </Button>
          {sample && (
            <>
              <Button onClick={() => openInEditor(sample.path)}>Open in VS Code</Button>
              <span className="ui-mono" style={{ fontSize: 12, color: 'var(--ui-gray-600)' }}>
                {sample.absolutePath}
              </span>
            </>
          )}
        </div>
        {note && <Chip tone="info">{note}</Chip>}
        {custom.length === 0 ? (
          <span style={{ color: 'var(--ui-gray-600)' }}>No workspace or project overlays yet.</span>
        ) : (
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
            {custom.map((o) => (
              <li key={o.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong style={{ color: 'var(--ui-navy)' }}>{o.id}</strong>
                <span className="ui-mono" style={{ fontSize: 11, color: 'var(--ui-gray-600)' }}>
                  {o.path}
                </span>
                {o.error ? (
                  <Chip tone="error">{o.error.slice(0, 160)}</Chip>
                ) : (
                  <Chip tone="ok">{`loaded v${o.version} · ${new Date(o.loadedAt).toLocaleTimeString()}`}</Chip>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title={take ? `demo-http · ${take.id}` : 'Loading take…'}
        action={<Chip mono>{fmt(player.t)}</Chip>}
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
                registry={registry}
                onOverlayError={reportError}
              />
            </div>
            <Scrubber
              value={player.t}
              max={take.duration}
              onChange={(t) => controls.seek(t)}
              label="Stage time"
              format={fmt}
              height={26}
            >
              <div style={{ height: 12, borderRadius: 6, background: 'var(--ui-gray-100)' }} />
            </Scrubber>
            <div style={{ display: 'flex', gap: 10 }}>
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
    </Page>
  );
}
