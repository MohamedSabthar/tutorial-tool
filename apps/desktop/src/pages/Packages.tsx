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
import { Page } from '../shell';

const packages = [core, recorder, stage, overlaySdk, overlaysCore, scenesCore, tts, exporters, ui, engine];

export function PackagesPage() {
  return (
    <Page
      title="Step 0.1 · Monorepo scaffold"
      intro={`Every workspace package below is imported into this window. If you can see all ${packages.length} rows, the pnpm workspace, TypeScript references and Vite resolution are wired correctly.`}
    >
      <section aria-label="Workspace packages" className="panel">
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
                  <span className="chip chip-ok">✓ ok</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </Page>
  );
}
