export const PACKAGE = {
  name: '@studio/core',
  role: 'Zod schemas: timeline, scenes, overlays, patches, RPC',
} as const;

export * from './schemas';
export * from './patch';
export * from './timemap';
export * from './sample';
export * from './rpc';
export * from './derive';
export * from './agent';
export * from './pipeline';
export * from './brief';
export * from './voice';
export * from './captions';
export * from './runs';
