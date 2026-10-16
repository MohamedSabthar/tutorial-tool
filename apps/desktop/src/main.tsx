import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DevShell, type DevRoute } from './shell';
import { EngineProvider } from './engine';
import { LiveShell } from './live/LiveShell';
import { StudioScreen } from './studio/StudioScreen';
import { PackagesPage } from './pages/Packages';
import { TimelinePlayground } from './pages/TimelinePlayground';
import { EnginePage } from './pages/EnginePage';
import { DesktopPage } from './pages/DesktopPage';
import { KitPage } from './pages/KitPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { LauncherPage } from './pages/LauncherPage';
import { RecorderPage } from './pages/RecorderPage';
import { TakePage } from './pages/TakePage';
import { ReferencePage } from './pages/ReferencePage';
import { StagePage } from './pages/StagePage';
import { VideoPlanePage } from './pages/VideoPlanePage';
import { SdkPage } from './pages/SdkPage';
import { GalleryPage } from './pages/GalleryPage';
import { HotReloadPage } from './pages/HotReloadPage';
import { TimelineSyncPage } from './pages/TimelineSyncPage';
import '@studio/ui/styles.css';
import './styles.css';
import { registerSharedModules } from './studio/shared';

registerSharedModules();

const routes: DevRoute[] = [
  { path: '/packages', step: '0.1', label: 'Packages', render: () => <PackagesPage /> },
  { path: '/timeline', step: '0.2', label: 'Timeline core', render: () => <TimelinePlayground /> },
  { path: '/engine', step: '0.3', label: 'Engine and RPC', render: () => <EnginePage /> },
  { path: '/desktop', step: '0.4', label: 'Desktop shell', render: () => <DesktopPage /> },
  { path: '/kit', step: '0.5', label: 'Design kit', render: () => <KitPage /> },
  { path: '/workspace', step: '0.6', label: 'Workspace', render: () => <WorkspacePage /> },
  { path: '/launcher', step: '1.1', label: 'Integrator launcher', render: () => <LauncherPage /> },
  { path: '/recorder', step: '1.2', label: 'Recorder helpers', render: () => <RecorderPage /> },
  { path: '/take', step: '1.4', label: 'Take (MP4)', render: () => <TakePage /> },
  { path: '/reference', step: '1.5', label: 'Reference tutorial', render: () => <ReferencePage /> },
  { path: '/stage', step: '2.1', label: 'Stage and clock', render: () => <StagePage /> },
  { path: '/video', step: '2.2', label: 'Video plane & camera', render: () => <VideoPlanePage /> },
  { path: '/sdk', step: '2.3', label: 'Overlay SDK', render: () => <SdkPage /> },
  { path: '/gallery', step: '2.4', label: 'Core overlays', render: () => <GalleryPage /> },
  { path: '/hot', step: '2.5', label: 'Overlay hot-loading', render: () => <HotReloadPage /> },
  { path: '/timeline-sync', step: '2.6', label: 'Timeline sync & undo', render: () => <TimelineSyncPage /> },
  { path: '/studio-link', step: '2.7', label: 'Studio (demo-http)', render: () => <StudioLink /> },
];

/** Opens the real Studio screen (full window) for the reference project. */
function StudioLink() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 640 }}>
      <h1 style={{ margin: 0, color: 'var(--ui-navy)' }}>Step 2.7 · Studio</h1>
      <p style={{ margin: 0, color: 'var(--ui-gray-600)', lineHeight: 1.5 }}>
        The Studio is a full-window screen. It opens on the demo-http project; use the header’s Projects icon
        to come back here.
      </p>
      <a
        className="ui-btn ui-btn-primary"
        href="#/studio/demo-http"
        onClick={() => setTimeout(() => window.location.reload(), 0)}
      >
        Open the Studio
      </a>
    </div>
  );
}

const isLive = window.location.hash.startsWith('#/live');
const studioSlug = /^#\/studio\/([a-z0-9-]+)/.exec(window.location.hash)?.[1];

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EngineProvider>
      {isLive ? (
        <LiveShell />
      ) : studioSlug ? (
        <StudioScreen slug={studioSlug} />
      ) : (
        <DevShell routes={routes} />
      )}
    </EngineProvider>
  </StrictMode>,
);
