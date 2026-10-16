import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DevShell, type DevRoute } from './shell';
import { PackagesPage } from './pages/Packages';
import { TimelinePlayground } from './pages/TimelinePlayground';
import { EnginePage } from './pages/EnginePage';
import './styles.css';

const routes: DevRoute[] = [
  { path: '/packages', step: '0.1', label: 'Packages', render: () => <PackagesPage /> },
  { path: '/timeline', step: '0.2', label: 'Timeline core', render: () => <TimelinePlayground /> },
  { path: '/engine', step: '0.3', label: 'Engine and RPC', render: () => <EnginePage /> },
];

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DevShell routes={routes} />
  </StrictMode>,
);
