import { useMemo, useRef, useState } from 'react';
import type { RecorderEvent } from '@studio/core';
import { OverlayRenderer } from '@studio/overlay-sdk';
import {
  cameraAt,
  CameraProvider,
  fitSource,
  restCamera,
  Scene3D,
  sourceToStage,
  Stage,
  usePlayer,
  VideoPlane,
} from '@studio/stage';
import { Button, Chip, IconButton, IconPause, IconPlay, IconPrev, Panel, Scrubber, Switch } from '@studio/ui';
import SampleCallout, { BrokenOverlay } from '../samples/SampleCallout';
import { Page } from '../shell';
import { useLatestTake } from '../useTake';

const STAGE = { width: 1920, height: 1080 };
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
type Typed = Extract<RecorderEvent, { kind: 'type' }>;

export function SdkPage() {
  const { take, events, error, media } = useLatestTake('demo-http');
  const [player, controls] = usePlayer(take?.duration ?? 1);
  const [broken, setBroken] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [check, setCheck] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const fit = useMemo(() => (take ? fitSource(take, STAGE) : null), [take]);
  // Anchor the sample to the first typed field (the Service Base Path).
  const target = useMemo(() => events.find((e): e is Typed => e.kind === 'type') ?? null, [events]);
  const instance =
    target && fit
      ? { start: Math.max(0, target.t - 0.4), end: target.t + 4, anchor: sourceToStage(target.bbox, fit) }
      : null;
  const camera =
    fit && instance
      ? cameraAt(
          player.t,
          [
            {
              start: instance.start,
              end: instance.end,
              ease: 0.6,
              to: {
                zoom: 1.5,
                focusX: instance.anchor.x + instance.anchor.w / 2 + 180,
                focusY: instance.anchor.y,
              },
            },
          ],
          restCamera(STAGE),
          fit.rect,
          STAGE,
        )
      : restCamera(STAGE);

  // Scrub to scattered times inside the overlay forward, then backward, and compare the overlay DOM.
  async function runCheck() {
    if (!instance) return;
    const times = [0.1, 0.35, 0.7, 1.1, 1.6, 2.4, 3.3].map((d) => instance.start + d);
    const snap = async (t: number) => {
      controls.seek(t);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return stageRef.current?.querySelector('.card')?.outerHTML ?? '';
    };
    const forward: string[] = [];
    for (const t of times) forward.push(await snap(t));
    const backward: string[] = [];
    for (const t of [...times].reverse()) backward.push(await snap(t));
    backward.reverse();
    const same = forward.every((f, i) => f === backward[i]);
    setCheck(
      same ? `${times.length} frames identical forward and backward` : 'Frames differ between directions',
    );
  }

  const src = take ? media(take.video) : null;
  return (
    <Page
      title="Step 2.3 · Overlay SDK"
      intro="A sample overlay written only against @studio/overlay-sdk, anchored to the Service Base Path field: a GSAP-animated callout (DOM, camera-following) and a pulsing ring (three.js via ThreeLayer). Play it, scrub through it, and run the determinism check. Turn on the broken overlay to see it isolated."
    >
      <Panel
        title={take ? `demo-http · ${take.id}` : 'Loading take…'}
        action={
          <span style={{ display: 'flex', gap: 8 }}>
            {errors.length > 0 && <Chip tone="error">{`${errors.length} overlay error`}</Chip>}
            {instance && (
              <Chip mono>
                overlay {fmt(instance.start)}–{fmt(instance.end)}
              </Chip>
            )}
          </span>
        }
      >
        {error && <Chip tone="error">{error}</Chip>}
        {take && src && fit && (
          <>
            <div
              ref={stageRef}
              style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--ui-gray-300)' }}
            >
              <Stage t={player.t} {...STAGE}>
                <CameraProvider camera={camera} source={take}>
                  <Scene3D>
                    <VideoPlane
                      src={src}
                      sourceTime={Math.min(player.t, take.duration - 0.01)}
                      playing={player.playing}
                    />
                  </Scene3D>
                  {instance && (
                    <OverlayRenderer
                      id="sample"
                      start={instance.start}
                      end={instance.end}
                      anchor={instance.anchor}
                      onError={(id, e) => setErrors((x) => [...x, `${id}: ${e.message}`])}
                    >
                      <SampleCallout
                        props={{ title: 'Service path', code: 'GET :9090/greeting/hello' }}
                        duration={instance.end - instance.start}
                      />
                    </OverlayRenderer>
                  )}
                  {broken && instance && (
                    <OverlayRenderer
                      id="broken"
                      start={0}
                      end={take.duration}
                      onError={(id, e) => setErrors((x) => [...x, `${id}: ${e.message}`])}
                    >
                      <BrokenOverlay />
                    </OverlayRenderer>
                  )}
                </CameraProvider>
              </Stage>
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
                {instance && (
                  <span
                    style={{
                      position: 'absolute',
                      top: 2,
                      height: 10,
                      borderRadius: 3,
                      background: 'var(--ui-orange)',
                      left: `${(instance.start / take.duration) * 100}%`,
                      width: `${((instance.end - instance.start) / take.duration) * 100}%`,
                    }}
                  />
                )}
              </div>
            </Scrubber>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
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
              <Button
                size="sm"
                onClick={() => instance && controls.seek(instance.start)}
                disabled={!instance}
              >
                Jump to the overlay
              </Button>
              <Button size="sm" onClick={runCheck} disabled={!instance}>
                Run determinism check
              </Button>
              {check && <Chip tone={check.includes('identical') ? 'ok' : 'error'}>{check}</Chip>}
              <div style={{ width: 230 }}>
                <Switch
                  label="Add a broken overlay"
                  checked={broken}
                  onChange={(v) => {
                    setBroken(v);
                    if (!v) setErrors([]);
                  }}
                />
              </div>
            </div>
            {errors.length > 0 && (
              <Chip tone="error">{errors[errors.length - 1]} — the rest of the stage keeps rendering</Chip>
            )}
          </>
        )}
      </Panel>
    </Page>
  );
}
