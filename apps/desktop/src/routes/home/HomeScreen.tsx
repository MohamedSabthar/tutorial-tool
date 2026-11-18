import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectSummary, Series, SetupItem } from '@studio/core';
import { IconTile, LinkButton, Segmented, Shell, ShellPanel } from '@studio/ui';
import { useEngine } from '../../engine';
import { TopBar } from '../frame';
import { Composer, type HomeMode } from './Composer';
import { Library } from './Library';
import './home.css';

const EXAMPLES: Record<HomeMode, string[]> = {
  single: [
    'Create an HTTP service and try it',
    'Connect to a MySQL database',
    'Map JSON to XML with the data mapper',
    'Expose a service as an AI agent tool',
  ],
  series: [
    'Build an AI math tutor, start to finish',
    'Integrations 101: services, connectors, data mapping',
    'From HTTP service to deployed API',
  ],
};

/** Setup items in order of importance; the ElevenLabs key comes last because it doesn't block. */
const SETUP_ORDER: SetupItem['id'][] = [
  'claude-code',
  'workspace',
  'ffmpeg',
  'product',
  'claude',
  'elevenlabs',
];

const SETUP_COPY: Partial<Record<SetupItem['id'], { title: string; text: string; action: string }>> = {
  'claude-code': {
    title: 'Install Claude Code so the agent can work',
    text: 'The agent plans and records with Claude Code. Settings shows how to install it.',
    action: 'Open Settings',
  },
  workspace: {
    title: 'Set up the workspace',
    text: 'Tutorials and what the agent learns are kept there. It takes a second.',
    action: 'Open Settings',
  },
  ffmpeg: {
    title: 'Install ffmpeg to record and export',
    text: 'Run brew install ffmpeg in Terminal, then restart the app.',
    action: 'Open Settings',
  },
  product: {
    title: 'Install a product to record',
    text: 'The agent needs a Choreo Labs product (or the VS Code extension) to click through.',
    action: 'Open Settings',
  },
  claude: {
    title: 'Sign the agent in to Claude',
    text: 'Run claude auth login in Terminal, then check again in Settings.',
    action: 'Open Settings',
  },
  elevenlabs: {
    title: 'Add a voice-over key to give the video a narrator',
    text: "You can start without it. The voice-over waits until it's added.",
    action: 'Add key',
  },
};

/** The one setup item that matters most right now, if any. */
export function topSetupItem(items: readonly SetupItem[] | null): SetupItem | null {
  if (!items) return null;
  for (const id of SETUP_ORDER) {
    const item = items.find((i) => i.id === id);
    if (item && item.ok === false) return item;
  }
  return null;
}

/** Dev-only sample data for `?preview=` (empty, setup). */
function previewOf(query: string | undefined): string | null {
  if (!import.meta.env.DEV) return null;
  return new URLSearchParams(query ?? '').get('preview');
}

function SetupNotice({ item }: { item: SetupItem }) {
  const copy = SETUP_COPY[item.id];
  if (!copy) return null;
  const blocking = item.id !== 'elevenlabs';
  return (
    <Shell className="hm-notice-shell" aria-label="Setup">
      <ShellPanel className="hm-notice">
        <IconTile icon={blocking ? 'warn' : 'mic'} tone="warning" />
        <div className="hm-grow">
          <b>{copy.title}</b>
          <p>{copy.text}</p>
        </div>
        <LinkButton size="sm" variant={blocking ? 'primary' : 'secondary'} href="#/settings">
          {copy.action}
        </LinkButton>
      </ShellPanel>
    </Shell>
  );
}

/** Home: say what to make (one tutorial or a series), then find every tutorial below. */
export function HomeScreen({ query }: { query?: string }) {
  const { client, state } = useEngine();
  const preview = previewOf(query);
  const [mode, setMode] = useState<HomeMode>('single');
  const [goal, setGoal] = useState('');
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [series, setSeries] = useState<Series[]>([]);
  const [setup, setSetup] = useState<SetupItem[] | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const [list, s] = await Promise.all([
      client.call('project.list', {}).catch(() => null),
      client.call('series.list', {}).catch(() => []),
    ]);
    if (list) setProjects(list);
    setSeries(s);
  }, [client]);

  useEffect(() => {
    if (!client || state !== 'open') return;
    void Promise.resolve().then(load);
    void client.call('setup.status', {}).then(setSetup, () => undefined);
    const offs = [
      client.on('project.changed', () => void load()),
      client.on('pipeline.changed', () => void load()),
      client.on('series.changed', () => void load()),
    ];
    return () => offs.forEach((off) => off());
  }, [client, state, load]);

  const shownProjects = preview === 'empty' ? [] : (projects ?? []);
  const shownSeries = preview === 'empty' ? [] : series;
  const notice =
    preview === 'setup'
      ? ({ id: 'claude-code', label: 'Claude Code installed', ok: false, detail: '' } as SetupItem)
      : topSetupItem(setup);
  const ser = mode === 'series';

  return (
    <div className="app-frame">
      <TopBar current="tutorials" />
      <div className="app-frame-body">
        <main className="hm">
          <div className="hm-hero">
            <h1>{ser ? 'What should the series teach?' : 'What should the viewer learn?'}</h1>
            <p>
              {ser
                ? 'Describe the whole journey. The agent splits it into short episodes that build on each other. You approve the outline once, then each episode is made like any tutorial.'
                : 'Describe it once. The agent plans it, tries it in the product and records a narrated video. You check the script, then polish it.'}
            </p>
          </div>
          {notice && <SetupNotice item={notice} />}
          <Segmented<HomeMode>
            label="What to make"
            options={[
              { value: 'single', label: 'One tutorial' },
              { value: 'series', label: 'A series' },
            ]}
            value={mode}
            onChange={setMode}
          />
          <Composer mode={mode} goal={goal} onGoal={setGoal} inputRef={input} />
          <div className="hm-sugg" role="group" aria-label="Examples">
            {EXAMPLES[mode].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setGoal(s);
                  input.current?.focus();
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <Library
            projects={shownProjects}
            series={shownSeries}
            loading={projects === null && preview !== 'empty'}
          />
        </main>
      </div>
    </div>
  );
}
