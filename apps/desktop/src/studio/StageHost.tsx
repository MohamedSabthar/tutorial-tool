import { useMemo, type CSSProperties, type ReactNode } from 'react';
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
import { coreTransitions, DEFAULT_MORPH_TARGET, type TransitionFrame } from '@studio/scenes-core';
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
  mode = 'preview',
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
    transition: {
      id: string;
      component: string;
      u: number;
      from: { sceneId: string; kind: 'recording' | 'explainer' };
      to: { sceneId: string; kind: 'recording' | 'explainer' };
    } | null;
  };
  /** Export mounts the stage unscaled at 1920×1080. */
  mode?: 'preview' | 'export';
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
  // How fast the take runs here (0 in a freeze); a jump at a cut reads as normal speed.
  const ahead = (sourceTime(t + 0.05) - sourceTime(t)) / 0.05;
  const rate = ahead > 17 || ahead < 0 ? 1 : Math.round(ahead * 100) / 100;

  // Overlays on the recording (anchored, or drawing the pointer) travel with it in transitions;
  // the rest (titles, captions, labels) stay on screen.
  const onRecording = instances.filter((i) => i.anchor || POINTER.has(i.component));
  const onScreen = instances.filter((i) => !(i.anchor || POINTER.has(i.component)));
  const renderInstance = (inst: HostInstance) => {
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
        <Comp props={withDefaults(mod, inst.props)} duration={inst.end - inst.start} />
      </OverlayRenderer>
    );
  };

  // Scene layers in paint order, with a transition's styles when one is playing.
  type Layer =
    | { kind: 'recording'; style: CSSProperties }
    | { kind: 'explainer'; e: NonNullable<typeof layers>['explainers'][number]; style: CSSProperties };
  const tr = layers?.transition ?? null;
  const module = tr ? (coreTransitions[tr.component] ?? coreTransitions['core:Crossfade']!) : null;
  const explainerOf = (id: string) => layers?.explainers.find((e) => e.id === id);
  let frame: TransitionFrame | null = null;
  if (tr && module) {
    const explainer = explainerOf(tr.from.kind === 'explainer' ? tr.from.sceneId : tr.to.sceneId);
    const meta = explainer ? registry[explainer.component]?.meta : undefined;
    frame = module.frame(tr.u, {
      from: tr.from.kind,
      to: tr.to.kind,
      target: meta?.morph ?? DEFAULT_MORPH_TARGET(STAGE),
      stage: STAGE,
    });
  }
  const styleFor = (sceneKind: 'recording' | 'explainer', id?: string): CSSProperties => {
    if (!tr || !frame) return {};
    const isFrom = tr.from.kind === sceneKind && (sceneKind === 'recording' || tr.from.sceneId === id);
    const isTo = tr.to.kind === sceneKind && (sceneKind === 'recording' || tr.to.sceneId === id);
    return isFrom ? frame.from : isTo ? frame.to : {};
  };
  const recordingLayer: Layer = {
    kind: 'recording',
    style: { ...styleFor('recording'), ...(showsRecording ? {} : { visibility: 'hidden' }) },
  };
  const explainerLayers: Layer[] = (layers?.explainers ?? []).map((e) => ({
    kind: 'explainer',
    e,
    style: tr ? styleFor('explainer', e.id) : { opacity: e.weight },
  }));
  let ordered: Layer[] = [recordingLayer, ...explainerLayers];
  if (tr && frame) {
    const topId = frame.top === 'from' ? tr.from : tr.to;
    const isTop = (l: Layer) =>
      l.kind === topId.kind &&
      (l.kind === 'recording' || (l.kind === 'explainer' && l.e.id === topId.sceneId));
    ordered = [...ordered.filter((l) => !isTop(l)), ...ordered.filter(isTop)];
  }

  return (
    <Stage t={t} {...STAGE} background={FRAME.backdrop} mode={mode}>
      <TakeContext.Provider value={takeInfo}>
        <RecordingContext.Provider value={recording}>
          <CaptionsContext.Provider value={captions}>
            <CameraProvider camera={camera} source={take}>
              {ordered.map((layer) =>
                layer.kind === 'recording' ? (
                  // The recording, its shadow and the overlays placed on it move as one layer.
                  <div key="recording" style={{ position: 'absolute', inset: 0, ...layer.style }}>
                    <FrameShadow />
                    <Scene3D>
                      <VideoPlane src={src} sourceTime={st} playing={videoPlaying ?? playing} rate={rate} />
                    </Scene3D>
                    {(showOverlays ? onRecording : []).map(renderInstance)}
                  </div>
                ) : (
                  <ExplainerLayer key={layer.e.id} weight={1} style={layer.style}>
                    {registry[layer.e.component] && (
                      <OverlayRenderer
                        key={moduleKey(registry[layer.e.component]!)}
                        id={layer.e.id}
                        start={layer.e.start}
                        end={layer.e.end}
                        onError={onOverlayError}
                      >
                        <SceneContext.Provider
                          value={resolveBeats(
                            layer.e.scene,
                            layer.e.voice,
                            registry[layer.e.component]!.meta?.beats ?? [],
                          )}
                        >
                          {(() => {
                            const mod = registry[layer.e.component]!;
                            return (
                              <mod.default
                                props={withDefaults(mod, layer.e.props)}
                                duration={layer.e.end - layer.e.start}
                              />
                            );
                          })()}
                        </SceneContext.Provider>
                      </OverlayRenderer>
                    )}
                  </ExplainerLayer>
                ),
              )}
              {(showOverlays ? onScreen : []).map(renderInstance)}
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

/** Overlays that draw the recorded pointer: they belong to the recording layer. */
const POINTER = new Set(['core:Cursor', 'core:ClickRipple']);
