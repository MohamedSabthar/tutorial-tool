import { useEffect, useState } from 'react';
import { currentWindowLabel, EngineChip, useEngine } from '../engine';
import { AppHeader, EdgeAccent, Title } from '@studio/ui';

/** The Live window. Filled in by steps 1.3 (screencast) and 1.6 (layout). */
export function LiveShell() {
  const { info } = useEngine();
  const [label, setLabel] = useState('…');
  useEffect(() => {
    currentWindowLabel().then(setLabel, () => setLabel('unknown'));
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <EdgeAccent />
      <AppHeader title="Tutorial Studio · Live" actions={<EngineChip />} />
      <main
        style={{ flex: 1, background: 'var(--gray-50)', display: 'grid', placeItems: 'center', padding: 32 }}
      >
        <div className="panel panel-pad" style={{ maxWidth: 520, textAlign: 'center' }}>
          <Title size={24} rule={false}>
            Live window
          </Title>
          <p style={{ color: 'var(--gray-600)', lineHeight: 1.5 }}>
            The agent&apos;s recording will stream here. This window has its own engine connection.
          </p>
          <p className="mono" style={{ fontSize: 12, margin: 0 }}>
            window: {label} · engine port: {info?.port ?? '…'}
          </p>
        </div>
      </main>
    </div>
  );
}
