/* eslint-disable react-hooks/immutability -- three.js cameras/textures and <video> are imperative objects we drive from effects. */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import {
  CanvasTexture,
  NoToneMapping,
  SRGBColorSpace,
  VideoFrameTexture,
  VideoTexture,
  type OrthographicCamera,
} from 'three';
import type { Rect } from '@studio/core';
import { FRAME, fitSource, restCamera, sourceToStage, type CameraState, type Fit } from './camera';
import {
  canvasesMounted,
  createCanvasEntry,
  frameProvider,
  trackPending,
  type CanvasEntry,
} from './exportDriver';
import { useStageTime } from './Stage';
import { TunnelOut } from './tunnel';

/**
 * The visual layers of a recording scene:
 *   <Scene3D>   one R3F canvas: the video plane and any 3D overlay content, through the camera
 *   <DomLayer>  HTML on top; `follow` moves it with the camera, otherwise it is screen space
 * Both use stage px, and share the camera from <CameraProvider>.
 */
interface CameraCtx {
  camera: CameraState;
  fit: Fit;
}

const CameraContext = createContext<CameraCtx | null>(null);

export function CameraProvider({
  camera,
  source,
  children,
}: {
  camera: CameraState;
  source: { width: number; height: number };
  children: ReactNode;
}) {
  const { width, height } = useStageTime();
  const fit = useMemo(() => fitSource(source, { width, height }), [source, width, height]);
  return <CameraContext.Provider value={{ camera, fit }}>{children}</CameraContext.Provider>;
}

/** The camera and the source→stage fit. Use `toStage` to place things anchored to recorded elements. */
export function useCamera() {
  const ctx = useContext(CameraContext);
  const { width, height } = useStageTime();
  const fallback = useMemo<CameraCtx>(
    () => ({
      camera: restCamera({ width, height }),
      fit: { scale: 1, rect: { x: 0, y: 0, w: width, h: height } },
    }),
    [width, height],
  );
  const { camera, fit } = ctx ?? fallback;
  return { camera, fit, toStage: (r: Rect) => sourceToStage(r, fit) };
}

/** Points the orthographic camera at the current CameraState. */
function CameraRig() {
  const { camera: cam } = useCamera();
  const { width, height } = useStageTime();
  const three = useThree();
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const c = three.camera as OrthographicCamera;
    c.left = -width / 2;
    c.right = width / 2;
    c.top = height / 2;
    c.bottom = -height / 2;
    c.zoom = cam.zoom;
    c.position.set(cam.focusX - width / 2, -(cam.focusY - height / 2), 100);
    c.updateProjectionMatrix();
    invalidate();
  }, [three.camera, cam.zoom, cam.focusX, cam.focusY, width, height, invalidate]);
  return null;
}

/** Re-renders the canvas whenever stage time changes (frameloop is on demand). */
function TimeInvalidator() {
  const { t } = useStageTime();
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [t, invalidate]);
  return null;
}

/** Tells the export driver each time the canvas's React root commits. */
function CommitMarker({ entry }: { entry: CanvasEntry }) {
  const { t } = useStageTime();
  useEffect(() => entry.commit(t));
  return null;
}

export function Scene3D({ children }: { children?: ReactNode }) {
  const { width, height, mode } = useStageTime();
  const [entry] = useState(createCanvasEntry);
  useEffect(() => {
    entry.attach();
    return () => entry.dispose();
  }, [entry]);
  return (
    <Canvas
      orthographic
      // On demand in preview; in export the driver draws each frame itself (exportFrameReady).
      frameloop={mode === 'export' ? 'never' : 'demand'}
      // Export at 4K renders the page at 2 device pixels per stage pixel; the canvas follows.
      dpr={mode === 'export' ? window.devicePixelRatio : 1}
      flat
      gl={{ antialias: true, preserveDrawingBuffer: mode === 'export' }}
      // The stage surface is CSS-scaled to fit; measure untransformed size so the canvas
      // always renders at stage resolution, and let CameraRig own the frustum.
      resize={{ offsetSize: true, scroll: false }}
      camera={{ position: [0, 0, 100], near: 0.1, far: 1000, manual: true }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = SRGBColorSpace;
        gl.toneMapping = NoToneMapping;
      }}
      style={{ position: 'absolute', inset: 0, width, height }}
    >
      {/* R3F v9 bridges React context into the canvas, so stage time and camera are available. */}
      <CameraRig />
      <TimeInvalidator />
      {children}
      {/* 3D content that overlays send in with <ThreeLayer>. */}
      <TunnelOut />
      {/* Last, so its effect runs after the video plane's (which starts the frame's decode). */}
      <CommitMarker entry={entry} />
    </Canvas>
  );
}

