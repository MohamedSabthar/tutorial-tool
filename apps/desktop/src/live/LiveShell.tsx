import { useEffect, useRef, useState } from 'react';
import type { RpcEventData } from '@studio/core';
import { AppHeader, Chip, EdgeAccent, MonoBox, Panel, Pill, Title } from '@studio/ui';
import { EngineChip, useEngine } from '../engine';

type Session = RpcEventData<'live.session'>;
type Action = RpcEventData<'live.action'>;

interface StepState {
  id: string;
  title: string;
  done: boolean;
}

/** The Live window: what the agent sees while it records, streamed from the engine. */
export function LiveShell() {
  const { client } = useEngine();
  const [session, setSession] = useState<Session | null>(null);
  const [frame, setFrame] = useState<{ src: string; latencyMs: number } | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!client) return;
    const offs = [
      client.on('live.session', (s) => {
        setSession(s);
        if (s.state === 'started' && !s.frame) {
          startedAt.current = Date.now();
          setSteps([]);
          setLog([]);
          setAction(null);
          setFrame(null);
        }
        if (s.state === 'stopped') {
          startedAt.current = null;
          setAction(null);
        }
      }),
      client.on('live.frame', (f) =>
        setFrame({ src: `data:image/jpeg;base64,${f.data}`, latencyMs: Date.now() - f.timestamp * 1000 }),
      ),
      client.on('live.action', setAction),
      client.on('recorder.event', (e) => {
        if (e.kind === 'step-start') setSteps((s) => [...s, { id: e.stepId, title: e.title, done: false }]);
        if (e.kind === 'step-end')
          setSteps((s) => s.map((x) => (x.id === e.stepId ? { ...x, done: true } : x)));
        if (e.kind === 'click' || e.kind === 'type' || e.kind === 'step-start')
          setLog((l) =>
            [
              ...l,
              `${e.t.toFixed(1).padStart(5)}s  ${
                e.kind === 'step-start'
                  ? `step ${e.stepId} · ${e.title}`
                  : e.kind === 'click'
                    ? `click · ${e.target}`
                    : `type · "${e.text}"`
              }`,
            ].slice(-40),
          );
      }),
      client.on('recorder.progress', (p) => setLog((l) => [...l, `        ${p.message}`].slice(-40))),
    ];
    return () => offs.forEach((off) => off());
  }, [client]);

  useEffect(() => {
    const t = setInterval(
      () => setElapsed(startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0),
      500,
    );
    return () => clearInterval(t);
  }, []);

  const running = session?.state === 'started';
  const fw = session?.frame?.width ?? 1;
  const fh = session?.frame?.height ?? 1;
  const mmss = `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <EdgeAccent />
      <AppHeader
        title="Tutorial Studio · Live"
        center={
          session ? (
            <Pill
              items={[
                running ? (
                  <Chip key="rec" tone={session.mode === 'record' ? 'error' : 'info'} dot>
                    {session.mode === 'record' ? `REC ${mmss}` : `DRY RUN ${mmss}`}
                  </Chip>
                ) : (
                  <Chip key="done">Finished</Chip>
                ),
                <strong key="t">{session.title}</strong>,
              ]}
            />
          ) : undefined
        }
        actions={<EngineChip />}
      />

      <main
        style={{
          flex: 1,
          background: 'var(--ui-gray-50)',
          padding: '12px 12px 12px 18px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'flex-start',
        }}
      >
        <Panel
          title="Live view"
          action={
            frame && (
              <span className="ui-mono" style={{ fontSize: 11, color: 'var(--ui-gray-600)' }}>
                CDP screencast · {Math.max(0, frame.latencyMs).toFixed(0)} ms behind
              </span>
            )
          }
          style={{ flex: '999 1 640px' }}
        >
          {frame ? (
            <div
              style={{
                position: 'relative',
                borderRadius: 10,
                overflow: 'hidden',
                border: '1px solid var(--ui-gray-300)',
              }}
            >
              <img
                src={frame.src}
                alt="Live view of WSO2 Integrator"
                style={{ display: 'block', width: '100%' }}
              />
              {running && action && session?.frame && (
                <>
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: `${(action.bbox.x / fw) * 100}%`,
                      top: `${(action.bbox.y / fh) * 100}%`,
                      width: `${(action.bbox.w / fw) * 100}%`,
                      height: `${(action.bbox.h / fh) * 100}%`,
                      border: '2px solid var(--ui-orange)',
                      borderRadius: 4,
                      background: 'rgba(255,88,0,0.08)',
                      transition: 'all var(--ui-base) var(--ui-ease)',
                    }}
                  />
                  <span
                    className="ui-mono"
                    style={{
                      position: 'absolute',
                      left: `${(action.bbox.x / fw) * 100}%`,
                      top: `calc(${(action.bbox.y / fh) * 100}% - 24px)`,
                      fontSize: 11,
                      color: 'var(--ui-white)',
                      background: 'var(--ui-orange)',
                      padding: '2px 6px',
                      borderRadius: 4,
                      whiteSpace: 'nowrap',
                      maxWidth: '60%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {action.label}
                  </span>
                </>
              )}
            </div>
          ) : (
            <div
              style={{
                padding: '48px 16px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <Title size={22} rule={false}>
                Waiting for a recording
              </Title>
              <p style={{ margin: 0, color: 'var(--ui-gray-600)', maxWidth: 460, lineHeight: 1.5 }}>
                Start one from the Studio window (step 1.2 · Recorder helpers → Run sample). The agent&apos;s
                view of WSO2 Integrator streams here.
              </p>
            </div>
          )}
          {steps.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
                gap: 6,
              }}
            >
              {steps.map((s, i) => {
                const active = !s.done && i === steps.length - 1 && running;
                return (
                  <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span
                      style={{
                        height: 5,
                        borderRadius: 3,
                        background: s.done
                          ? 'var(--ui-green)'
                          : active
                            ? 'var(--ui-orange)'
                            : 'var(--ui-gray-300)',
                      }}
                    />
                    <span
                      style={{
                        fontSize: 11,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        color: s.done
                          ? 'var(--ui-green-ink)'
                          : active
                            ? 'var(--ui-orange-ink)'
                            : 'var(--ui-gray-600)',
                      }}
                    >
                      {s.id} · {s.title}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title="Activity" style={{ flex: '1 1 320px', maxWidth: 420 }}>
          <MonoBox style={{ minHeight: 200, maxHeight: 520 }}>
            {log.length ? log.join('\n') : 'No activity yet.'}
          </MonoBox>
        </Panel>
      </main>
    </div>
  );
}
