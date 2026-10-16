import { useEffect, useState } from 'react';
import { PACKAGE as core } from '@studio/core';
import { PACKAGE as recorder } from '@studio/recorder';
import { PACKAGE as stage } from '@studio/stage';
import { PACKAGE as overlaySdk } from '@studio/overlay-sdk';
import { PACKAGE as overlaysCore } from '@studio/overlays-core';
import { PACKAGE as scenesCore } from '@studio/scenes-core';
import { PACKAGE as tts } from '@studio/tts';
import { PACKAGE as exporters } from '@studio/exporters';
import { PACKAGE as ui } from '@studio/ui';
import { PACKAGE as engine } from '@studio/engine';
import mark from './mark-wso2-orange.png';

const packages = [core, recorder, stage, overlaySdk, overlaysCore, scenesCore, tts, exporters, ui, engine];

type Runtime = { kind: 'tauri'; version: string; tauri: string } | { kind: 'browser' } | { kind: 'loading' };

async function detectRuntime(): Promise<Runtime> {
  if (!('__TAURI_INTERNALS__' in window)) return { kind: 'browser' };
  const { getVersion, getTauriVersion } = await import('@tauri-apps/api/app');
  return { kind: 'tauri', version: await getVersion(), tauri: await getTauriVersion() };
}

export function App() {
  const [runtime, setRuntime] = useState<Runtime>({ kind: 'loading' });

  useEffect(() => {
    detectRuntime().then(setRuntime, () => setRuntime({ kind: 'browser' }));
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 6,
          background: 'linear-gradient(0deg, #FF3900 0%, #FF5800 20%, rgba(255,88,0,0) 66%)',
        }}
      />
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 24px',
          borderBottom: '1px solid var(--gray-300)',
        }}
      >
        <img src={mark} alt="WSO2" width={24} height={24} />
        <span style={{ fontWeight: 700, color: 'var(--navy)', letterSpacing: '-0.02em' }}>
          Tutorial Studio
        </span>
        <span style={{ flex: 1 }} />
        <RuntimeChip runtime={runtime} />
      </header>

      <main style={{ flex: 1, background: 'var(--gray-50)', padding: '32px 40px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 30, color: 'var(--navy)', letterSpacing: '-0.02em' }}>
              Step 0.1 · Monorepo scaffold<span style={{ color: 'var(--orange)' }}>.</span>
            </h1>
            <span
              aria-hidden="true"
              style={{ display: 'block', width: 48, height: 2, background: 'var(--orange)', marginTop: 8 }}
            />
            <p style={{ color: 'var(--gray-600)', lineHeight: 1.5 }}>
              Every workspace package below is imported into this window. If you can see all {packages.length}{' '}
              rows, the pnpm workspace, TypeScript references and Vite resolution are wired correctly.
            </p>
          </div>

          <section
            aria-label="Workspace packages"
            style={{ background: 'var(--white)', border: '1px solid var(--gray-300)', borderRadius: 14 }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--gray-600)' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Package</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Role</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Linked</th>
                </tr>
              </thead>
              <tbody>
                {packages.map((p) => (
                  <tr key={p.name} style={{ borderTop: '1px solid #F0F0F0' }}>
                    <td className="mono" style={{ padding: '10px 16px', color: 'var(--navy)' }}>
                      {p.name}
                    </td>
                    <td style={{ padding: '10px 16px' }}>{p.role}</td>
                    <td style={{ padding: '10px 16px' }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '3px 9px',
                          borderRadius: 999,
                          background: 'var(--green-bg)',
                          color: 'var(--green)',
                        }}
                      >
                        ✓ ok
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </main>
    </div>
  );
}

function RuntimeChip({ runtime }: { runtime: Runtime }) {
  const text =
    runtime.kind === 'tauri'
      ? `Tauri ${runtime.tauri} · app v${runtime.version}`
      : runtime.kind === 'browser'
        ? 'Browser (not inside Tauri)'
        : 'Detecting runtime…';
  const ok = runtime.kind === 'tauri';
  return (
    <span
      className="mono"
      style={{
        fontSize: 12,
        padding: '4px 10px',
        borderRadius: 999,
        border: '1px solid var(--gray-300)',
        background: ok ? 'var(--green-bg)' : 'var(--gray-50)',
        color: ok ? 'var(--green)' : 'var(--gray-600)',
      }}
    >
      {text}
    </span>
  );
}
