import { useEffect, useMemo, useRef, useState } from 'react';
import { parseTimeline, type Timeline } from '@studio/core';
import { canvasCommits, exportFrameReady, videosSettled } from '@studio/stage';
import { useLatestTake } from '../useTake';
import { resolveTimeline } from '../studio/resolve';
import { StageHost } from '../studio/StageHost';
import { useOverlayRegistry } from '../studio/useOverlayRegistry';
import { useTimeline } from '../studio/useTimeline';

interface RenderRequest {
  t: number;
  /** Renders this timeline instead of the project's (check_overlay adds a test instance). */
  timeline?: unknown;
}
interface RenderResult {
  /** Overlay id or component → error message, for overlays that failed to load or render. */
  errors: Record<string, string>;
}

declare global {
  interface Window {
    __studioReady?: boolean;
    __studioRender?: (req: RenderRequest) => Promise<RenderResult>;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The headless renderer's page: one Stage at 1920×1080, driven by the engine through
 * `window.__studioRender({t, timeline?})`, which resolves once overlays are loaded, the video
 * has seeked and the frame is drawn. With `?export=1` the stage is in export mode: recorded
 * frames come exact from WebCodecs and the canvas is drawn once per request (exportFrameReady).
 * Opened by Playwright, never by people.
 */
export function RenderScreen({ slug }: { slug: string }) {
  const tl = useTimeline(slug);
  const exportMode = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('export') === '1';
  const { take, events, media } = useLatestTake(slug);
  const { registry, status } = useOverlayRegistry(slug);
  const [req, setReq] = useState<{
    t: number;
    timeline: Timeline | null;
    /** The canvases' commit counts before this request (export waits for the next commit). */
    commits: Map<number, number>;
    done: (r: RenderResult) => void;
  } | null>(null);
  const errors = useRef<Record<string, string>>({});
  const live = useRef({ registry, status });
  useEffect(() => {
    live.current = { registry, status };
  }, [registry, status]);

  const timeline = req?.timeline ?? tl.timeline;
  const resolved = useMemo(() => (timeline ? resolveTimeline(timeline, events) : null), [timeline, events]);
  const ready = !!(tl.timeline && take && resolved);

  useEffect(() => {
    if (!ready) return;
    window.__studioRender = (r) =>
      new Promise((done) => {
        errors.current = {};
        setReq({
          t: r.t,
          timeline: r.timeline ? parseTimeline(r.timeline) : null,
          commits: canvasCommits(),
          done,
        });
      });
    window.__studioReady = true;
    return () => {
      window.__studioReady = false;
    };
  }, [ready]);

  // After a request renders: wait for its components, the video seek and the drawn frame.
  useEffect(() => {
    if (!req || !timeline) return;
    let cancelled = false;
    void (async () => {
      const wanted = [...new Set(timeline.overlays.map((o) => o.component))];
      const until = performance.now() + 15_000;
      for (;;) {
        const { registry: reg, status: st } = live.current;
        if (wanted.every((c) => reg[c] || st[c]?.error) || performance.now() > until) break;
        await sleep(50);
      }
      if (exportMode) {
        // Exact recorded frames, then one explicit draw (the canvas doesn't render on its own).
        await exportFrameReady(req.t, req.commits).catch((e: unknown) => {
          errors.current.recording = e instanceof Error ? e.message : String(e);
        });
      } else await videosSettled();
      if (cancelled) return;
      const { status: st, registry: reg } = live.current;
      for (const c of wanted) {
        if (st[c]?.error) errors.current[c] = st[c]!.error!;
        else if (!reg[c]) errors.current[c] = 'the component did not load';
      }
      req.done({ errors: { ...errors.current } });
    })();
    return () => {
      cancelled = true;
    };
  }, [req, timeline, exportMode]);

  if (!take || !resolved || !timeline) return null;
  const src = media(take.video);
  if (!src) return null;
  const t = req?.t ?? 0;
  return (
    <div style={{ width: 1920, height: 1080 }}>
      <StageHost
        take={take}
        src={src}
        events={events}
        instances={resolved.instances}
        t={t}
        playing={false}
        sourceTime={resolved.sourceTime}
        registry={registry}
        captions={timeline.captions}
        layers={resolved.layersAt(t)}
        mode={exportMode ? 'export' : 'preview'}
        onOverlayError={(id, e) => {
          errors.current[id] = e.message;
        }}
      />
    </div>
  );
}
