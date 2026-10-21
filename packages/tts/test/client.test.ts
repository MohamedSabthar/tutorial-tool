import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElevenLabs, createTtsCache, synthesisHash, TtsError } from '../src/node';

const okBody = {
  audio_base64: Buffer.from('mp3-bytes').toString('base64'),
  alignment: {
    characters: ['H', 'i', '.'],
    character_start_times_seconds: [0, 0.1, 0.2],
    character_end_times_seconds: [0.1, 0.2, 0.35],
  },
};

function fakeFetch(responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (!r) throw new Error('no more responses');
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('ElevenLabs client', () => {
  const sleeps: number[] = [];
  const sleep = async (ms: number) => void sleeps.push(ms);
  beforeEach(() => void (sleeps.length = 0));

  it('calls with-timestamps and returns audio with character timings', async () => {
    const f = fakeFetch([json(okBody)]);
    const el = createElevenLabs({ apiKey: 'k', fetch: f.fn, sleep });
    const r = await el.synthesize({ text: 'Hi.', voiceId: 'v1', previousText: 'Before.' });
    expect(r.audio.toString()).toBe('mp3-bytes');
    expect(r.alignment).toEqual({ chars: ['H', 'i', '.'], starts: [0, 0.1, 0.2], ends: [0.1, 0.2, 0.35] });
    expect(f.calls[0]!.url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/v1/with-timestamps?output_format=mp3_44100_128',
    );
    expect((f.calls[0]!.init.headers as Record<string, string>)['xi-api-key']).toBe('k');
    expect(JSON.parse(String(f.calls[0]!.init.body))).toMatchObject({
      text: 'Hi.',
      model_id: 'eleven_v4',
      previous_text: 'Before.',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    });
    expect(JSON.parse(String(f.calls[0]!.init.body)).voice_settings).not.toHaveProperty('style');
  });

  it('sends the full voice settings to models that take them', async () => {
    const f = fakeFetch([json(okBody)]);
    const el = createElevenLabs({ apiKey: 'k', fetch: f.fn, sleep });
    await el.synthesize({ text: 'Hi.', voiceId: 'v1', modelId: 'eleven_multilingual_v2' });
    expect(JSON.parse(String(f.calls[0]!.init.body)).voice_settings).toEqual({
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0,
      use_speaker_boost: true,
      speed: 1,
    });
  });

  it('retries 429 and 5xx with backoff, honouring Retry-After', async () => {
    const f = fakeFetch([
      json({}, 429, { 'retry-after': '2' }),
      json({}, 503),
      new Error('ECONNRESET'),
      json(okBody),
    ]);
    const el = createElevenLabs({ apiKey: 'k', fetch: f.fn, sleep, backoffMs: 100 });
    await el.synthesize({ text: 'Hi.', voiceId: 'v1' });
    expect(sleeps).toEqual([2000, 200, 400]);
  });

  it('gives up with a readable error that never contains the key', async () => {
    const f = fakeFetch([json({ detail: { message: 'Invalid API key' } }, 401)]);
    const el = createElevenLabs({ apiKey: 'secret-key', fetch: f.fn, sleep });
    const err = await el.synthesize({ text: 'Hi.', voiceId: 'v1' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TtsError);
    expect(String(err)).toContain('401 (check the ElevenLabs API key): Invalid API key');
    expect(String(err)).not.toContain('secret-key');
  });

  it('lists voices across pages, sorted by name', async () => {
    const f = fakeFetch([
      json({
        voices: [
          {
            voice_id: 'b',
            name: 'Brian',
            category: 'premade',
            labels: { accent: 'american', age: 'middle aged' },
          },
        ],
        has_more: true,
        next_page_token: 't2',
      }),
      json({ voices: [{ voice_id: 'a', name: 'Alice', description: 'Clear' }], has_more: false }),
    ]);
    const voices = await createElevenLabs({ apiKey: 'k', fetch: f.fn, sleep }).listVoices();
    expect(voices.map((v) => [v.id, v.name, v.description])).toEqual([
      ['a', 'Alice', 'Clear'],
      ['b', 'Brian', 'american · middle aged'],
    ]);
    expect(f.calls[1]!.url).toContain('next_page_token=t2');
  });
});

describe('TTS cache', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'tts-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('hits the cache for the same input, and only then', async () => {
    let calls = 0;
    const synth = createTtsCache({
      synthesize: async () => {
        calls++;
        return { audio: Buffer.from('mp3'), alignment: { chars: ['a'], starts: [0], ends: [0.4] } };
      },
    });
    const input = { text: 'Hello', voiceId: 'v1' };
    const [a, b] = await Promise.all([synth(dir, input), synth(dir, input)]);
    expect(calls).toBe(1);
    expect(a.cached).toBe(false);
    expect(b.hash).toBe(a.hash);
    const c = await synth(dir, input);
    expect(c).toMatchObject({ cached: true, duration: 0.4 });
    expect(await readFile(c.audioPath, 'utf8')).toBe('mp3');
    await synth(dir, { ...input, settings: { stability: 0.9 } });
    expect(calls).toBe(2);
    expect(synthesisHash(input)).not.toBe(synthesisHash({ ...input, voiceId: 'v2' }));
  });
});
