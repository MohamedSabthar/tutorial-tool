import { useMemo, type ReactNode } from 'react';
import type { Caption, Rect, RecorderEvent, Take } from '@studio/core';
import { CaptionsContext, OverlayRenderer, RecordingContext, type OverlayModule } from '@studio/overlay-sdk';
import { coreOverlays, zoomMove } from '@studio/overlays-core';
import {
  cameraAt,
  CameraProvider,
  fitSource,
  restCamera,
  Scene3D,
  Stage,
  STAGE_SIZE,
  VideoPlane,
  type CameraMove,
} from '@studio/stage';

export const STAGE = STAGE_SIZE;

// A per-module number, so a reloaded overlay remounts (and its error boundary resets).
const moduleKeys = new WeakMap<object, number>();
let nextModuleKey = 1;
function moduleKey(mod: object): number {
  let k = moduleKeys.get(mod);
  if (!k) moduleKeys.set(mod, (k = nextModuleKey++));
  return k;
}

/** An overlay instance ready to render: anchor already resolved to stage px. */
export interface HostInstance {
  id: string;
  component: string;
  start: number;
  end: number;
  props: Record<string, unknown>;
  anchor: Rect | null;
}

/**
 * Renders a recording scene: the take on the GPU plane, the camera from Zoom instances, and
 * every overlay instance through the registry. Shared by the dev pages and the Studio.
 */
export function StageHost({
  take,
  src,
  events,
  instances,
  t,
  playing,
  sourceTime = (x: number) => x,
  videoPlaying,
  showOverlays = true,
  registry = coreOverlays,
  onOverlayError,
  captions = [],
  children,
}: {
  take: Take;
  src: string;
  events: RecorderEvent[];
  instances: HostInstance[];
  t: number;
  playing: boolean;
  /** Output time → take time (from the time map); identity by default. */
  sourceTime?: (t: number) => number;
  /** Whether the video should run natively right now (false during holds). Defaults to `playing`. */
  videoPlaying?: boolean;
  /** Raw view: no overlays and no camera moves. */
  showOverlays?: boolean;
  registry?: Record<string, OverlayModule>;
  onOverlayError?: (id: string, error: Error) => void;
  /** Caption cues for the Captions overlay. */
  captions?: Caption[];
  children?: ReactNode;
}) {
  const fit = useMemo(() => fitSource(take, STAGE), [take]);
  const recording = useMemo(() => ({ events, fit, sourceTime }), [events, fit, sourceTime]);
  const moves = useMemo<CameraMove[]>(
    () =>
      instances
        .filter((i) => i.component === 'core:Zoom' && i.anchor)
        .sort((a, b) => a.start - b.start)
        .map((i) => zoomMove(i, i.anchor!)),
    [instances],
  );
  const camera = cameraAt(t, showOverlays ? moves : [], restCamera(STAGE), fit.rect, STAGE);
  const st = Math.min(Math.max(sourceTime(t), 0), take.duration - 0.01);

  return (
    <Stage t={t} {...STAGE}>
      <RecordingContext.Provider value={recording}>
        <CaptionsContext.Provider value={captions}>
          <CameraProvider camera={camera} source={take}>
            <Scene3D>
              <VideoPlane src={src} sourceTime={st} playing={videoPlaying ?? playing} />
            </Scene3D>
            {(showOverlays ? instances : []).map((inst) => {
              const mod = registry[inst.component];
              if (!mod) return null;
              const Comp = mod.default;
              return (
                <OverlayRenderer
                  key={`${inst.id}:${moduleKey(mod)}`}
                  id={inst.id}
                  start={inst.start}
                  end={inst.end}
                  anchor={inst.anchor}
                  onError={onOverlayError}
                >
                  <Comp props={inst.props} duration={inst.end - inst.start} />
                </OverlayRenderer>
              );
            })}
            {children}
          </CameraProvider>
        </CaptionsContext.Provider>
      </RecordingContext.Provider>
    </Stage>
  );
}