/**
 * The recording as a textured plane, fitted into the stage. In preview a <video> element
 * supplies frames and `sourceTime` (seconds in the take) keeps it in sync with stage time; in
 * export the exact frame at `sourceTime` comes from the WebCodecs frame provider.
 */
export function VideoPlane({
  src,
  sourceTime,
  playing,
  rate = 1,
}: {
  src: string;
  sourceTime: number;
  playing: boolean;
  /** Take seconds per stage second here: 0 in a freeze, above 1 where the take is sped up. */
  rate?: number;
}) {
  const { fit } = useCamera();
  const { width, height, mode } = useStageTime();
  const exporting = mode === 'export';
  const invalidate = useThree((s) => s.invalidate);
  const video = useMemo(() => {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    return v;
  }, []);
  const texture = useMemo(() => {
    const tex = exporting ? new VideoFrameTexture() : new VideoTexture(video);
    tex.colorSpace = SRGBColorSpace;
    return tex;
  }, [video, exporting]);
  const lastSet = useRef(-1);

  // Export: put the exact frame for this time on the texture before the frame is drawn.
  useEffect(() => {
    if (!exporting || !(texture instanceof VideoFrameTexture)) return;
    void trackPending(
      (async () => {
        const frames = await frameProvider(src);
        texture.setFrame(await frames.frameAt(sourceTime));
      })(),
    );
  }, [exporting, texture, src, sourceTime]);

  useEffect(() => {
    if (exporting) return;
    // In the page (invisible): WebKit doesn't reliably update a detached video's frame for
    // WebGL uploads after a seek, so the texture could keep showing the first frame.
    Object.assign(video.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
    });
    video.setAttribute('aria-hidden', 'true');
    document.body.appendChild(video);
    video.src = src;
    video.load();
    return () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
    };
  }, [video, src, exporting]);

  useEffect(() => () => texture.dispose(), [texture]);

  // Known to videosSettled() while mounted (headless rendering waits for seeks).
  useEffect(() => {
    if (exporting) return;
    liveVideos.add(video);
    return () => void liveVideos.delete(video);
  }, [video, exporting]);

  // Rounded corners: an alpha mask the size of the fitted frame.
  const mask = useMemo(() => roundedMask(fit.rect.w, fit.rect.h, FRAME.radius), [fit.rect.w, fit.rect.h]);
  useEffect(() => () => mask?.dispose(), [mask]);

  // Redraw on every decoded video frame.
  useEffect(() => {
    let id = 0;
    const onFrame = () => {
      invalidate();
      id = video.requestVideoFrameCallback(onFrame);
    };
    if ('requestVideoFrameCallback' in video) id = video.requestVideoFrameCallback(onFrame);
    // VideoTexture only uploads from requestVideoFrameCallback, which WebKit doesn't reliably
    // fire for a paused video's seeks: without this, a missed first frame stays missing.
    const onSeeked = () => {
      if (texture instanceof VideoTexture) texture.needsUpdate = true;
      invalidate();
    };
    // WebKit keeps a seek asked for before the metadata loaded as currentTime but may show the
    // first frame: seek again (to the same time, which still seeks).
    const onMetadata = () => {
      const want = seekTargets.get(video);
      if (want !== undefined && video.paused) video.currentTime = want;
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadeddata', onSeeked);
    video.addEventListener('loadedmetadata', onMetadata);
    return () => {
      if ('cancelVideoFrameCallback' in video) video.cancelVideoFrameCallback(id);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadeddata', onSeeked);
      video.removeEventListener('loadedmetadata', onMetadata);
    };
  }, [video, texture, invalidate]);

  // Follow stage time: native playback at the segment's speed while playing (correcting drift),
  // a still frame in a freeze, exact seeks otherwise.
  useEffect(() => {
    if (exporting) return;
    const frame = 1 / 30;
    const still = rate < 0.05;
    if (playing && !still) {
      seekTargets.delete(video);
      const want = Math.min(16, Math.max(0.25, rate));
      if (Math.abs(video.playbackRate - want) > 0.01) video.playbackRate = want;
      if (video.paused) void video.play().catch(() => {});
      if (Math.abs(video.currentTime - sourceTime) > frame * 3 * Math.max(1, want))
        video.currentTime = sourceTime;
    } else {
      if (!video.paused) video.pause();
      if (Math.abs(lastSet.current - sourceTime) > 1e-4) {
        video.currentTime = sourceTime;
        lastSet.current = sourceTime;
      }
      seekTargets.set(video, sourceTime);
    }
  }, [video, sourceTime, playing, exporting, rate]);

  const cx = fit.rect.x + fit.rect.w / 2 - width / 2;
  const cy = -(fit.rect.y + fit.rect.h / 2 - height / 2);
  return (
    <mesh position={[cx, cy, 0]}>
      <planeGeometry args={[fit.rect.w, fit.rect.h]} />
      <meshBasicMaterial map={texture} toneMapped={false} transparent={!!mask} alphaMap={mask ?? null} />
    </mesh>
  );
}

