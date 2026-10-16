import { useEffect, useState } from 'react';
import type { RpcResult } from '@studio/core';
import { Button, Chip, MonoBox, Panel, Stepper } from '@studio/ui';
import { openLiveWindow, useEngine } from '../engine';
import { Page } from '../shell';

type Run = RpcResult<'project.record'>;
const SLUG = 'demo-http';

export function ReferencePage() {
  const { client, state, info } = useEngine();
  const [script, setScript] = useState<string | null>(null);
  const [skill, setSkill] = useState<string | null>(null);
  const [running, setRunning] = useState<'dry' | 'record' | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client || state !== 'open') return;
    let cancelled = false;
    // Initializing is idempotent: it adds the seed skill and the demo-http project if missing.
    void (async () => {
      try {
        await client.call('workspace.init', {});
        const s = await client.call('workspace.read', { path: `projects/${SLUG}/script.spec.ts` });
        const k = await client.call('workspace.read', {
          path: '.claude/skills/wso2-integrator/pages/http-service.ts',
        });
        if (!cancelled) {
          setScript(s.text);
          setSkill(k.text);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    const off = client.on('recorder.progress', (p) => setProgress(p.message));
    return () => {
      cancelled = true;
      off();
    };
  }, [client, state]);

  async function start(mode: 'dry' | 'record') {
    if (!client) return;
    setRunning(mode);
    setError(null);
    setRun(null);
    try {
      setRun(await client.call('project.record', { slug: SLUG, mode }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
    }
  }

  const src =
    run?.take && run.takePath && info
      ? `http://127.0.0.1:${info.port}/media/${SLUG}/${run.takePath}/video.mp4?token=${encodeURIComponent(info.token)}`
      : null;

  return (
    <Page
      title="Step 1.5 · Reference tutorial"
      intro="A hand-written tutorial, “Create an HTTP service”, recorded end to end against WSO2 Integrator. It uses the seed wso2-integrator skill’s page objects (workspace/.claude/skills/wso2-integrator/pages) and is the template for agent-written scripts. Open the Live window to watch it run. The same run is available from a terminal: pnpm rec demo-http"
    >
      <Panel
        title="Run workspace/projects/demo-http"
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
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button onClick={() => openLiveWindow()}>Open Live window</Button>
          <Button onClick={() => start('dry')} disabled={!!running || state !== 'open'}>
            {running === 'dry' ? 'Dry run…' : 'Dry run'}
          </Button>
          <Button variant="primary" onClick={() => start('record')} disabled={!!running || state !== 'open'}>
            {running === 'record' ? 'Recording…' : 'Record take'}
          </Button>
          {running && progress && <span style={{ color: 'var(--ui-gray-600)' }}>{progress}</span>}
        </div>
        {error && <Chip tone="error">{error}</Chip>}
        {run?.failure && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Chip tone="error">
              {run.failure.stepId} · {run.failure.title}: {run.failure.error}
            </Chip>
            <img
              src={run.failure.dataUrl}
              alt="Window at the moment of failure"
              style={{ maxWidth: 720, borderRadius: 8 }}
            />
          </div>
        )}
      </Panel>

      {run && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
          <Panel title="Steps" style={{ flex: '1 1 300px' }}>
            <Stepper
              steps={run.steps.map((s) => ({
                label: s.title,
                sub: s.end === null ? 'failed' : `${s.start.toFixed(1)}–${s.end.toFixed(1)} s`,
                state: s.end === null ? 'failed' : 'done',
              }))}
            />
          </Panel>
          {src && run.take && (
            <Panel title={`${run.takePath}/video.mp4`} style={{ flex: '3 1 560px' }}>
              <video
                src={src}
                controls
                muted
                playsInline
                style={{ width: '100%', borderRadius: 10, border: '1px solid var(--ui-gray-300)' }}
              />
              <span className="ui-mono" style={{ fontSize: 12, color: 'var(--ui-gray-600)' }}>
                {run.take.width}×{run.take.height} · {run.take.fps} fps · {run.take.duration.toFixed(1)} s ·{' '}
                {run.codec} · registered in tutorial.json and committed
              </span>
            </Panel>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <Panel title="projects/demo-http/script.spec.ts" style={{ flex: '1 1 460px' }}>
          <MonoBox style={{ maxHeight: 420 }}>{script ?? 'Loading…'}</MonoBox>
        </Panel>
        <Panel title=".claude/skills/wso2-integrator/pages/http-service.ts" style={{ flex: '1 1 460px' }}>
          <MonoBox style={{ maxHeight: 420 }}>{skill ?? 'Loading…'}</MonoBox>
        </Panel>
      </div>
    </Page>
  );
}
