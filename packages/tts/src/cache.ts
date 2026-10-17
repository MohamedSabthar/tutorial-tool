import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  Alignment,
  DEFAULT_FORMAT,
  SynthesisRequest,
  type SynthesisRequest as SynthesisInput,
} from './schemas';
import type { ElevenLabs } from './client';

export interface CachedSynthesis {
  /** Cache key: hash of text, voice, model, settings, neighbours and format. */
  hash: string;
  /** `<dir>/<hash>.mp3` */
  audioPath: string;
  alignment: Alignment;
  /** Seconds, from the last character's end. */
  duration: number;
  cached: boolean;
}

export function synthesisHash(input: SynthesisInput): string {
  const r = SynthesisRequest.parse(input);
  const key = JSON.stringify([
    r.text,
    r.voiceId,
    r.modelId,
    r.settings,
    r.previousText ?? null,
    r.nextText ?? null,
    DEFAULT_FORMAT,
  ]);
  return createHash('sha256').update(key).digest('hex').slice(0, 24);
}

/**
 * Synthesizes through a folder cache: `<hash>.mp3` plus `<hash>.json` (the alignment). The
 * same input never calls ElevenLabs twice, and parallel calls for one input share a request.
 */
export function createTtsCache(client: Pick<ElevenLabs, 'synthesize'>) {
  const inflight = new Map<string, Promise<CachedSynthesis>>();
  return async function synthesizeCached(dir: string, input: SynthesisInput): Promise<CachedSynthesis> {
    const hash = synthesisHash(input);
    const audioPath = path.join(dir, `${hash}.mp3`);
    const metaPath = path.join(dir, `${hash}.json`);
    const key = `${dir}\0${hash}`;
    const running = inflight.get(key);
    if (running) return running;
    const job = (async (): Promise<CachedSynthesis> => {
      try {
        const alignment = Alignment.parse(JSON.parse(await readFile(metaPath, 'utf8')));
        await readFile(audioPath).then((b) => {
          if (!b.length) throw new Error('empty audio');
        });
        return { hash, audioPath, alignment, duration: alignment.ends.at(-1) ?? 0, cached: true };
      } catch {
        // Not cached yet.
      }
      const { audio, alignment } = await client.synthesize(input);
      await mkdir(dir, { recursive: true });
      await writeFile(`${audioPath}.tmp`, audio);
      await rename(`${audioPath}.tmp`, audioPath);
      await writeFile(metaPath, JSON.stringify(alignment));
      return { hash, audioPath, alignment, duration: alignment.ends.at(-1) ?? 0, cached: false };
    })().finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
  };
}