/** HTML layer in stage px. With `follow`, it moves and scales with the camera. */
export function DomLayer({ follow = false, children }: { follow?: boolean; children?: ReactNode }) {
  const { camera } = useCamera();
  const { width, height } = useStageTime();
  const transform = follow
    ? `translate(${width / 2}px, ${height / 2}px) scale(${camera.zoom}) translate(${-camera.focusX}px, ${-camera.focusY}px)`
    : undefined;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <div
        style={{ position: 'absolute', left: 0, top: 0, width, height, transformOrigin: '0 0', transform }}
      >
        {children}
      </div>
    </div>
  );
}

/** A white rounded rectangle on black, as an alpha map (null where there is no 2D canvas, e.g. tests). */
function roundedMask(w: number, h: number, radius: number): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const k = Math.min(1, 1024 / Math.max(w, h));
  canvas.width = Math.max(2, Math.round(w * k));
  canvas.height = Math.max(2, Math.round(h * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, radius * k);
  ctx.fill();
  return new CanvasTexture(canvas);
}

/**
 * The recording's frame at rest: a soft shadow under the rounded video, moving with the camera.
 * Put it before <Scene3D> so it sits behind the canvas.
 */
export function FrameShadow() {
  const { fit } = useCamera();
  return (
    <DomLayer follow>
      <div
        style={{
          position: 'absolute',
          left: fit.rect.x,
          top: fit.rect.y,
          width: fit.rect.w,
          height: fit.rect.h,
          borderRadius: FRAME.radius,
          boxShadow: FRAME.shadow,
        }}
      />
    </DomLayer>
  );
}

/** Video elements of mounted VideoPlanes (and recorded-frame helpers). */
const liveVideos = new Set<HTMLVideoElement>();
/** The source time each paused video should show. */
const seekTargets = new WeakMap<HTMLVideoElement, number>();
/** Whether a video shows the time it was asked for (any time, if none). */
const atTarget = (v: HTMLVideoElement) => {
  const want = seekTargets.get(v);
  return want === undefined || Math.abs(v.currentTime - want) < 0.5 / 30;
};

/** Makes videosSettled() wait for this video's seeks too; returns the untrack function. */
export function trackVideo(video: HTMLVideoElement): () => void {
  liveVideos.add(video);
  return () => void liveVideos.delete(video);
}

/**
 * Resolves once every mounted video shows the time it was asked for, and the canvas has
 * drawn it (two animation frames later). The headless renderer waits on this before a capture.
 */
export async function videosSettled(timeoutMs = 10_000): Promise<void> {
  const until = performance.now() + timeoutMs;
  // The canvas commits its children in its own React root, created only once it has been
  // measured: wait for that root (until then no video is registered), give its effects (the
  // video's src and seek) a frame to run, and count a video without a src yet as not ready.
  for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(() => r(null)));
  const ready = () =>
    canvasesMounted() &&
    [...liveVideos].every((v) => !!v.src && !v.seeking && v.readyState >= 2 && atTarget(v));
  while (!ready() && performance.now() < until) await new Promise((r) => setTimeout(r, 16));
  for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(() => r(null)));
}
