import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ProductConfig, ProductInfo, Pronunciation, RpcResult } from '@studio/core';
import {
  Button,
  Field,
  Glyph,
  Input,
  Segmented,
  Select,
  Sheet,
  Shell,
  ShellHeader,
  ShellPanel,
  StatusPill,
  Switch,
  type GlyphName,
} from '@studio/ui';
import { isTauri, useEngine } from '../../engine';
import { setThemePref, useThemePref, type ThemePref } from '../../theme';
import { AppFrame } from '../frame';
import { ProductAccounts } from './ProductAccounts';
import { SetupChecklist, useSetup, type Setup } from './SetupChecklist';
import './settings.css';

type Settings = RpcResult<'settings.get'>;

/** Models offered for the custom choice (any id or alias Claude Code accepts works). */
const MODEL_SUGGESTIONS = [
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
  'claude-fable-5-1',
  'opus',
  'sonnet',
  'haiku',
];
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Note = { text: string; tone: 'ok' | 'error' } | null;

/**
 * Settings: Get started, Accounts, the agent's defaults, the voice, what the agent learned,
 * Appearance, and the developer options under Advanced.
 */
export function SettingsScreen() {
  const setup = useSetup();
  const settings = useSettings();
  return (
    <AppFrame current="settings">
      <main className="st">
        <h1 className="st-title">Settings</h1>
        <SetupChecklist setup={setup} />
        <AccountsSection setup={setup} />
        <AgentSection {...settings} />
        <VoiceSection {...settings} />
        <LearnedSection />
        <AppearanceSection />
        <AdvancedSection {...settings} />
      </main>
    </AppFrame>
  );
}

/** The studio settings, shared by the sections that change them. */
function useSettings() {
  const { client, state } = useEngine();
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    if (client && state === 'open') void client.call('settings.get', {}).then(setS, () => undefined);
  }, [client, state]);
  /** Saves a change; resolves true when the engine took it. */
  const update = async (patch: Partial<Settings>): Promise<string | null> => {
    if (!client) return 'Not connected to the engine.';
    try {
      setS(await client.call('settings.update', patch));
      return null;
    } catch (e) {
      return message(e);
    }
  };
  return { s, update };
}
type SettingsProps = ReturnType<typeof useSettings>;

/** A section: a shell with an icon, a title and the content panel. */
function Section({
  id,
  icon,
  title,
  subtitle,
  aside,
  children,
}: {
  id: string;
  icon: GlyphName;
  title: string;
  subtitle?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Shell aria-labelledby={id}>
      <ShellHeader icon={icon} title={<span id={id}>{title}</span>} subtitle={subtitle} aside={aside} />
      <ShellPanel className="st-panel">{children}</ShellPanel>
    </Shell>
  );
}

/** "Saved" with a tick for a moment after a change is saved; errors stay. */
function useSaved() {
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const report = (error: string | null) => {
    if (timer.current) clearTimeout(timer.current);
    setState(error ? { ok: false, text: error } : { ok: true, text: 'Saved' });
    if (!error) timer.current = setTimeout(() => setState(null), 2500);
  };
  return { state, report, clear: () => setState(null) };
}

function SavedNote({ state, id }: { state: { ok: boolean; text: string } | null; id?: string }) {
  return (
    <span id={id} className={state?.ok === false ? 'st-error' : 'st-saved'} role="status">
      {state?.ok && <Glyph name="check" size={12} />}
      {state?.text}
    </span>
  );
}

