import type { OverlayModule } from '@studio/overlay-sdk';
import DiagramFlow, { meta as diagramFlowMeta } from './DiagramFlow';
import ConceptCards, { meta as conceptCardsMeta } from './ConceptCards';
import CodeWalkthrough, { meta as codeWalkthroughMeta } from './CodeWalkthrough';
import ArchitectureZoom, { meta as architectureZoomMeta } from './ArchitectureZoom';
import BlueprintFlow, { meta as blueprintFlowMeta } from './BlueprintFlow';
import LayeredPanels, { meta as layeredPanelsMeta } from './LayeredPanels';
import CodeTrace, { meta as codeTraceMeta } from './CodeTrace';

export const PACKAGE = {
  name: '@studio/scenes-core',
  role: 'Built-in explainer scenes and transitions',
} as const;

export {
  DiagramFlow,
  ConceptCards,
  CodeWalkthrough,
  ArchitectureZoom,
  BlueprintFlow,
  LayeredPanels,
  CodeTrace,
};
export { FlowProps } from './flow';

/** Built-in explainer scenes by component id (`core:DiagramFlow`, …). */
export const coreScenes: Record<string, OverlayModule> = {
  'core:DiagramFlow': { default: DiagramFlow, meta: diagramFlowMeta } as OverlayModule,
  'core:ConceptCards': { default: ConceptCards, meta: conceptCardsMeta } as OverlayModule,
  'core:CodeWalkthrough': { default: CodeWalkthrough, meta: codeWalkthroughMeta } as OverlayModule,
  'core:ArchitectureZoom': { default: ArchitectureZoom, meta: architectureZoomMeta } as OverlayModule,
  'core:BlueprintFlow': { default: BlueprintFlow, meta: blueprintFlowMeta } as OverlayModule,
  'core:LayeredPanels': { default: LayeredPanels, meta: layeredPanelsMeta } as OverlayModule,
  'core:CodeTrace': { default: CodeTrace, meta: codeTraceMeta } as OverlayModule,
};

/**
 * Looks an explainer can switch between without losing its content: scenes in one group share
 * their props (a look ignores what it doesn't show).
 */
export const explainerLooks: { id: string; label: string }[][] = [
  [
    { id: 'core:DiagramFlow', label: 'Classic' },
    { id: 'core:BlueprintFlow', label: 'Blueprint' },
    { id: 'core:LayeredPanels', label: 'Panels' },
  ],
  [
    { id: 'core:CodeWalkthrough', label: 'Classic' },
    { id: 'core:CodeTrace', label: 'Trace' },
  ],
];

/** The looks a scene's component can switch to (empty when it has no alternatives). */
export function looksFor(component: string): { id: string; label: string }[] {
  return explainerLooks.find((g) => g.some((l) => l.id === component)) ?? [];
}

export * from './transitions';
