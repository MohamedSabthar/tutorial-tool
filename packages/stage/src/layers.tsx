/* eslint-disable react-hooks/immutability -- three.js cameras/textures and <video> are imperative objects we drive from effects. */
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { CanvasTexture, NoToneMapping, SRGBColorSpace, VideoTexture, type OrthographicCamera } from 'three';
import type { Rect } from '@studio/core';
import { FRAME, fitSource, restCamera, sourceToStage, type CameraState, type Fit } from './camera';
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

export function Scene3D({ children }: { children?: ReactNode }) {
  const { width, height, mode } = useStageTime();
  return (
    <Canvas
      orthographic
      frameloop={mode === 'export' ? 'never' : 'demand'}
      dpr={1}
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
    </Canvas>
  );
}

/**
 * The recording as a textured plane, fitted into the stage. In preview a <video> element
 * supplies frames; `sourceTime` (seconds in the take) keeps it in sync with stage time.
 */
export function VideoPlane({
  src,
  sourceTime,
  playing,
}: {
  src: string;
  sourceTime: number;
  playing: boolean;
}) {
  const { fit } = useCamera();
  const { width, height } = useStageTime();
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
    const tex = new VideoTexture(video);
    tex.colorSpace = SRGBColorSpace;
    return tex;
  }, [video]);
  const lastSet = useRef(-1);

  useEffect(() => {
    video.src = src;
    video.load();
    return () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [video, src]);

  useEffect(() => () => texture.dispose(), [texture]);

  // Known to videosSettled() while mounted (headless rendering waits for seeks).
  useEffect(() => {
    liveVideos.add(video);
    return () => void liveVideos.delete(video);
  }, [video]);

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
    const onSeeked = () => invalidate();
    video.addEventListener('seeked', onSeeked);
    return () => {
      if ('cancelVideoFrameCallback' in video) video.cancelVideoFrameCallback(id);
      video.removeEventListener('seeked', onSeeked);
    };
  }, [video, invalidate]);

  // Follow stage time: native playback while playing (correcting drift), exact seeks otherwise.
  useEffect(() => {
    const frame = 1 / 30;
    if (playing) {
      if (video.paused) void video.play().catch(() => {});
      if (Math.abs(video.currentTime - sourceTime) > frame * 3) video.currentTime = sourceTime;
    } else {
      if (!video.paused) video.pause();
      if (Math.abs(lastSet.current - sourceTime) > 1e-4) {
        video.currentTime = sourceTime;
        lastSet.current = sourceTime;
      }
    }
  }, [video, sourceTime, playing]);

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

/** Video elements of mounted VideoPlanes. */
const liveVideos = new Set<HTMLVideoElement>();

/**
 * Resolves once every mounted video has finished seeking and has a frame, and the canvas has
 * drawn it (two animation frames later). The headless renderer waits on this before a capture.
 */
export async function videosSettled(timeoutMs = 10_000): Promise<void> {
  const until = performance.now() + timeoutMs;
  const ready = () => [...liveVideos].every((v) => !v.src || (!v.seeking && v.readyState >= 2));
  while (!ready() && performance.now() < until) await new Promise((r) => setTimeout(r, 16));
  for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(() => r(null)));
}
