import { useMemo, type ReactNode } from 'react';
import {
  resolveBeats,
  type Caption,
  type ExplainerScene,
  type Rect,
  type RecorderEvent,
  type Take,
  type VoiceLine,
} from '@studio/core';
import {
  CaptionsContext,
  OverlayRenderer,
  RecordingContext,
  SceneContext,
  TakeContext,
  type OverlayModule,
} from '@studio/overlay-sdk';
import { coreOverlays, zoomMove } from '@studio/overlays-core';
import {
  cameraAt,
  CameraProvider,
  fitSource,
  restCamera,
  Scene3D,
  FRAME,
  FrameShadow,
  ExplainerLayer,
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
  layers,
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
  /** Scenes at t (from the resolver); without it the recording fills the stage. */
  layers?: {
    recording: number;
    explainers: {
      id: string;
      component: string;
      props: Record<string, unknown>;
      start: number;
      end: number;
      weight: number;
      scene: ExplainerScene;
      voice: VoiceLine[];
    }[];
  };
  children?: ReactNode;
}) {
  const fit = useMemo(() => fitSource(take, STAGE), [take]);
  const recordingInfo = useMemo(() => ({ events, fit, sourceTime }), [events, fit, sourceTime]);
  // Overlays that follow the recording (cursor, ripples) disappear while it isn't on screen.
  const showsRecording = !layers || layers.recording > 0;
  const recording = showsRecording ? recordingInfo : null;
  const takeInfo = useMemo(() => ({ take, src }), [take, src]);
  const moves = useMemo(() => cameraMoves(instances), [instances]);
  const camera = cameraAt(t, showOverlays ? moves : [], restCamera(STAGE), fit.rect, STAGE);
  const st = Math.min(Math.max(sourceTime(t), 0), take.duration - 0.01);

  return (
    <Stage t={t} {...STAGE} background={FRAME.backdrop}>
      <TakeContext.Provider value={takeInfo}>
        <RecordingContext.Provider value={recording}>
          <CaptionsContext.Provider value={captions}>
            <CameraProvider camera={camera} source={take}>
              <FrameShadow />
              <Scene3D>
                <VideoPlane src={src} sourceTime={st} playing={videoPlaying ?? playing} />
              </Scene3D>
              {layers?.explainers.map((e) => {
                const mod = registry[e.component];
                return (
                  <ExplainerLayer key={e.id} weight={e.weight}>
                    {mod && (
                      <OverlayRenderer
                        key={moduleKey(mod)}
                        id={e.id}
                        start={e.start}
                        end={e.end}
                        onError={onOverlayError}
                      >
                        <SceneContext.Provider value={resolveBeats(e.scene, e.voice, mod.meta?.beats ?? [])}>
                          <mod.default props={withDefaults(mod, e.props)} duration={e.end - e.start} />
                        </SceneContext.Provider>
                      </OverlayRenderer>
                    )}
                  </ExplainerLayer>
                );
              })}
              {(showOverlays ? instances : []).map((inst) => {
                const mod = registry[inst.component];
                if (!mod) return null;
                // Overlays placed on the recording (anchored or with a rect) leave with it.
                if (!showsRecording && inst.anchor) return null;
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
                    <Comp props={withDefaults(mod, inst.props)} duration={inst.end - inst.start} />
                  </OverlayRenderer>
                );
              })}
              {children}
            </CameraProvider>
          </CaptionsContext.Provider>
        </RecordingContext.Provider>
      </TakeContext.Provider>
    </Stage>
  );
}

/** Camera moves from the Zoom instances (they render nothing themselves). */
export function cameraMoves(instances: HostInstance[]): CameraMove[] {
  return instances
    .filter((i) => i.component === 'core:Zoom' && i.anchor)
    .sort((a, b) => a.start - b.start)
    .map((i) => zoomMove(i, i.anchor!));
}

/** Converts a rect seen on screen at time t (stage px, after the camera) back to stage px. */
export function screenToStage(r: Rect, take: Take, instances: HostInstance[], t: number): Rect {
  const fit = fitSource(take, STAGE);
  const cam = cameraAt(t, cameraMoves(instances), restCamera(STAGE), fit.rect, STAGE);
  return {
    x: (r.x - STAGE.width / 2) / cam.zoom + cam.focusX,
    y: (r.y - STAGE.height / 2) / cam.zoom + cam.focusY,
    w: r.w / cam.zoom,
    h: r.h / cam.zoom,
  };
}

/** Instance props with the component's schema defaults filled in (invalid props pass through). */
function withDefaults(mod: OverlayModule, props: Record<string, unknown>): Record<string, unknown> {
  const parsed = mod.meta?.props?.safeParse(props);
  return parsed?.success ? (parsed.data as Record<string, unknown>) : props;
}
