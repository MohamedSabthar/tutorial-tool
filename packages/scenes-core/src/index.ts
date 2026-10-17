import type { OverlayModule } from '@studio/overlay-sdk';
import DiagramFlow, { meta as diagramFlowMeta } from './DiagramFlow';
import ConceptCards, { meta as conceptCardsMeta } from './ConceptCards';
import CodeWalkthrough, { meta as codeWalkthroughMeta } from './CodeWalkthrough';
import ArchitectureZoom, { meta as architectureZoomMeta } from './ArchitectureZoom';

export const PACKAGE = {
  name: '@studio/scenes-core',
  role: 'Built-in explainer scenes and transitions',
} as const;

export { DiagramFlow, ConceptCards, CodeWalkthrough, ArchitectureZoom };

/** Built-in explainer scenes by component id (`core:DiagramFlow`, …). */
export const coreScenes: Record<string, OverlayModule> = {
  'core:DiagramFlow': { default: DiagramFlow, meta: diagramFlowMeta } as OverlayModule,
  'core:ConceptCards': { default: ConceptCards, meta: conceptCardsMeta } as OverlayModule,
  'core:CodeWalkthrough': { default: CodeWalkthrough, meta: codeWalkthroughMeta } as OverlayModule,
  'core:ArchitectureZoom': { default: ArchitectureZoom, meta: architectureZoomMeta } as OverlayModule,
};
