import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ElevenLabs } from '@studio/tts/node';
import { secretStore } from '../src/secrets';
import { TtsService } from '../src/tts';

describe('TtsService', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'tts-svc-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const fake = (calls: string[]) => (key: string) =>
    ({
      listVoices: async () => {
        if (key !== 'good') throw new Error('ElevenLabs 401 (check the ElevenLabs API key): invalid');
        return [{ id: 'v1', name: 'Ava', category: null, description: '', previewUrl: null }];
      },
      synthesize: async (r: { text: string }) => {
        calls.push(r.text);
        return { audio: Buffer.from('mp3'), alignment: { chars: ['H'], starts: [0], ends: [0.5] } };
      },
    }) as unknown as ElevenLabs;

  it('stores a key only after ElevenLabs accepts it, and caches synthesis per project', async () => {
    const secrets = secretStore({ env: {}, keychain: false, file: path.join(dir, 'secrets.json') });
    const calls: string[] = [];
    const tts = new TtsService(secrets, (slug) => path.join(dir, slug), fake(calls));
    expect(await tts.status()).toEqual({ configured: false, source: null });
    await expect(tts.synthesize('p', { text: 'Hi', voiceId: 'v1' })).rejects.toThrow(/not set up/);
    await expect(tts.setKey('bad')).rejects.toThrow(/401/);
    expect((await tts.status()).configured).toBe(false);
    expect(await tts.setKey('good')).toEqual({ configured: true, source: 'file' });
    expect(((await stat(path.join(dir, 'secrets.json'))).mode & 0o777).toString(8)).toBe('600');
    expect((await tts.listVoices()).map((v) => v.name)).toEqual(['Ava']);

    const a = await tts.synthesize('p', { text: 'Hi', voiceId: 'v1' });
    const b = await tts.synthesize('p', { text: 'Hi', voiceId: 'v1' });
    expect([a.cached, b.cached, calls.length]).toEqual([false, true, 1]);
    expect(a.audio).toMatch(/^audio\/[0-9a-f]{24}\.mp3$/);
    expect(await tts.clearKey()).toEqual({ configured: false, source: null });
  });

  it('lets an environment variable override the stored key', async () => {
    const secrets = secretStore({
      env: { ELEVENLABS_API_KEY: 'from-env' },
      keychain: false,
      file: path.join(dir, 's.json'),
    });
    expect(await secrets.get('elevenlabs')).toEqual({ value: 'from-env', source: 'env' });
  });
});
