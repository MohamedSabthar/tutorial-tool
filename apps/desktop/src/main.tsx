import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DevShell, useHashPath, type DevRoute } from './shell';
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
import { VoicePage } from './pages/VoicePage';
import { ProjectsScreen } from './routes/projects/ProjectsScreen';
import { BriefScreen } from './routes/brief/BriefScreen';
import { StoryboardScreen } from './routes/storyboard/StoryboardScreen';
import { RenderScreen } from './render/RenderScreen';
import { AgentFixScreen } from './routes/agentfix/AgentFixScreen';
import { ExportScreen } from './routes/export/ExportScreen';
import { SettingsScreen } from './routes/settings/SettingsScreen';
import '@studio/ui/styles.css';
import './styles.css';
import './routes/routes.css';
import { registerSharedModules } from './studio/shared';

registerSharedModules();

/** A focused element that Backspace edits (not a read-only or disabled field). */
function editable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement)
    return (
      !el.readOnly &&
      !el.disabled &&
      ['text', 'search', 'email', 'url', 'password', 'number', 'tel', ''].includes(el.type)
    );
  return false;
}

// The macOS webview goes back in history on Backspace outside a text field, which jumps to the
// previous screen. Backspace only edits text here, or deletes what the screen has selected
// (the Studio's own shortcut still sees the key).
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Backspace' && !editable(e.target)) e.preventDefault();
  },
  { capture: true },
);

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
  // Handled by <App> (the real home screen); listed so the developer shell links to it.
  { path: '/projects', step: '3.8', label: 'Projects (app home)', render: () => null },
  { path: '/voice', step: '4.1', label: 'Voice (ElevenLabs)', render: () => <VoicePage /> },
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
      <a className="ui-btn ui-btn-primary" href="#/studio/demo-http">
        Open the Studio
      </a>
    </div>
  );
}

const SLUG = '([a-z0-9][a-z0-9-]*)';
const match = (path: string, prefix: string) => new RegExp(`^/${prefix}/${SLUG}`).exec(path)?.[1];

/**
 * Hash routes: the app screens and the developer pages (anything else). Live stays mounted from
 * the start and is only hidden on other screens, so its log, frames and progress survive
 * switching screens (and it has followed the run before it is first opened).
 */
function App() {
  const path = useHashPath();
  const onLive = path.startsWith('/live');
  const liveSlug = onLive ? (match(path, 'live') ?? null) : undefined;
  const [lastLiveSlug, setLastLiveSlug] = useState<string | null>(null);
  if (liveSlug !== undefined && liveSlug !== lastLiveSlug) setLastLiveSlug(liveSlug);
  return (
    <>
      <div style={onLive ? undefined : { display: 'none' }}>
        <LiveShell slug={liveSlug ?? lastLiveSlug} />
      </div>
      {!onLive && <Screen path={path} />}
    </>
  );
}

function Screen({ path }: { path: string }) {
  if (path === '/' || path === '/projects') return <ProjectsScreen />;
  if (path === '/settings') return <SettingsScreen />;
  const studio = match(path, 'studio');
  if (studio) return <StudioScreen key={studio} slug={studio} />;
  const brief = match(path, 'brief');
  if (brief) return <BriefScreen key={brief} slug={brief} />;
  const fix = match(path, 'agentfix');
  if (fix) {
    const run = Number(new URLSearchParams(path.split('?')[1] ?? '').get('run')) || null;
    return <AgentFixScreen key={fix} slug={fix} initialRun={run} />;
  }
  const render = match(path, 'render');
  if (render) return <RenderScreen slug={render} />;
  const exporting = match(path, 'export');
  if (exporting) return <ExportScreen key={exporting} slug={exporting} />;
  const storyboard = match(path, 'storyboard');
  if (storyboard) return <StoryboardScreen key={storyboard} slug={storyboard} />;
  return <DevShell routes={routes} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EngineProvider>
      <App />
    </EngineProvider>
  </StrictMode>,
);
