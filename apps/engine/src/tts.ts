import path from 'node:path';
import { RpcError } from '@studio/core';
import {
  createElevenLabs,
  createTtsCache,
  TtsError,
  type CachedSynthesis,
  type ElevenLabs,
  type SynthesisRequest,
  type Voice,
} from '@studio/tts/node';
import type { SecretStore } from './secrets';

const VOICES_TTL_MS = 10 * 60_000;

/**
 * ElevenLabs for the engine: the client is built from the stored key on demand, voices are
 * cached for a few minutes, and audio is cached per project in `audio/` by request hash.
 */
export class TtsService {
  private client: { key: string; el: ElevenLabs; cached: ReturnType<typeof createTtsCache> } | null = null;
  private voices: { at: number; list: Voice[] } | null = null;

  constructor(
    private secrets: SecretStore,
    private projectDir: (slug: string) => string,
    private make: (apiKey: string) => ElevenLabs = (apiKey) => createElevenLabs({ apiKey }),
  ) {}

  async status(): Promise<{ configured: boolean; source: 'env' | 'keychain' | 'file' | null }> {
    const k = await this.secrets.get('elevenlabs');
    return { configured: !!k, source: k?.source ?? null };
  }

  /** Checks the key against ElevenLabs before storing it. */
  async setKey(apiKey: string) {
    const key = apiKey.trim();
    if (!key) throw new RpcError('the key is empty', 'bad_request');
    try {
      this.voices = { at: Date.now(), list: await this.make(key).listVoices() };
    } catch (e) {
      throw new RpcError(e instanceof Error ? e.message : String(e), 'bad_request');
    }
    await this.secrets.set('elevenlabs', key);
    this.client = null;
    return this.status();
  }

  async clearKey() {
    await this.secrets.clear('elevenlabs');
    this.client = null;
    this.voices = null;
    return this.status();
  }

  private async get() {
    const k = await this.secrets.get('elevenlabs');
    if (!k) throw new RpcError('ElevenLabs is not set up: add an API key first', 'bad_request');
    if (this.client?.key !== k.value) {
      const el = this.make(k.value);
      this.client = { key: k.value, el, cached: createTtsCache(el) };
    }
    return this.client;
  }

  async listVoices(refresh = false): Promise<Voice[]> {
    if (!refresh && this.voices && Date.now() - this.voices.at < VOICES_TTL_MS) return this.voices.list;
    const { el } = await this.get();
    try {
      this.voices = { at: Date.now(), list: await el.listVoices() };
    } catch (e) {
      throw new RpcError(
        e instanceof Error ? e.message : String(e),
        e instanceof TtsError && e.status === 401 ? 'bad_request' : 'internal',
      );
    }
    return this.voices.list;
  }

  /** Synthesizes into `projects/<slug>/audio/<hash>.mp3` (cached). */
  async synthesize(slug: string, input: SynthesisRequest): Promise<CachedSynthesis & { audio: string }> {
    const { cached } = await this.get();
    const dir = path.join(this.projectDir(slug), 'audio');
    try {
      const r = await cached(dir, input);
      return { ...r, audio: `audio/${path.basename(r.audioPath)}` };
    } catch (e) {
      throw new RpcError(e instanceof Error ? e.message : String(e), 'internal');
    }
  }
}
