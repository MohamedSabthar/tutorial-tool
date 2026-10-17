/* eslint-disable react-hooks/immutability -- <video>, <canvas> and textures are imperative objects driven from effects. */
import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import type { Take } from '@studio/core';
import { trackVideo } from '@studio/stage';

/** The take behind the tutorial (its video URL), for scenes that show recorded frames. */
export const TakeContext = createContext<{ take: Take; src: string } | null>(null);

/** Draws the take at `time` (take seconds) into `canvas`, seeking a hidden video. */
function useFrameInto(canvas: HTMLCanvasElement | null, time: number) {
  const ctx = useContext(TakeContext);
  const video = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    return v;
  }, []);
  useEffect(() => {
    if (!video || !ctx) return;
    video.src = ctx.src;
    const untrack = trackVideo(video);
    return () => {
      untrack();
      video.removeAttribute('src');
      video.load();
    };
  }, [video, ctx]);
  useEffect(() => {
    if (!video || !canvas || !ctx) return;
    const draw = () => {
      canvas.width = ctx.take.width;
      canvas.height = ctx.take.height;
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    };
    const target = Math.min(Math.max(time, 0), ctx.take.duration - 0.05);
    video.addEventListener('seeked', draw, { once: true });
    const go = () => {
      video.currentTime = target;
    };
    if (video.readyState >= 1) go();
    else video.addEventListener('loadedmetadata', go, { once: true });
    return () => {
      video.removeEventListener('seeked', draw);
      video.removeEventListener('loadedmetadata', go);
    };
  }, [video, canvas, ctx, time]);
}

/**
 * A recorded frame (take time `time`) as an element in a scene, e.g. the VS Code screen
 * shrinking into a box of a diagram. Sized by `style` (it keeps the take's aspect ratio).
 */
export function RecordingFrame({ time, style }: { time: number; style?: CSSProperties }) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const take = useContext(TakeContext)?.take;
  useFrameInto(canvas, time);
  return (
    <canvas
      ref={setCanvas}
      style={{ display: 'block', aspectRatio: take ? `${take.width} / ${take.height}` : '16 / 9', ...style }}
    />
  );
}

/** A recorded frame as a three.js texture, for scenes drawn with <ThreeLayer>. */
export function useRecordingFrame(time: number): CanvasTexture | null {
  const canvas = useMemo(
    () => (typeof document === 'undefined' ? null : document.createElement('canvas')),
    [],
  );
  const texture = useMemo(() => {
    if (!canvas) return null;
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    return tex;
  }, [canvas]);
  useFrameInto(canvas, time);
  useEffect(() => {
    if (texture) texture.needsUpdate = true;
  });
  useEffect(() => () => texture?.dispose(), [texture]);
  return texture;
}
