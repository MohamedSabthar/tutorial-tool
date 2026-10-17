import { useEffect, useState } from 'react';
import { useEngine } from '../engine';

/** Peaks per audio file, shared by every lane that draws it. */
const cache = new Map<string, Promise<{ rate: number; peaks: number[] }>>();

/**
 * A voice line's waveform from the engine's cached peaks, drawn as bars scaled to the
 * loudest peak (speech and test tones differ a lot in level).
 */
export function Waveform({ slug, audio, height }: { slug: string; audio: string; height: number }) {
  const { client } = useEngine();
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    if (!client) return;
    const key = `${slug}/${audio}`;
    let p = cache.get(key);
    if (!p) {
      p = client.call('vo.peaks', { slug, audio });
      cache.set(key, p);
      p.catch(() => cache.delete(key));
    }
    let live = true;
    void p.then(
      (r) => live && setPeaks(r.peaks),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [client, slug, audio]);
  if (!peaks?.length) return null;
  const max = Math.max(...peaks, 0.01);
  const mid = height / 2;
  const d = peaks
    .map((v, i) => {
      const h = Math.max(0.5, (v / max) * (mid - 1));
      return `M${i + 0.5} ${mid - h}V${mid + h}`;
    })
    .join('');
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${peaks.length} ${height}`}
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    >
      <path d={d} stroke="var(--ui-green-ink)" strokeWidth={0.7} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
