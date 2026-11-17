import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { BRIEF_LENGTHS, Brief, briefTitle, type BriefMode } from '@studio/core';
import { Glyph, Segmented, Shell, ShellPanel, useToast } from '@studio/ui';
import { useEngine } from '../../engine';
import { appendContext, ContextFiles } from '../ContextFiles';
import { navigate } from '../frame';

export type HomeMode = 'single' | 'series';
type Length = Brief['length'];

const LENGTHS: { value: Length; label: string }[] = BRIEF_LENGTHS.map((l) => ({
  value: l.value,
  label: l.value === 'medium' ? '2–3 min' : l.label,
}));

/** Episode counts offered in series mode (0: the agent decides). */
const EPISODES = [0, 3, 4, 5, 6];

interface Voice {
  id: string;
  name: string;
}

/** Products and voices for the composer, and the default voice from Settings. */
export function useComposerOptions() {
  const { client, state } = useEngine();
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [defaultVoice, setDefaultVoice] = useState<string | null>(null);
  useEffect(() => {
    if (!client || state !== 'open') return;
    let live = true;
    void client.call('products.list', {}).then(
      (list) => live && setProducts(list.map((p) => ({ id: p.id, name: p.name }))),
      () => undefined,
    );
    void client.call('settings.get', {}).then(
      (s) => live && setDefaultVoice(s.defaultVoice),
      () => undefined,
    );
    void client.call('tts.status', {}).then(
      async (s) => {
        if (!s.configured) return live && setVoices([]);
        const list = await client.call('voices.list', {}).catch(() => []);
        if (live) setVoices(list.map((v) => ({ id: v.id, name: v.name })));
      },
      () => live && setVoices([]),
    );
    return () => {
      live = false;
    };
  }, [client, state]);
  return { products, voices, defaultVoice };
}

/**
 * The big prompt on Home: what to make, for which product, who clicks through it, and (folded)
 * the brief basics. Sending creates the tutorial and starts it, or creates a series and has the
 * agent draft its outline.
 */
