import {
  Alignment,
  DEFAULT_FORMAT,
  SynthesisRequest,
  TimestampsResponse,
  Voice,
  VoicesResponse,
  type SynthesisRequest as SynthesisInput,
} from './schemas';

export interface ElevenLabsOptions {
  apiKey: string;
  baseUrl?: string;
  /** Requests in flight at once (ElevenLabs limits concurrency per plan). */
  maxConcurrent?: number;
  /** Attempts after the first for 429 and 5xx responses and network errors. */
  retries?: number;
  /** First backoff delay in ms; doubles each attempt (Retry-After wins when given). */
  backoffMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface Synthesis {
  /** MP3 bytes. */
  audio: Buffer;
  alignment: Alignment;
}

export class TtsError extends Error {
  override name = 'TtsError';
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

/** A tiny semaphore: at most `n` tasks run at once, the rest wait in order. */
function limiter(n: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>((r) => waiting.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

/**
 * ElevenLabs text-to-speech with character timings. The key is only ever sent in the
 * `xi-api-key` header; errors never include it.
 */
export function createElevenLabs(opts: ElevenLabsOptions) {
  const base = (opts.baseUrl ?? 'https://api.elevenlabs.io').replace(/\/$/, '');
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retries = opts.retries ?? 4;
  const backoff = opts.backoffMs ?? 800;
  const limit = limiter(opts.maxConcurrent ?? 2);

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await limit(() =>
          doFetch(`${base}${path}`, {
            ...init,
            headers: { 'xi-api-key': opts.apiKey, 'content-type': 'application/json', ...init.headers },
          }),
        );
      } catch (e) {
        if (attempt >= retries) throw new TtsError(`ElevenLabs is unreachable: ${String(e)}`, null);
        await sleep(backoff * 2 ** attempt);
        continue;
      }
      if (res.ok) return res.json();
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < retries) {
        const after = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : backoff * 2 ** attempt);
        continue;
      }
      const body = await res.text().catch(() => '');
      let detail = body.slice(0, 300);
      try {
        const j = JSON.parse(body) as { detail?: { message?: string } | string };
        detail = typeof j.detail === 'string' ? j.detail : (j.detail?.message ?? detail);
      } catch {
        // Not JSON.
      }
      const hint = res.status === 401 ? ' (check the ElevenLabs API key)' : '';
      throw new TtsError(`ElevenLabs ${res.status}${hint}: ${detail}`, res.status);
    }
  }

  return {
    async synthesize(input: SynthesisInput): Promise<Synthesis> {
      const req = SynthesisRequest.parse(input);
      const raw = await request(
        `/v1/text-to-speech/${encodeURIComponent(req.voiceId)}/with-timestamps?output_format=${DEFAULT_FORMAT}`,
        {
          method: 'POST',
          body: JSON.stringify({
            text: req.text,
            model_id: req.modelId,
            voice_settings: {
              stability: req.settings.stability,
              similarity_boost: req.settings.similarityBoost,
              style: req.settings.style,
              use_speaker_boost: req.settings.speakerBoost,
              speed: req.settings.speed,
            },
            ...(req.previousText ? { previous_text: req.previousText } : {}),
            ...(req.nextText ? { next_text: req.nextText } : {}),
          }),
        },
      );
      const r = TimestampsResponse.parse(raw);
      // `alignment` follows the text as sent; `normalized_alignment` the spoken form ("9090" → words).
      const a = r.alignment ?? r.normalized_alignment;
      if (!a) throw new TtsError('ElevenLabs returned no alignment', null);
      return {
        audio: Buffer.from(r.audio_base64, 'base64'),
        alignment: Alignment.parse({
          chars: a.characters,
          starts: a.character_start_times_seconds,
          ends: a.character_end_times_seconds,
        }),
      };
    },

    async listVoices(): Promise<Voice[]> {
      const voices: Voice[] = [];
      let token: string | null | undefined = null;
      do {
        const q = new URLSearchParams({ page_size: '100' });
        if (token) q.set('next_page_token', token);
        const r = VoicesResponse.parse(await request(`/v2/voices?${q}`));
        for (const v of r.voices) {
          const labels = Object.values(v.labels ?? {}).filter((x): x is string => !!x);
          voices.push(
            Voice.parse({
              id: v.voice_id,
              name: v.name ?? v.voice_id,
              category: v.category ?? null,
              description: labels.length ? labels.join(' · ') : (v.description ?? ''),
              previewUrl: v.preview_url ?? null,
            }),
          );
        }
        token = r.has_more ? r.next_page_token : null;
      } while (token);
      return voices.sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}

export type ElevenLabs = ReturnType<typeof createElevenLabs>;
