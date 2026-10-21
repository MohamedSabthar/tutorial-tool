import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  formatIssues,
  Pronunciation,
  PronunciationsFile,
  RpcError,
  speakable,
  wordsFromAlignment,
  writtenWords,
  type CharAlignment,
} from '@studio/core';

/** The workspace's `pronunciations.json`: how product terms are spoken in every voice-over. */
export class Pronunciations {
  constructor(private workspace: string) {}

  private get file() {
    return path.join(this.workspace, 'pronunciations.json');
  }

  async list(): Promise<Pronunciation[]> {
    const text = await readFile(this.file, 'utf8').catch(() => null);
    if (text === null) return [];
    const r = PronunciationsFile.safeParse(JSON.parse(text));
    return r.success ? r.data.pronunciations : [];
  }

  async save(list: Pronunciation[]): Promise<Pronunciation[]> {
    const parsed = Pronunciation.array().safeParse(list);
    if (!parsed.success) throw new RpcError(formatIssues(parsed.error), 'bad_request');
    await writeFile(this.file, JSON.stringify({ pronunciations: parsed.data }, null, 2) + '\n');
    return parsed.data;
  }
}

/**
 * A voice-over request for narration: the spoken text (terms replaced) for the line and its
 * neighbours, and a function that turns ElevenLabs' alignment of it back into written words.
 * The post voice-over and the pace for recording both use this, so their requests (and cache
 * entries) match.
 */
export function voiceLine(
  text: string,
  rules: Pronunciation[],
  neighbours: { prev?: string | undefined; next?: string | undefined } = {},
) {
  const s = speakable(text, rules);
  const prev = neighbours.prev ? speakable(neighbours.prev, rules).spoken : undefined;
  const next = neighbours.next ? speakable(neighbours.next, rules).spoken : undefined;
  return {
    text: s.spoken,
    ...(prev ? { previousText: prev } : {}),
    ...(next ? { nextText: next } : {}),
    words: (alignment: CharAlignment) => writtenWords(s, wordsFromAlignment(alignment)),
  };
}
