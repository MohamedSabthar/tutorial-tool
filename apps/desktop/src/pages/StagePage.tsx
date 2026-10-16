import { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Stage, useFrame, usePlayer, useStageTime } from '@studio/stage';
import {
  Button,
  Chip,
  IconButton,
  IconPause,
  IconPlay,
  IconPrev,
  Panel,
  Scrubber,
  Segmented,
  Switch,
  tokens,
} from '@studio/ui';
import { Page } from '../shell';

const DURATION = 10;
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const ease = (u: number) => 1 - Math.pow(1 - Math.min(Math.max(u, 0), 1), 3);

/** A test composition: everything is computed from t, nothing from the wall clock. */
function TestCard() {
  const { t, width, height } = useStageTime();
  const frame = useFrame();
  const intro = ease(t / 0.8);
  const x = 160 + ((width - 320) * (Math.sin((t / DURATION) * Math.PI * 2 - Math.PI / 2) + 1)) / 2;
  const y = height * 0.62 + Math.sin(t * 3) * 60;
  return (
    <div style={{ position: 'absolute', inset: 0, fontFamily: tokens.font.sans, color: tokens.color.white }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(125% 95% at 50% 0%, #2B3E5E 0%, #18283F 40%, #0B1424 100%)',
        }}
      />
      <span
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 9,
          background: 'linear-gradient(0deg, #FF3900 0%, #FF5800 20%, rgba(255,88,0,0) 66%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 120,
          top: 110,
          opacity: intro,
          transform: `translateY(${(1 - intro) * 30}px)`,
        }}
      >
        <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: '-0.02em' }}>
          Stage test card<span style={{ color: tokens.color.orange }}>.</span>
        </div>
        <div style={{ width: 120 * intro, height: 4, background: tokens.color.orange, marginTop: 18 }} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 120,
          top: 330,
          fontFamily: tokens.font.mono,
          fontSize: 120,
          fontWeight: 500,
        }}
      >
        {fmt(t)}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 124,
          top: 480,
          fontFamily: tokens.font.mono,
          fontSize: 36,
          color: '#A9C6DD',
        }}
      >
        frame {frame} · {width}×{height}
      </div>
      <div
        style={{
          position: 'absolute',
          left: x - 40,
          top: y - 40,
          width: 80,
          height: 80,
          borderRadius: '50%',
          background: tokens.color.orange,
          boxShadow: '0 0 0 18px rgba(255,88,0,0.25)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 120,
          right: 120,
          bottom: 90,
          height: 10,
          borderRadius: 5,
          background: 'rgba(255,255,255,0.15)',
        }}
      >
        <div
          style={{
            width: `${(t / DURATION) * 100}%`,
            height: '100%',
            borderRadius: 5,
            background: tokens.color.white,
          }}
        />
      </div>
    </div>
  );
}

function checkDeterminism(): { ok: boolean; frames: number } {
  const times = Array.from({ length: 24 }, (_, i) => Math.round(((i * 7919) % 1000) * DURATION) / 1000);
  const render = (t: number) =>
    renderToStaticMarkup(
      <Stage t={t} mode="export">
        <TestCard />
      </Stage>,
    );
  const a = times.map(render);
  const b = [...times].reverse().map(render).reverse();
  return { ok: a.every((m, i) => m === b[i]), frames: times.length };
}

export function StagePage() {
  const [state, player] = usePlayer(DURATION);
  const [result, setResult] = useState<{ ok: boolean; frames: number } | null>(null);

  return (
    <Page
      title="Step 2.1 · Stage and virtual clock"
      intro="The stage renders a composition purely from time t on a fixed 1920×1080 surface, scaled to fit. The player drives t in real time; scrubbing sets it directly. The determinism check renders the same frames forward and backward and compares them."
    >
      <Panel
        title="Stage preview"
        action={
          <span className="ui-mono" style={{ fontSize: 12, color: 'var(--ui-gray-600)' }}>
            {fmt(state.t)} / {fmt(DURATION)} · {state.rate}× {state.playing ? '· playing' : ''}
          </span>
        }
      >
        <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--ui-gray-300)' }}>
          <Stage t={state.t}>
            <TestCard />
          </Stage>
        </div>
        <Scrubber
          value={state.t}
          max={DURATION}
          onChange={(t) => player.seek(t)}
          label="Stage time"
          format={fmt}
          height={30}
        >
          <div style={{ height: 12, borderRadius: 6, background: 'var(--ui-gray-100)' }} />
        </Scrubber>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <IconButton label="Back to start" onClick={() => player.seek(0)}>
            <IconPrev size={14} />
          </IconButton>
          <IconButton
            label={state.playing ? 'Pause' : 'Play'}
            variant="primary"
            onClick={() => player.toggle()}
          >
            {state.playing ? <IconPause size={14} /> : <IconPlay size={14} />}
          </IconButton>
          <Segmented
            label="Playback rate"
            options={[
              { value: '0.5', label: '0.5×' },
              { value: '1', label: '1×' },
              { value: '2', label: '2×' },
            ]}
            value={String(state.rate)}
            onChange={(v) => player.setRate(Number(v))}
          />
          <div style={{ width: 160 }}>
            <Switch label="Loop" checked={state.loop} onChange={(v) => player.setLoop(v)} />
          </div>
        </div>
      </Panel>

      <Panel
        title="Determinism"
        action={
          result && (
            <Chip tone={result.ok ? 'ok' : 'error'}>
              {result.ok ? `${result.frames} frames identical` : 'Frames differ'}
            </Chip>
          )
        }
      >
        <p style={{ margin: 0, color: 'var(--ui-gray-600)' }}>
          Renders 24 frames at scattered times in export mode, then renders them again in reverse order, and
          compares the markup.
        </p>
        <div>
          <Button onClick={() => setResult(checkDeterminism())}>Run determinism check</Button>
        </div>
      </Panel>
    </Page>
  );
}