function NoteLine({ note }: { note: Note }) {
  if (!note) return null;
  return (
    <p className={note.tone === 'ok' ? 'st-ok' : 'st-error'} role={note.tone === 'ok' ? 'status' : 'alert'}>
      {note.tone === 'ok' && <Glyph name="check" size={12} />}
      {note.text}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/** The ElevenLabs key (kept in the Keychain by the engine) and the agent's Claude sign-in. */
function AccountsSection({ setup }: { setup: Setup }) {
  const { client, state } = useEngine();
  const [tts, setTts] = useState<RpcResult<'tts.status'> | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (client && state === 'open') void client.call('tts.status', {}).then(setTts, () => undefined);
  }, [client, state]);

  const save = async () => {
    if (!client || !key.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      setTts(await client.call('tts.setKey', { apiKey: key.trim() }));
      setKey('');
      setNote({ text: 'Key checked with ElevenLabs and saved.', tone: 'ok' });
      void setup.refresh();
    } catch (e) {
      setNote({ text: message(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setConfirm(false);
    if (!client) return;
    try {
      setTts(await client.call('tts.clearKey', {}));
      setNote({ text: 'Key removed.', tone: 'ok' });
      void setup.refresh();
    } catch (e) {
      setNote({ text: message(e), tone: 'error' });
    }
  };

  const claude = setup.items?.find((i) => i.id === 'claude');
  const fromEnv = tts?.source === 'env';
  return (
    <Section id="st-accounts" icon="lock" title="Accounts">
      <div className="st-block">
        <div className="st-row">
          <span className="st-name">ElevenLabs (voice-over)</span>
          <StatusPill
            tone={tts?.configured ? 'positive' : 'warning'}
            icon={tts?.configured ? 'check' : 'warn'}
          >
            {tts ? (tts.configured ? 'Key saved' : 'No key') : '…'}
          </StatusPill>
        </div>
        {fromEnv ? (
          <p className="st-muted">The key comes from the ELEVENLABS_API_KEY environment variable.</p>
        ) : (
          <div className="ui-field">
            <label htmlFor="st-key">{tts?.configured ? 'Replace the API key' : 'API key'}</label>
            <div className="st-inline">
              <Input
                id="st-key"
                aria-describedby="st-key-hint"
                type="password"
                autoComplete="off"
                value={key}
                placeholder="Paste your key"
                onChange={(e) => setKey(e.target.value)}
              />
              <Button variant="brand" disabled={busy || !key.trim()} onClick={() => void save()}>
                {busy ? 'Checking…' : 'Save key'}
              </Button>
              {tts?.configured && (
                <Button variant="quiet" onClick={() => setConfirm(true)}>
                  Remove key
                </Button>
              )}
            </div>
            <span className="ui-field-hint" id="st-key-hint">
              Checked with ElevenLabs before it's saved. It stays in the macOS Keychain and is never shared
              with the agent.
            </span>
          </div>
        )}
        <NoteLine note={note} />
      </div>
      <div className="st-block">
        <div className="st-row">
          <span className="st-name">Claude (the agent)</span>
          <StatusPill
            tone={claude?.ok ? 'positive' : claude?.ok === false ? 'warning' : 'neutral'}
            icon={claude?.ok ? 'check' : claude?.ok === false ? 'warn' : undefined}
          >
            {claude?.ok ? 'Signed in' : claude?.ok === false ? 'Not signed in' : 'Not checked'}
          </StatusPill>
        </div>
        <p className="st-muted">
          {claude?.ok
            ? claude.detail
            : 'The agent uses your Claude Code sign-in. See Get started above to sign in.'}{' '}
          Which login and program it uses is under Advanced.
        </p>
      </div>
      <ProductAccounts />
      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Remove the ElevenLabs key?"
        subtitle="New voice-overs can't be made until you add a key again. Voice-overs you already have stay."
        width={440}
      >
        <div className="st-sheet-actions">
          <Button variant="quiet" onClick={() => setConfirm(false)}>
            Keep the key
          </Button>
          <Button variant="danger" onClick={() => void remove()}>
            Remove key
          </Button>
        </div>
      </Sheet>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

/** The spending limit, whether to ask before commands, the model and repairs. */
function AgentSection({ s, update }: SettingsProps) {
  const [limit, setLimit] = useState<string | null>(null);
  const limitSaved = useSaved();
  const other = useSaved();
  const errorId = useId();
  if (!s) return null;
  const shown = limit ?? (s.maxCostPerRun ? String(s.maxCostPerRun) : '');

  const saveLimit = async () => {
    const raw = shown.trim();
    const n = Number(raw);
    if (raw && (!Number.isFinite(n) || n <= 0)) {
      limitSaved.report('Enter an amount above $0, or leave it empty for no limit.');
      return;
    }
    const value = raw ? Math.round(n * 100) / 100 : null;
    if (value === s.maxCostPerRun) {
      limitSaved.clear();
      return;
    }
    limitSaved.report(await update({ maxCostPerRun: value }));
    setLimit(null);
  };
  const save = async (patch: Partial<Settings>) => other.report(await update(patch));
  const invalid = limitSaved.state?.ok === false;

  return (
    <Section id="st-agent" icon="spark" title="Agent" aside={<SavedNote state={other.state} />}>
      <div className="ui-field">
        <label htmlFor="st-limit">Spending limit per tutorial</label>
        <div className="st-inline st-money">
          <span aria-hidden="true">$</span>
          <Input
            id="st-limit"
            type="number"
            min={1}
            step={1}
            inputMode="decimal"
            value={shown}
            placeholder="No limit"
            aria-invalid={invalid || undefined}
            aria-describedby={`${errorId} st-limit-hint`}
            onChange={(e) => {
              setLimit(e.target.value);
              if (invalid) limitSaved.clear();
            }}
            onBlur={() => void saveLimit()}
            onKeyDown={(e) => e.key === 'Enter' && void saveLimit()}
          />
          <SavedNote state={limitSaved.state} id={errorId} />
        </div>
        <span className="ui-field-hint" id="st-limit-hint">
          Each time the agent makes or remakes a tutorial, it stops and asks before spending more than this.
          Leave it empty for no limit.
        </span>
      </div>

      <div className="st-switch">
        <Switch
          label={
            <span className="st-switch-text">
              <span className="st-name">Ask me before it runs commands outside the tutorial folder</span>
              <span className="st-muted">
                Recommended. Safe steps inside the folder never ask. Applies to new tutorials.
              </span>
            </span>
          }
          // Asking is auto mode turned off.
          checked={!s.autoMode}
          onChange={(ask) => void save({ autoMode: !ask })}
        />
      </div>

      <Field
        label="Model"
        hint="Balanced uses Opus for research, planning and repairs, and the faster Sonnet for writing the script and the rest. All Sonnet is quickest and cheapest; all Opus is the most careful and slowest."
      >
        {(id) => (
          <Select
            id={id}
            value={s.agentModel}
            onChange={(e) => void save({ agentModel: e.target.value as Settings['agentModel'] })}
          >
            <option value="balanced">Balanced (recommended)</option>
            <option value="sonnet">Sonnet 5.5 for everything (fastest)</option>
            <option value="opus">Opus 5.5 for everything (most careful)</option>
            <option value="custom">Custom models…</option>
          </Select>
        )}
      </Field>
      {s.agentModel === 'custom' && (
        <>
          {/* Model ids or Claude Code aliases; the list suggests the current models. */}
          <datalist id="st-models">
            {MODEL_SUGGESTIONS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          {(
            [
              ['deep', 'Model for research, planning and repairs'],
              ['writing', 'Model for the script and the rest'],
            ] as const
          ).map(([key, label]) => (
            <Field
              key={key}
              label={label}
              hint="A model id such as claude-opus-5-5, or opus, sonnet or haiku."
            >
              {(id) => (
                <Input
                  id={id}
                  list="st-models"
                  defaultValue={s.customModels[key]}
                  key={s.customModels[key]}
                  onBlur={(e) => {
                    const v = e.currentTarget.value.trim();
                    if (v && v !== s.customModels[key])
                      void save({ customModels: { ...s.customModels, [key]: v } });
                  }}
                />
              )}
            </Field>
          ))}
        </>
      )}
      <Field
        label="Repairs before asking you"
        hint="When a practice run or recording fails, the agent tries this many fixes on its own, then tells you what it tried and asks how to go on."
      >
        {(id) => (
          <Select
            id={id}
            value={String(s.maxRepairs)}
            onChange={(e) => void save({ maxRepairs: Number(e.target.value) })}
          >
            <option value="0">None: ask me straight away</option>
            <option value="1">1 (recommended)</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="5">5</option>
          </Select>
        )}
      </Field>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

/** The default voice and how product names are said. */
function VoiceSection({ s, update }: SettingsProps) {
  const { client, state } = useEngine();
  const [voices, setVoices] = useState<{ id: string; name: string }[]>([]);
  const [rows, setRows] = useState<Pronunciation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const voiceSaved = useSaved();
  useEffect(() => {
    if (!client || state !== 'open') return;
    void client.call('tts.status', {}).then(
      async (t) => t.configured && setVoices(await client.call('voices.list', {}).catch(() => [])),
      () => undefined,
    );
    void client.call('pronunciations.get', {}).then(setRows, () => undefined);
  }, [client, state]);

  const change = (i: number, patch: Partial<Pronunciation>) =>
    setRows((r) => r && r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = async () => {
    if (!client || !rows) return;
    setBusy(true);
    setNote(null);
    try {
      setRows(
        await client.call('pronunciations.save', {
          pronunciations: rows.filter((r) => r.term.trim() && r.say.trim()),
        }),
      );
      setNote({ text: 'Saved. Voice-overs made from now on use it.', tone: 'ok' });
    } catch (e) {
      setNote({ text: message(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="st-voice" icon="mic" title="Voice" aside={<SavedNote state={voiceSaved.state} />}>
      {s && (
        <Field
          label="Default voice"
          hint="New tutorials start with it. Choosing a voice for a tutorial makes it the default."
        >
          {(id) => (
            <Select
              id={id}
              value={s.defaultVoice ?? ''}
              disabled={!voices.length}
              onChange={async (e) =>
                voiceSaved.report(await update({ defaultVoice: e.target.value || null }))
              }
            >
              <option value="">{voices.length ? 'None' : 'Add an ElevenLabs key to see the voices'}</option>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <div className="st-block">
        <span className="st-name">Say product names right</span>
        <p className="st-muted">
          How the voice says a word. Only the voice changes: the script and captions keep the written form.
        </p>
        {rows && rows.length > 0 && (
          <ul className="st-prons">
            {rows.map((r, i) => (
              <li key={i} className="st-pron">
                <Input
                  aria-label={`Written word ${i + 1}`}
                  value={r.term}
                  placeholder="WSO2"
                  onChange={(e) => change(i, { term: e.target.value })}
                />
                <Glyph name="arrow" size={12} />
                <Input
                  aria-label={`Said as ${i + 1}`}
                  value={r.say}
                  placeholder="W S O two"
                  onChange={(e) => change(i, { say: e.target.value })}
                />
                <Button
                  size="sm"
                  variant="quiet"
                  aria-label={`Remove ${r.term.trim() || `word ${i + 1}`}`}
                  onClick={() => setRows((x) => x && x.filter((_, j) => j !== i))}
                >
                  <Glyph name="trash" size={12} />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="st-inline">
          <Button
            size="sm"
            onClick={() => setRows((x) => [...(x ?? []), { term: '', say: '' }])}
            disabled={!rows}
          >
            <Glyph name="plus" size={12} />
            Add a word
          </Button>
          <span className="st-grow" />
          <Button size="sm" variant="brand" disabled={!rows || busy} onClick={() => void save()}>
            Save pronunciations
          </Button>
        </div>
        <NoteLine note={note} />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// What the agent learned
// ---------------------------------------------------------------------------

/** What the knowledge base holds, in plain words. Lessons are edited in the workspace folder. */
function LearnedSection() {
  const { client, state } = useEngine();
  const [k, setK] = useState<RpcResult<'knowledge.summary'> | null>(null);
  const [note, setNote] = useState<Note>(null);
  useEffect(() => {
    if (client && state === 'open') void client.call('knowledge.summary', {}).then(setK, () => undefined);
  }, [client, state]);
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const open = async () => {
    setNote(null);
    try {
      const r = await client!.call('workspace.reveal', {});
      if (!r.ok) setNote({ text: 'Opening folders only works on macOS.', tone: 'error' });
    } catch (e) {
      setNote({ text: message(e), tone: 'error' });
    }
  };
  return (
    <Section
      id="st-learned"
      icon="history"
      title="What the agent learned"
      subtitle="It keeps what it learns for your next tutorials."
    >
      {k ? (
        <ul className="st-lessons">
          <li>
            How to work with{' '}
            {k.products.length ? k.products.map((p) => p.name).join(', ') : 'no products yet'}
            {k.productSkills ? ` (${plural(k.productSkills, 'product guide')})` : ''}.
          </li>
          <li>
            {plural(k.overlays, 'shared overlay')} and {plural(k.scenes, 'explainer scene')} it can reuse.
          </li>
          {k.components > 0 && <li>{plural(k.components, 'checked component')} in the shared library.</li>}
        </ul>
      ) : (
        <p className="st-muted">Loading…</p>
      )}
      <p className="st-muted">
        Lessons are kept as files in the workspace folder, with their history. To change or remove one, open
        the folder.
      </p>
      <div>
        <Button size="sm" onClick={() => void open()} disabled={!client}>
          <Glyph name="folder" size={12} />
          Open the workspace folder
        </Button>
      </div>
      <NoteLine note={note} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

const THEMES: readonly { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** The app's colour theme. Saved on this Mac only; exported videos keep their own look. */
function AppearanceSection() {
  const theme = useThemePref();
  return (
    <Section id="st-appearance" icon="gear" title="Appearance">
      <Segmented label="Theme" options={THEMES} value={theme} onChange={setThemePref} />
      <p className="st-muted">System follows macOS. Only the app changes: videos keep their own colours.</p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Advanced
// ---------------------------------------------------------------------------

/** Developer options: Claude Code's program and login folder, the workspace, and products. */
function AdvancedSection({ s, update }: SettingsProps) {
  return (
    <details className="st-advanced">
      <summary>
        <span className="st-name">Advanced</span>
        <span className="st-muted">Claude login folder, workspace and products</span>
      </summary>
      <div className="st-advanced-body">
        <ClaudeSettings s={s} update={update} />
        <WorkspaceSettings s={s} />
        <ProductsSettings />
      </div>
    </details>
  );
}

/** Which Claude Code the agent runs and which login (config folder) it uses. */
function ClaudeSettings({ s, update }: SettingsProps) {
  const [exe, setExe] = useState<string | null>(null);
  const [dir, setDir] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  if (!s) return null;
  const save = async () => {
    setBusy(true);
    setNote(null);
    const error = await update({
      claudeExecutable: (exe ?? s.claudeExecutable ?? '').trim() || null,
      claudeConfigDir: (dir ?? s.claudeConfigDir ?? '').trim() || null,
    });
    setBusy(false);
    if (error) setNote({ text: error, tone: 'error' });
    else {
      setExe(null);
      setDir(null);
      setNote({ text: 'Saved. The agent uses it from its next session.', tone: 'ok' });
    }
  };
  return (
    <Section id="st-claude" icon="spark" title="Claude Code">
      <Field
        label="Claude login folder"
        hint="Which Claude login the agent uses. Empty: the usual one (~/.claude)."
      >
        {(id) => (
          <Input
            id={id}
            value={dir ?? s.claudeConfigDir ?? ''}
            placeholder="~/.claude"
            onChange={(e) => setDir(e.target.value)}
          />
        )}
      </Field>
      <Field
        label="Claude Code program"
        hint="Empty: the one installed on this Mac. Set it to use another one."
      >
        {(id) => (
          <Input
            id={id}
            value={exe ?? s.claudeExecutable ?? ''}
            placeholder="The installed Claude Code"
            onChange={(e) => setExe(e.target.value)}
          />
        )}
      </Field>
      <div>
        <Button variant="brand" size="sm" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save Claude settings'}
        </Button>
      </div>
      <NoteLine note={note} />
    </Section>
  );
}

/** Where the workspace is; the packaged app can move to another folder (it restarts). */
function WorkspaceSettings({ s }: { s: Settings | null }) {
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const move = async () => {
    setError(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_workspace', { path: path.trim() });
    } catch (e) {
      setError(message(e));
    }
  };
  return (
    <Section
      id="st-workspace"
      icon="folder"
      title="Workspace"
      subtitle="The agent's knowledge, shared overlays and scenes, and every tutorial. It's a git repository."
    >
      <code className="st-path">{s?.workspace ?? '…'}</code>
      {s?.packaged && isTauri() ? (
        <Field
          label="Use another folder"
          hint="The app restarts on it. A new folder is set up the first time."
        >
          {(id) => (
            <div className="st-inline">
              <Input
                id={id}
                value={path}
                placeholder="/Users/you/Tutorial Studio"
                onChange={(e) => setPath(e.target.value)}
              />
              <Button disabled={!path.trim()} onClick={() => void move()}>
                Use and restart
              </Button>
            </div>
          )}
        </Field>
      ) : (
        import.meta.env.DEV && <p className="st-muted">Development builds use the repo's workspace folder.</p>
      )}
      {error && (
        <p className="st-error" role="alert">
          {error}
        </p>
      )}
    </Section>
  );
}

const PRODUCT_ID = /^[a-z0-9][a-z0-9-]*$/;

/** What's wrong with a product entry, or null. */
export function productProblem(p: ProductConfig, all: ProductConfig[]): string | null {
  if (!p.name.trim()) return 'Give it a name.';
  if (!PRODUCT_ID.test(p.id)) return 'The id uses lower case letters, digits and dashes.';
  if (all.filter((x) => x.id === p.id).length > 1) return 'Another product has this id.';
  if (p.app !== undefined && !p.app.trim()) return 'Choose the app to open.';
  return null;
}

/** products.json: the products tutorials can be made for and how each is opened. */
function ProductsSettings() {
  const { client, state } = useEngine();
  const [list, setList] = useState<ProductInfo[] | null>(null);
  const [draft, setDraft] = useState<ProductConfig[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  useEffect(() => {
    if (client && state === 'open') void client.call('products.list', {}).then(setList, () => undefined);
  }, [client, state]);

  const editing = draft !== null;
  const start = () =>
    setDraft(
      (list ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        ...(p.launch === 'app' && p.app ? { app: p.app } : {}),
        ...(p.launch === 'vscode' ? { extensions: p.extensions } : {}),
        skill: p.skill,
      })),
    );
  const change = (i: number, patch: Partial<ProductConfig>) =>
    setDraft((d) => d && d.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const problems = draft?.map((p) => productProblem(p, draft)) ?? [];
  const save = async () => {
    if (!client || !draft || problems.some(Boolean)) return;
    setBusy(true);
    setNote(null);
    try {
      setList(await client.call('products.save', { products: draft }));
      setDraft(null);
      setNote({ text: 'Products saved.', tone: 'ok' });
    } catch (e) {
      setNote({ text: message(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      id="st-products"
      icon="box"
      title="Products"
      subtitle="The products tutorials can be made for. Saved in the workspace's products.json."
      aside={
        editing ? null : (
          <Button size="sm" onClick={start} disabled={!list}>
            Edit products
          </Button>
        )
      }
    >
      {!editing && (
        <ul className="st-products">
          {list?.map((p) => (
            <li key={p.id} className="st-product">
              <span className="st-product-text">
                <span className="st-name">{p.name}</span>
                <span className="st-muted">
                  {p.launch === 'app'
                    ? `App: ${p.app ?? ''}`
                    : `VS Code with ${p.extensions.join(', ') || 'no extensions'}`}
                </span>
              </span>
              {p.launch === 'app' ? (
                <StatusPill tone={p.available ? 'positive' : 'warning'} icon={p.available ? 'check' : 'warn'}>
                  {p.available ? 'Installed' : 'Not installed'}
                </StatusPill>
              ) : (
                <StatusPill>VS Code</StatusPill>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing &&
        draft.map((p, i) => {
          const builtIn = list?.find((x) => x.id === p.id)?.builtIn ?? false;
          const launch = p.app !== undefined ? 'App' : 'VS Code';
          const problem = problems[i];
          return (
            <fieldset key={i} className="st-product-edit" aria-invalid={problem ? true : undefined}>
              <legend>{p.name || 'New product'}</legend>
              <div className="st-inline">
                <Field label="Name">
                  {(id) => (
                    <Input id={id} value={p.name} onChange={(e) => change(i, { name: e.target.value })} />
                  )}
                </Field>
                <Field label="Id">
                  {(id) => (
                    <Input
                      id={id}
                      value={p.id}
                      disabled={builtIn}
                      onChange={(e) => change(i, { id: e.target.value })}
                    />
                  )}
                </Field>
              </div>
              <Segmented
                label="Opens as"
                options={['App', 'VS Code'] as const}
                value={launch}
                onChange={(v) =>
                  change(
                    i,
                    v === 'App'
                      ? { app: p.app ?? '', extensions: undefined }
                      : { app: undefined, extensions: p.extensions ?? [] },
                  )
                }
              />
              {launch === 'App' ? (
                <Field label="App" hint="For example /Applications/WSO2 Integrator.app">
                  {(id) => (
                    <Input id={id} value={p.app ?? ''} onChange={(e) => change(i, { app: e.target.value })} />
                  )}
                </Field>
              ) : (
                <Field
                  label="Extensions"
                  hint="Marketplace ids, separated by commas, e.g. WSO2.wso2-integrator@1.0.1"
                >
                  {(id) => (
                    <Input
                      id={id}
                      value={(p.extensions ?? []).join(', ')}
                      onChange={(e) =>
                        change(i, {
                          extensions: e.target.value
                            .split(',')
                            .map((x) => x.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  )}
                </Field>
              )}
              <Field
                label="Product guide (skill)"
                hint="The workspace skill that knows this product's screens."
              >
                {(id) => (
                  <Input
                    id={id}
                    value={p.skill ?? ''}
                    onChange={(e) => change(i, { skill: e.target.value })}
                  />
                )}
              </Field>
              {problem && <p className="st-error">{problem}</p>}
              {!builtIn && (
                <div>
                  <Button
                    size="sm"
                    variant="quiet"
                    aria-label={`Remove ${p.name || 'this product'}`}
                    onClick={() => setDraft((d) => d && d.filter((_, j) => j !== i))}
                  >
                    Remove product
                  </Button>
                </div>
              )}
            </fieldset>
          );
        })}
      {editing && (
        <div className="st-inline">
          <Button
            size="sm"
            onClick={() => setDraft((d) => [...(d ?? []), { id: '', name: '', extensions: [] }])}
          >
            <Glyph name="plus" size={12} />
            Add product
          </Button>
          <span className="st-grow" />
          <Button size="sm" variant="quiet" onClick={() => setDraft(null)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="brand"
            disabled={busy || problems.some(Boolean)}
            onClick={() => void save()}
          >
            Save products
          </Button>
        </div>
      )}
      <NoteLine note={note} />
    </Section>
  );
}
