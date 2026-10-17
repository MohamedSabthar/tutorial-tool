export const PACKAGE = {
  name: '@studio/tts',
  role: 'ElevenLabs client with alignment',
} as const;

// Browser-safe: schemas only. The client and the cache (Node) are in '@studio/tts/node'.
export * from './schemas';
