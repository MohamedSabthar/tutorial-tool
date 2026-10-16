import { useEffect, useMemo, useState } from 'react';
import { RecorderEvent, type Take } from '@studio/core';
import {
  cameraAt,
  CameraProvider,
  DomLayer,
  fitSource,
  restCamera,
  Scene3D,
  sourceToStage,
  Stage,
  usePlayer,
  VideoPlane,
  type CameraMove,
} from '@studio/stage';
import {
  Button,
  Chip,
  IconButton,
  IconPause,
  IconPlay,
  IconPrev,
  Panel,
  Scrubber,
  Switch,
  tokens,
} from '@studio/ui';
import { useEngine } from '../engine';
import { Page } from '../shell';

const STAGE = { width: 1920, height: 1080 };
const SLUG = 'demo-http';
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
type Targeted = Extract<RecorderEvent, { kind: 'click' | 'type' }>;

function useFps(active: boolean) {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    if (!active) return;
    let frames = 0;
    let id = 0;
    const start = performance.now();
    const loop = () => {
      frames++;
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    const iv = setInterval(() => setFps(Math.round((frames * 1000) / (performance.now() - start))), 500);
    return () => {
      cancelAnimationFrame(id);
      clearInterval(iv);
    };
  }, [active]);
  return fps;
}

export function VideoPlanePage() {
  const { client, state: conn, info } = useEngine();
  const [take, setTake] = useState<Take | null>(null);
  const [events, setEvents] = useState<RecorderEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [zoomOn, setZoomOn] = useState(true);
  const [boxesOn, setBoxesOn] = useState(true);
  const [player, controls] = usePlayer(take?.duration ?? 1);
  const fps = useFps(player.playing);

  const media = (rel: string) =>
    info
      ? `http://127.0.0.1:${info.port}/media/${SLUG}/${rel}?token=${encodeURIComponent(info.token)}`
      : null;

  async function load() {
    if (!client) return;
    setError(null);
    try {
      const { timeline } = await client.call('project.open', { slug: SLUG });
      const latest = timeline.takes[timeline.takes.length - 1];
      if (!latest) throw new Error('No take yet: record one on page 1.5 first.');
      const url = media(latest.events);
      const text = url ? await (await fetch(url)).text() : '';
      setEvents(
        text
          .split('\n')
          .filter(Boolean)
          .map((l) => RecorderEvent.parse(JSON.parse(l))),
      );
      setTake(latest);
      controls.seek(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    // Load once when connected (deferred so the effect only schedules work).
    if (conn === 'open' && client && !take) void Promise.resolve().then(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, client]);

  const targets = useMemo(
    () => events.filter((e): e is Targeted => e.kind === 'click' || e.kind === 'type'),
    [events],
  );
  const fit = useMemo(() => (take ? fitSource(take, STAGE) : null), [take]);
  const moves = useMemo<CameraMove[]>(() => {
    if (!fit || !zoomOn) return [];
    return (
      targets
        .filter((e) => e.kind === 'click')
        .map((e) => {
          const r = sourceToStage(e.bbox, fit);
          return {
            start: e.t - 0.6,
            end: e.t + 1.6,
            ease: 0.5,
            to: { zoom: 1.9, focusX: r.x + r.w / 2, focusY: r.y + r.h / 2 },
          };
        })
        // Keep moves from overlapping: each ends before the next starts.
        .map((m, i, all) => (all[i + 1] && m.end > all[i + 1]!.start ? { ...m, end: all[i + 1]!.start } : m))
    );
  }, [targets, fit, zoomOn]);

  const camera = fit ? cameraAt(player.t, moves, restCamera(STAGE), fit.rect, STAGE) : restCamera(STAGE);
  const src = take ? media(take.video) : null;
  const visible = targets.filter((e) => player.t >= e.t - 0.8 && player.t <= e.t + 1.2);

  return (
    <Page
      title="Step 2.2 · Video plane and camera"
      intro="The latest demo-http take plays as a texture on a GPU plane inside the 16:9 stage (letterboxed). The camera zooms onto each click target; orange boxes are HTML in a camera-following layer, anchored to the logged bounding boxes, and should stay locked onto their elements through every zoom."
    >
      <Panel
        title={take ? `${SLUG} · ${take.id}` : 'Loading take…'}
        action={
          <span style={{ display: 'flex', gap: 8 }}>
            {player.playing && <Chip tone={fps >= 55 ? 'ok' : 'active'} mono>{`${fps} fps`}</Chip>}
            <Chip mono>{`zoom ${camera.zoom.toFixed(2)}×`}</Chip>
          </span>
        }
      >
        {error && <Chip tone="error">{error}</Chip>}
        {take && src && fit && (
          <>
            <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--ui-gray-300)' }}>
              <Stage t={player.t} {...STAGE}>
                <CameraProvider camera={camera} source={take}>
                  <Scene3D>
                    <VideoPlane
                      src={src}
                      sourceTime={Math.min(player.t, take.duration - 0.01)}
                      playing={player.playing}
                    />
                  </Scene3D>
                  {boxesOn && (
                    <DomLayer follow>
                      {visible.map((e, i) => {
                        const r = sourceToStage(e.bbox, fit);
                        return (
                          <div
                            key={i}
                            style={{
                              position: 'absolute',
                              left: r.x - 4,
                              top: r.y - 4,
                              width: r.w + 8,
                              height: r.h + 8,
                              border: `3px solid ${tokens.color.orange}`,
                              borderRadius: 8,
                            }}
                          />
                        );
                      })}
                    </DomLayer>
                  )}
                  <DomLayer>
                    <div
                      style={{
                        position: 'absolute',
                        right: 24,
                        bottom: 20,
                        fontFamily: tokens.font.mono,
                        fontSize: 26,
                        color: tokens.color.white,
                        background: 'rgba(12,21,38,0.75)',
                        padding: '6px 12px',
                        borderRadius: 8,
                      }}
                    >
                      {fmt(player.t)}
                    </div>
                  </DomLayer>
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
                {moves.map((m, i) => (
                  <span
                    key={i}
                    style={{
                      position: 'absolute',
                      top: 2,
                      height: 10,
                      left: `${(m.start / take.duration) * 100}%`,
                      width: `${((m.end - m.start) / take.duration) * 100}%`,
                      background: 'var(--ui-steel-300)',
                      borderRadius: 3,
                    }}
                  />
                ))}
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
              <div style={{ width: 200 }}>
                <Switch label="Camera zooms" checked={zoomOn} onChange={setZoomOn} />
              </div>
              <div style={{ width: 200 }}>
                <Switch label="Anchored boxes" checked={boxesOn} onChange={setBoxesOn} />
              </div>
              <Button size="sm" onClick={load}>
                Reload latest take
              </Button>
            </div>
          </>
        )}
      </Panel>
    </Page>
  );
}
