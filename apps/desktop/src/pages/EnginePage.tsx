import { useEffect, useRef, useState } from 'react';
import { createEngineClient, type ConnectionState, type EngineClient, type Project } from '@studio/core';
import { Page } from '../shell';

const DEFAULT_URL = 'ws://127.0.0.1:4317/rpc';
const DEFAULT_TOKEN = 'dev-token';

export function EnginePage() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [token, setToken] = useState(DEFAULT_TOKEN);
  const [client, setClient] = useState<EngineClient | null>(null);
  const [state, setState] = useState<ConnectionState>('closed');
  const [ping, setPing] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [title, setTitle] = useState('Create an HTTP service');
  const [opened, setOpened] = useState<string | null>(null);
  const [media, setMedia] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const clientRef = useRef<EngineClient | null>(null);

  useEffect(() => () => clientRef.current?.close(), []);

  function connect() {
    clientRef.current?.close();
    const c = createEngineClient({ url, token });
    clientRef.current = c;
    setClient(c);
    c.onState(setState);
    c.on('project.changed', (d) => setEvents((ev) => [`project.changed · ${d.slug}`, ...ev].slice(0, 6)));
    void refresh(c);
  }

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      setError(null);
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    }
  }

  async function refresh(c = client) {
    if (!c) return;
    const list = await run(() => c.call('project.list', {}));
    if (list) setProjects(list);
  }

  async function doPing() {
    if (!client) return;
    const r = await run(() => client.call('ping', { sentAt: performance.now() }));
    if (r)
      setPing(
        `${(performance.now() - r.sentAt).toFixed(1)} ms · engine v${r.engineVersion} · ${r.workspace}`,
      );
  }

  async function create() {
    if (!client) return;
    const p = await run(() => client.call('project.create', { title, product: 'wso2-integrator' }));
    if (p) await refresh();
  }

  async function open(slug: string) {
    if (!client) return;
    const r = await run(() => client.call('project.open', { slug }));
    if (r) setOpened(JSON.stringify(r, null, 2));
  }

  async function testMedia(slug: string) {
    const http = url.replace(/^ws/, 'http').replace(/\/rpc$/, '');
    await run(async () => {
      const res = await fetch(`${http}/media/${slug}/project.json?token=${encodeURIComponent(token)}`, {
        headers: { range: 'bytes=0-31' },
      });
      setMedia(
        `${res.status} ${res.statusText} · content-range: ${res.headers.get('content-range')}\n${await res.text()}`,
      );
    });
  }

  const stateChip = state === 'open' ? 'chip chip-ok' : state === 'connecting' ? 'chip' : 'chip chip-err';

  return (
    <Page
      title="Step 0.3 · Engine and RPC"
      intro="The engine is the Node sidecar. In a terminal, run `pnpm engine` (it listens on port 4317 with the dev token), then connect here. In step 0.4 the app starts the engine itself."
    >
      <section className="panel panel-pad" aria-label="Connection">
        <h2 className="panel-title">Connection</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 280px' }}>
            WebSocket URL
            <input className="field mono" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 1 200px' }}>
            Token
            <input className="field mono" value={token} onChange={(e) => setToken(e.target.value)} />
          </label>
          <button type="button" className="btn btn-primary" onClick={connect}>
            {client ? 'Reconnect' : 'Connect'}
          </button>
          <span className={stateChip}>{state}</span>
          <button type="button" className="btn" onClick={doPing} disabled={state !== 'open'}>
            Ping
          </button>
        </div>
        {ping && (
          <p className="mono" style={{ margin: '12px 0 0', fontSize: 12 }}>
            {ping}
          </p>
        )}
        {error && (
          <p role="alert" className="chip chip-err" style={{ marginTop: 12 }}>
            {error}
          </p>
        )}
      </section>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
        <section className="panel panel-pad" style={{ flex: '1 1 420px' }} aria-label="Projects">
          <h2 className="panel-title">Projects</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <label
              style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}
              htmlFor="new-title"
            >
              New project title
            </label>
            <input
              id="new-title"
              className="field"
              style={{ flex: 1 }}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <button type="button" className="btn btn-primary" onClick={create} disabled={state !== 'open'}>
              Create
            </button>
            <button type="button" className="btn" onClick={() => refresh()} disabled={state !== 'open'}>
              Refresh
            </button>
          </div>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '12px 0 0',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {projects.length === 0 && <li style={{ color: 'var(--gray-600)' }}>No projects yet.</li>}
            {projects.map((p) => (
              <li
                key={p.slug}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: 10,
                  borderRadius: 10,
                  background: 'var(--gray-50)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: 'var(--navy)' }}>{p.title}</div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--gray-600)' }}>
                    {p.slug} · {p.status} · {new Date(p.updatedAt).toLocaleString()}
                  </div>
                </div>
                <button type="button" className="btn" onClick={() => open(p.slug)}>
                  Open
                </button>
                <button type="button" className="btn" onClick={() => testMedia(p.slug)}>
                  Range test
                </button>
              </li>
            ))}
          </ul>
          {events.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <span className="eyebrow">Events</span>
              {events.map((e, i) => (
                <div key={i} className="mono" style={{ fontSize: 12 }}>
                  {e}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel panel-pad" style={{ flex: '1 1 420px', minWidth: 0 }} aria-label="Results">
          <h2 className="panel-title">Results</h2>
          {media && (
            <pre
              className="mono"
              style={{
                margin: '0 0 12px',
                fontSize: 11,
                background: 'var(--gray-50)',
                padding: 10,
                borderRadius: 9,
                whiteSpace: 'pre-wrap',
              }}
            >
              {media}
            </pre>
          )}
          <pre
            className="mono"
            style={{
              margin: 0,
              maxHeight: 380,
              overflow: 'auto',
              fontSize: 11,
              background: 'var(--gray-50)',
              padding: 10,
              borderRadius: 9,
            }}
          >
            {opened ?? 'Open a project to see project.json and tutorial.json.'}
          </pre>
        </section>
      </div>
    </Page>
  );
}
