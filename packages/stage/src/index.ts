export const PACKAGE = {
  name: '@studio/stage',
  role: 'Composition runtime: Stage, virtual clock, video plane, camera',
} as const;

export * from './clock';
export * from './player';
export * from './Stage';
export * from './camera';
export * from './layers';
export * from './tunnel';
export * from './Scenes';
export * from './exportDriver';
export * from './frameProvider';
export * from './h264';
