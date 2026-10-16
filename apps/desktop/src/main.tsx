import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DevShell, type DevRoute } from './shell';
import { EngineProvider } from './engine';
import { LiveShell } from './live/LiveShell';
import { PackagesPage } from './pages/Packages';
import { TimelinePlayground } from './pages/TimelinePlayground';
import { EnginePage } from './pages/EnginePage';
import { DesktopPage } from './pages/DesktopPage';
import { KitPage } from './pages/KitPage';
import { WorkspacePage } from './pages/WorkspacePage';
import '@studio/ui/styles.css';
import './styles.css';

const routes: DevRoute[] = [
  { path: '/packages', step: '0.1', label: 'Packages', render: () => <PackagesPage /> },
  { path: '/timeline', step: '0.2', label: 'Timeline core', render: () => <TimelinePlayground /> },
  { path: '/engine', step: '0.3', label: 'Engine and RPC', render: () => <EnginePage /> },
  { path: '/desktop', step: '0.4', label: 'Desktop shell', render: () => <DesktopPage /> },
  { path: '/kit', step: '0.5', label: 'Design kit', render: () => <KitPage /> },
  { path: '/workspace', step: '0.6', label: 'Workspace', render: () => <WorkspacePage /> },
];

const isLive = window.location.hash.startsWith('#/live');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EngineProvider>{isLive ? <LiveShell /> : <DevShell routes={routes} />}</EngineProvider>
  </StrictMode>,
);
