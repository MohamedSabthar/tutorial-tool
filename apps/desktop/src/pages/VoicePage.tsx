import { useCallback, useEffect, useState } from 'react';
import type { RpcResult } from '@studio/core';
import { Button, Chip, Field, Input, Panel, Select, TextArea } from '@studio/ui';
import { useEngine } from '../engine';
import { Page } from '../shell';

type Status = RpcResult<'tts.status'>;
type Voice = RpcResult<'voices.list'>[number];
type Result = RpcResult<'tts.synthesize'> & { ms: number };

const SLUG = 'demo-http';

/** Words with start/end from per-character timings (a preview of 4.2's word timings). */
function words(a: Result['alignment']) {
  const out: { w: string; start: number; end: number }[] = [];
  let cur: { w: string; start: number; end: number } | null = null;
  a.chars.forEach((c, i) => {
    if (/\s/.test(c)) {
      if (cur) out.push(cur);
      cur = null;
    } else if (cur) {
      cur.w += c;
      cur.end = a.ends[i]!;
    } else cur = { w: c, start: a.starts[i]!, end: a.ends[i]! };
  });
  if (cur) out.push(cur);
  return out;
}

export function VoicePage() {
  const { client, state, info } = useEngine();
  const [status, setStatus] = useState<Status | null>(null);
  const [key, setKey] = useState('');
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voice, setVoice] = useState('');
  const [text, setText] = useState(
    'Set the base path to /greeting. This is where clients reach your service.',
  );
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const loadVoices = useCallback(
    async (refresh = false) => {
      if (!client) return;
      const list = await client.call('voices.list', { refresh });
      setVoices(list);
      setVoice((v) => v || list[0]?.id || '');
    },
    [client],
  );

  useEffect(() => {
    if (!client || state !== 'open') return;
    void client.call('tts.status', {}).then(async (s) => {
      setStatus(s);
      if (s.configured) await loadVoices().catch((e: unknown) => setError(String(e)));
    });
  }, [client, state, loadVoices]);

  const media = (rel: string) =>
    info ? `http://127.0.0.1:${info.port}/media/${SLUG}/${rel}?token=${encodeURIComponent(info.token)}` : '';

  return (
    <Page
      title="Step 4.1 · Voice (ElevenLabs)"
      intro="The engine talks to ElevenLabs with a key kept in the macOS Keychain (or ELEVENLABS_API_KEY). Synthesis returns MP3 audio with per-character timings and is cached by a hash of the text, voice and settings in the project's audio/ folder, so the same line never costs twice."
    >
      {error && (
        <span role="alert" className="app-error">
          {error}
        </span>
      )}
      <Panel
        title="API key"
        action={
          status && (
            <Chip tone={status.configured ? 'ok' : 'neutral'}>
              {status.configured ? `Set · ${status.source}` : 'Not set'}
            </Chip>
          )
        }
      >
        <form
          style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            void act('key', async () => {
              setStatus(await client!.call('tts.setKey', { apiKey: key }));
              setKey('');
              await loadVoices();
            });
          }}
        >
          <div style={{ flex: '1 1 320px' }}>
            <Field
              label="ElevenLabs API key"
              hint="Checked against ElevenLabs before it is stored. It is never shown again, logged or given to the agent."
            >
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="sk_…"
                />
              )}
            </Field>
          </div>
          <Button type="submit" variant="primary" disabled={!key.trim() || !!busy}>
            {busy === 'key' ? 'Checking…' : 'Save key'}
          </Button>
          {status?.configured && status.source !== 'env' && (
            <Button
              variant="ghost"
              disabled={!!busy}
              onClick={() =>
                void act('clear', async () => {
                  setStatus(await client!.call('tts.clearKey', {}));
                  setVoices([]);
                })
              }
            >
              Remove key
            </Button>
          )}
        </form>
      </Panel>

      <Panel
        title="Synthesize a line"
        action={
          <Button
            size="sm"
            disabled={!status?.configured || !!busy}
            onClick={() => void act('voices', () => loadVoices(true))}
          >
            Refresh voices
          </Button>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: 16 }}>
          <Field label={`Voice (${voices.length})`}>
            {(id) => (
              <Select
                id={id}
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                disabled={!voices.length}
              >
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.description ? ` · ${v.description}` : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Text">
            {(id) => <TextArea id={id} rows={2} value={text} onChange={(e) => setText(e.target.value)} />}
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
          <Button
            variant="primary"
            disabled={!voice || !text.trim() || !!busy}
            onClick={() =>
              void act('synth', async () => {
                const t0 = performance.now();
                const r = await client!.call('tts.synthesize', { slug: SLUG, text, voiceId: voice });
                setResult({ ...r, ms: performance.now() - t0 });
              })
            }
          >
            {busy === 'synth' ? 'Synthesizing…' : 'Synthesize'}
          </Button>
          {result && (
            <>
              <Chip tone={result.cached ? 'ok' : 'info'}>
                {result.cached ? 'Cache hit' : 'New from ElevenLabs'}
              </Chip>
              <span className="mono" style={{ fontSize: 12, color: 'var(--gray-600)' }}>
                {result.duration.toFixed(2)} s audio · {result.alignment.chars.length} chars ·{' '}
                {Math.round(result.ms)} ms · {result.hash}
              </span>
            </>
          )}
        </div>
        {result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            <audio
              controls
              src={media(result.audio)}
              aria-label="Synthesized line"
              style={{ width: '100%' }}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {words(result.alignment).map((w, i) => (
                <span
                  key={i}
                  className="mono"
                  style={{
                    fontSize: 12,
                    padding: '2px 6px',
                    borderRadius: 6,
                    background: 'var(--steel-100)',
                    color: 'var(--steel-ink)',
                  }}
                >
                  {w.w}{' '}
                  <span style={{ opacity: 0.7 }}>
                    {w.start.toFixed(2)}–{w.end.toFixed(2)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
      </Panel>
    </Page>
  );
}
