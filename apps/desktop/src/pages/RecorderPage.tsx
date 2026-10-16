import { useEffect, useState } from 'react';
import type { RecorderEvent, RpcResult } from '@studio/core';
import { Button, Chip, MonoBox, Panel, Segmented } from '@studio/ui';
import { useEngine } from '../engine';
import { Page } from '../shell';

type Run = RpcResult<'recorder.runSample'>;
type Frame = Run['targetFrames'][number];

function describeEvent(e: RecorderEvent): string {
  switch (e.kind) {
    case 'marker':
      return `marker · ${e.name}`;
    case 'step-start':
      return `step ${e.stepId} · ${e.title}`;
    case 'step-end':
      return `step ${e.stepId} done`;
    case 'mouse':
      return `mouse path · ${e.points.length} points`;
    case 'click':
      return `click · ${e.target} @ ${Math.round(e.x)},${Math.round(e.y)}`;
    case 'type':
      return `type · "${e.text}" into ${e.target}`;
    case 'key':
      return `key · ${e.key}`;
    case 'mask':
      return `mask · ${e.label}`;
    case 'hold':
      return `hold · ${e.duration}s`;
  }
}

/** A captured frame with the logged target box drawn on top, at the frame's own scale. */
function TargetFrameView({ frame, width, height }: { frame: Frame; width: number; height: number }) {
  const { x, y, w, h } = frame.bbox;
  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        style={{
          position: 'relative',
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid var(--ui-gray-300)',
        }}
      >
        <img
          src={frame.dataUrl}
          alt={`Window when locating ${frame.target}`}
          style={{ display: 'block', width: '100%' }}
        />
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: `${(x / width) * 100}%`,
            top: `${(y / height) * 100}%`,
            width: `${(w / width) * 100}%`,
            height: `${(h / height) * 100}%`,
            border: '2px solid var(--ui-orange)',
            borderRadius: 3,
            boxShadow: '0 0 0 9999px rgba(19,33,59,0.18)',
          }}
        />
      </div>
      <figcaption style={{ fontSize: 12 }}>
        <strong style={{ color: 'var(--ui-navy)' }}>{frame.stepId}</strong> · {frame.target}
      </figcaption>
    </figure>
  );
}

export function RecorderPage() {
  const { client, state } = useEngine();
  const [variant, setVariant] = useState<'record' | 'dry' | 'broken'>('record');
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState<string[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    const offEvent = client.on('recorder.event', (e) =>
      setLive((l) => [...l, `${e.t.toFixed(2).padStart(6)}s  ${describeEvent(e)}`].slice(-60)),
    );
    const offProgress = client.on('recorder.progress', (p) =>
      setLive((l) => [...l, `        ${p.message}`].slice(-60)),
    );
    return () => {
      offEvent();
      offProgress();
    };
  }, [client]);

  async function start() {
    if (!client) return;
    setRunning(true);
    setError(null);
    setLive([]);
    setRun(null);
    try {
      setRun(
        await client.call('recorder.runSample', {
          mode: variant === 'record' ? 'record' : 'dry',
          broken: variant === 'broken',
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const frameW = run ? run.viewport.width * run.viewport.scale : 1;
  const frameH = run ? run.viewport.height * run.viewport.scale : 1;

  return (
    <Page
      title="Step 1.2 · Recorder helpers"
      intro="Runs a hand-written sample tutorial against WSO2 Integrator with the tut helpers. Steps: Explorer → WSO2 Integrator view → open the integration → type into the Copilot prompt (inside the webview) → click “Add Artifact manually”. Record mode moves and types at a human pace; dry mode runs fast to validate. Every action is logged to events.jsonl in frame pixels."
    >
      <Panel
        title="Run the sample"
        action={
          run && (
            <Chip tone={run.passed ? 'ok' : 'error'}>
              {run.passed
                ? `Passed · ${(run.durationMs / 1000).toFixed(1)} s`
                : `Failed at ${run.failure?.stepId}`}
            </Chip>
          )
        }
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <Segmented
            label="Mode"
            options={[
              { value: 'record', label: 'Record (human pace)' },
              { value: 'dry', label: 'Dry run' },
              { value: 'broken', label: 'Dry run · broken locator' },
            ]}
            value={variant}
            onChange={setVariant}
          />
          <Button variant="primary" onClick={start} disabled={running || state !== 'open'}>
            {running ? 'Running… (WSO2 Integrator opens full screen)' : 'Run sample'}
          </Button>
        </div>
        {error && <Chip tone="error">{error}</Chip>}
        {live.length > 0 && <MonoBox style={{ maxHeight: 220 }}>{live.join('\n')}</MonoBox>}
        {run && (
          <span className="ui-mono" style={{ fontSize: 12, color: 'var(--ui-gray-600)' }}>
            events written to {run.eventsFile}
          </span>
        )}
      </Panel>

      {run?.failure && (
        <Panel title={`Failure report · step ${run.failure.stepId}: ${run.failure.title}`}>
          <Chip tone="error">{run.failure.error}</Chip>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <img
              src={run.failure.dataUrl}
              alt="Window at the moment of failure"
              style={{
                flex: '2 1 480px',
                minWidth: 0,
                borderRadius: 8,
                border: '1px solid var(--ui-gray-300)',
              }}
            />
            <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="ui-eyebrow">Webview ARIA snapshot</span>
              <MonoBox style={{ maxHeight: 200 }}>
                {run.failure.webviewAriaSnapshot || '(no webview)'}
              </MonoBox>
              <span className="ui-eyebrow">Window ARIA snapshot</span>
              <MonoBox style={{ maxHeight: 200 }}>{run.failure.ariaSnapshot}</MonoBox>
            </div>
          </div>
        </Panel>
      )}

      {run && run.targetFrames.length > 0 && (
        <Panel title="Logged target boxes">
          <p style={{ margin: 0, color: 'var(--ui-gray-600)' }}>
            Each frame was captured when the target was located. The orange box is the bounding box written to
            events.jsonl; it should sit exactly on the element, including inside the webview.
          </p>
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}
          >
            {run.targetFrames.map((f, i) => (
              <TargetFrameView key={i} frame={f} width={frameW} height={frameH} />
            ))}
          </div>
        </Panel>
      )}

      {run && (
        <Panel title={`events.jsonl · ${run.events.length} events`}>
          <MonoBox style={{ maxHeight: 360 }}>
            {run.events
              .map((e) =>
                JSON.stringify(e.kind === 'mouse' ? { ...e, points: `[${e.points.length} points]` } : e),
              )
              .join('\n')}
          </MonoBox>
        </Panel>
      )}
    </Page>
  );
}