export function Composer({
  mode,
  goal,
  onGoal,
  inputRef,
}: {
  mode: HomeMode;
  goal: string;
  onGoal: (v: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const { client } = useEngine();
  const toast = useToast();
  const { products, voices, defaultVoice } = useComposerOptions();
  const [product, setProduct] = useState('');
  const [how, setHow] = useState<BriefMode>('agent');
  const [episodes, setEpisodes] = useState(0);
  const [length, setLength] = useState<Length>('medium');
  const [voice, setVoice] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [checkSteps, setCheckSteps] = useState(false);
  const [explainers, setExplainers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { prod: useId(), voice: useId(), notes: useId(), eps: useId() };
  const series = mode === 'series';
  const productId = product || products[0]?.id || 'wso2-integrator';
  const voiceId = voice ?? defaultVoice ?? null;
  const submitting = useRef(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = goal.trim();
    if (!text) {
      toast(
        series
          ? 'Describe what the series should teach first.'
          : 'Describe what the viewer should learn first.',
      );
      inputRef.current?.focus();
      return;
    }
    if (!client || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    const brief = {
      length,
      voice: voiceId,
      explainers: explainers ? ('designed' as const) : ('off' as const),
      gates: { storyboard: checkSteps, narration: true, recording: false, export: true },
    };
    try {
      if (series) {
        const count = episodes ? `Make it ${episodes} episodes.` : '';
        const s = await client.call('series.create', {
          topic: text,
          product: productId,
          ...(notes.trim() || count ? { notes: appendContext(notes, count) } : {}),
        });
        await client.call('series.edit', { slug: s.slug, edit: { op: 'meta', brief } });
        // The agent drafts the outline; if it can't start (no Claude Code), the outline offers it again.
        await client.call('series.plan', { slug: s.slug }).catch(() => undefined);
        navigate(`/series/${s.slug}`);
        return;
      }
      const p = await client.call('project.create', {
        title: briefTitle(text),
        product: productId,
        brief: { goal: text, notes: notes.trim() },
      });
      const saved = await client.call('brief.save', {
        slug: p.slug,
        brief: Brief.parse({ ...brief, goal: text, notes: notes.trim(), mode: how }),
      });
      if (how === 'feed') {
        // The user demonstrates it once; the run starts from the capture.
        navigate(`/capture/${p.slug}`);
        return;
      }
      await client.call('pipeline.start', {
        slug: p.slug,
        gates: { storyboard: saved.gates.storyboard, narration: saved.gates.narration },
      });
      navigate(`/making/${p.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      submitting.current = false;
      setBusy(false);
    }
  };

  const label = series ? 'What should the series teach?' : 'What should the viewer learn?';
  const sendLabel = series ? 'Draft the series outline' : how === 'feed' ? 'Show it once' : 'Make tutorial';

  return (
    <Shell className="hm-composer">
      <form onSubmit={(e) => void submit(e)} aria-busy={busy}>
        <ShellPanel className="hm-composer-panel">
          <label className="ui-sr-only" htmlFor="hm-goal">
            {label}
          </label>
          <textarea
            id="hm-goal"
            ref={inputRef}
            className="hm-goal"
            value={goal}
            placeholder={
              series
                ? 'Build an AI math tutor: create the agent, give it tools, then trace and test it'
                : 'Create an HTTP service with a GET /greeting resource and try it'
            }
            onChange={(e) => onGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
            }}
          />
          <div className="hm-row">
            <label className="ui-sr-only" htmlFor={ids.prod}>
              Product
            </label>
            <select
              id={ids.prod}
              className="hm-pillselect"
              value={productId}
              onChange={(e) => setProduct(e.target.value)}
            >
              {(products.length ? products : [{ id: 'wso2-integrator', name: 'WSO2 Integrator' }]).map(
                (p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ),
              )}
            </select>
            {series ? (
              <>
                <label className="ui-sr-only" htmlFor={ids.eps}>
                  Episodes
                </label>
                <select
                  id={ids.eps}
                  className="hm-pillselect"
                  value={episodes}
                  onChange={(e) => setEpisodes(Number(e.target.value))}
                >
                  {EPISODES.map((n) => (
                    <option key={n} value={n}>
                      {n ? `${n} episodes` : 'Let the agent decide'}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <Segmented<BriefMode>
                label="Who clicks through it?"
                options={[
                  { value: 'agent', label: 'The agent clicks through' },
                  { value: 'feed', label: "I'll show it once" },
                ]}
                value={how}
                onChange={setHow}
              />
            )}
            <span className="hm-grow" />
            <button
              type="submit"
              className="hm-send"
              aria-label={sendLabel}
              title={sendLabel}
              disabled={busy || !client}
            >
              {busy ? <span className="k-spin" aria-hidden="true" /> : <Glyph name="send" size={18} />}
            </button>
          </div>
          <details className="hm-disc">
            <summary>
              <Glyph name="next" size={12} className="hm-caret" />
              Length, voice and notes
            </summary>
            <div className="hm-cust">
              <div className="hm-field">
                <span className="hm-lbl">{series ? 'Length of each episode' : 'Length'}</span>
                <Segmented<Length>
                  label={series ? 'Length of each episode' : 'Length'}
                  options={LENGTHS}
                  value={length}
                  onChange={setLength}
                />
              </div>
              <div className="hm-field">
                <label className="hm-lbl" htmlFor={ids.voice}>
                  Voice
                </label>
                {voices && voices.length === 0 ? (
                  <span className="hm-note">
                    Add an ElevenLabs key in <a href="#/settings">Settings</a> to pick a voice. You can start
                    without it.
                  </span>
                ) : (
                  <select
                    id={ids.voice}
                    className="ui-select"
                    value={voiceId ?? ''}
                    onChange={(e) => setVoice(e.target.value || null)}
                  >
                    {!voices && <option value="">Loading voices…</option>}
                    {voices && !voiceId && <option value="">Choose a voice</option>}
                    {voices?.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                        {v.id === defaultVoice ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="hm-field hm-wide">
                <label className="hm-lbl" htmlFor={ids.notes}>
                  Notes for the agent
                </label>
                <textarea
                  id={ids.notes}
                  className="ui-textarea"
                  rows={notes.length > 400 ? 6 : 2}
                  value={notes}
                  placeholder={
                    series
                      ? 'Who it is for, names and sample data every episode uses, what to leave out…'
                      : 'Anything to show, skip or say: who it is for, names and sample data to use…'
                  }
                  onChange={(e) => setNotes(e.target.value)}
                />
                <ContextFiles onText={(t) => setNotes((n) => appendContext(n, t))} />
              </div>
              <label className="hm-check">
                <input
                  type="checkbox"
                  checked={checkSteps}
                  onChange={(e) => setCheckSteps(e.target.checked)}
                />
                <span>Let me check the steps before it records</span>
              </label>
              <label className="hm-check">
                <input
                  type="checkbox"
                  checked={explainers}
                  onChange={(e) => setExplainers(e.target.checked)}
                />
                <span>Add short explainers for concepts</span>
              </label>
            </div>
          </details>
        </ShellPanel>
        <div className="hm-foot">
          <Glyph name="clock" size={13} />
          {series ? (
            <span>
              First, the agent drafts an outline <b>(about a minute)</b>. Nothing is recorded until you
              approve it.
            </span>
          ) : how === 'feed' ? (
            <span>
              You click through it <b>once</b> in the product, then the agent writes the script and records
              it.
            </span>
          ) : (
            <span>
              About <b>25 min</b> · about <b>$2</b> · You'll check {checkSteps ? 'the steps and ' : ''}the
              script once, then it records
            </span>
          )}
        </div>
        {error && (
          <p role="alert" className="hm-error">
            {error}
          </p>
        )}
      </form>
    </Shell>
  );
}
