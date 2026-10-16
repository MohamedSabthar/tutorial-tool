export const PACKAGE = {
  name: '@studio/overlay-sdk',
  role: 'Hooks and types overlay/scene authors import',
} as const;

export * from './types';
export {
  OverlayContext,
  useAnchor,
  useCamera,
  useOverlayInstance,
  useOverlayTime,
  useStageSize,
  type OverlayInstanceContext,
  type OverlayTime,
} from './context';
export { gsap, useGsap } from './gsap';
export { DomLayer, OverlayBoundary, OverlayRenderer, ThreeLayer, useStageToScene } from './layers';
export { theme, type Theme } from './theme';

// Re-exported so overlay authors get three.js JSX element types (<mesh>, <ringGeometry>, …).
export type { ThreeElements } from '@react-three/fiber';
