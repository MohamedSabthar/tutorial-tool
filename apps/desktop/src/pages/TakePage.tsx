import { useEffect, useRef, useState } from 'react';
import type { RecorderEvent, Rect, RpcResult } from '@studio/core';
import {
  Button,
  Chip,
  IconButton,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  Panel,
  Scrubber,
} from '@studio/ui';
import { useEngine } from '../engine';
import { Page } from '../shell';

type TakeResult = RpcResult<'recorder.recordSampleTake'>;
type Targeted = Extract<RecorderEvent, { kind: 'click' | 'type' }>;

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

export function TakePage() {
  const { client, state, info } = useEngine();
  const [result, setResult] = useState<TakeResult | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [shown, setShown] = useState<Targeted | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!client) return;
    return client.on('recorder.progress', (p) => setProgress(p.message));
  }, [client]);

  async function record() {
    if (!client) return;
    setRunning(true);
    setError(null);
    try {
      setResult(await client.call('recorder.recordSampleTake', {}));
      setShown(null);
      setT(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const take = result?.take;
  const src =
    result && info
      ? `http://127.0.0.1:${info.port}/media/${result.slug}/${result.takePath}/video.mp4?token=${encodeURIComponent(info.token)}`
      : null;
  const targeted = (result?.events.filter((e) => e.kind === 'click' || e.kind === 'type') ??
    []) as Targeted[];
  const frameNo = take ? Math.round(t * take.fps) : 0;

  function seek(time: number) {
    const v = video.current;
    if (!v) return;
    v.currentTime = time;
    setT(time);
  }

  // Show a target's box for a moment around its event time.
  const active = shown ?? targeted.find((e) => t >= e.t - 0.4 && t <= e.t + 0.4) ?? null;

  return (
    <Page
      title="Step 1.4 · Take post-processing"
      intro="Records the sample from the full-resolution CDP screencast and encodes a constant 30 fps H.264 MP4 with a keyframe every 0.5 s, so the editor can seek to any frame. Video time 0 is event time 0 (same clock), so jumping to an event should show its logged box exactly on the element."
    >
      <Panel
        title="Record a take"
        action={
          take && (
            <Chip tone="ok">{`${take.width}×${take.height} · ${take.fps} fps · ${take.duration.toFixed(1)} s`}</Chip>
          )
        }
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="primary" onClick={record} disabled={running || state !== 'open'}>
            {running ? 'Recording… (open the Live window to watch)' : 'Record sample take'}
          </Button>
          {running && progress && <span style={{ color: 'var(--ui-gray-600)' }}>{progress}</span>}
          {result && (
            <span className="ui-mono" style={{ fontSize: 12, color: 'var(--ui-gray-600)' }}>
              workspace/projects/{result.slug}/{result.takePath}/ · {result.codec} · {result.frames} frames
            </span>
          )}
        </div>
        {error && <Chip tone="error">{error}</Chip>}
      </Panel>

      {src && take && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
          <Panel title="video.mp4" style={{ flex: '999 1 640px' }}>
            <div
              style={{
                position: 'relative',
                borderRadius: 10,
                overflow: 'hidden',
                border: '1px solid var(--ui-gray-300)',
              }}
            >
              <video
                ref={video}
                src={src}
                preload="auto"
                muted
                playsInline
                style={{ display: 'block', width: '100%' }}
                onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
                onSeeked={(e) => setT(e.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
              />
              {active && (
                <BoxOverlay
                  bbox={active.bbox}
                  width={take.width}
                  height={take.height}
                  label={active.target}
                />
              )}
            </div>
            <Scrubber
              value={t}
              max={take.duration}
              onChange={(v) => {
                setShown(null);
                seek(v);
              }}
              label="Take time"
              format={fmt}
              height={34}
            >
              <div
                style={{ position: 'relative', height: 20, background: 'var(--ui-gray-50)', borderRadius: 6 }}
              >
                {targeted.map((e, i) => (
                  <span
                    key={i}
                    title={e.target}
                    style={{
                      position: 'absolute',
                      top: 4,
                      left: `calc(${(e.t / take.duration) * 100}% - 4px)`,
                      width: 8,
                      height: 12,
                      borderRadius: 2,
                      background: e.kind === 'type' ? 'var(--ui-steel)' : 'var(--ui-orange)',
                    }}
                  />
                ))}
              </div>
            </Scrubber>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <IconButton label="Previous frame" onClick={() => seek(Math.max(0, t - 1 / take.fps))}>
                <IconPrev size={14} />
              </IconButton>
              <IconButton
                label={playing ? 'Pause' : 'Play'}
                variant="primary"
                onClick={() => (playing ? video.current?.pause() : void video.current?.play())}
              >
                {playing ? <IconPause size={14} /> : <IconPlay size={14} />}
              </IconButton>
              <IconButton label="Next frame" onClick={() => seek(Math.min(take.duration, t + 1 / take.fps))}>
                <IconNext size={14} />
              </IconButton>
              <span className="ui-mono">
                {fmt(t)} · frame {frameNo} / {Math.round(take.duration * take.fps)}
              </span>
            </div>
          </Panel>

          <Panel title="Jump to an event" style={{ flex: '1 1 300px' }}>
            <p style={{ margin: 0, color: 'var(--ui-gray-600)' }}>
              Jumps to just before the action. The orange box is the logged bounding box; it should cover the
              element in the video frame.
            </p>
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
              {targeted.map((e, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className="ui-btn"
                    style={{ width: '100%', justifyContent: 'space-between', fontWeight: 500 }}
                    onClick={() => {
                      video.current?.pause();
                      setShown(e);
                      seek(Math.max(0, e.t - 0.05));
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {e.stepId} · {e.kind} · {e.target}
                    </span>
                    <span className="ui-mono" style={{ fontSize: 11 }}>
                      {fmt(e.t)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </Page>
  );
}

function BoxOverlay({
  bbox,
  width,
  height,
  label,
}: {
  bbox: Rect;
  width: number;
  height: number;
  label: string;
}) {
  return (
    <>
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: `${(bbox.x / width) * 100}%`,
          top: `${(bbox.y / height) * 100}%`,
          width: `${(bbox.w / width) * 100}%`,
          height: `${(bbox.h / height) * 100}%`,
          border: '2px solid var(--ui-orange)',
          borderRadius: 4,
        }}
      />
      <span
        className="ui-mono"
        style={{
          position: 'absolute',
          left: `${(bbox.x / width) * 100}%`,
          top: `calc(${(bbox.y / height) * 100}% - 22px)`,
          fontSize: 11,
          background: 'var(--ui-orange)',
          color: 'var(--ui-on-fill)',
          padding: '2px 6px',
          borderRadius: 4,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </>
  );
}
