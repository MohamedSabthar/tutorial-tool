import type { OverlayModule } from '@studio/overlay-sdk';
import ConceptCards, { meta as conceptCardsMeta } from './ConceptCards';
import ArchitectureZoom, { meta as architectureZoomMeta } from './ArchitectureZoom';
import BlueprintFlow, { meta as blueprintFlowMeta } from './BlueprintFlow';
import LayeredPanels, { meta as layeredPanelsMeta } from './LayeredPanels';
import CodeTrace, { meta as codeTraceMeta } from './CodeTrace';

export const PACKAGE = {
  name: '@studio/scenes-core',
  role: 'Built-in explainer scenes and transitions',
} as const;

export { ConceptCards, ArchitectureZoom, BlueprintFlow, LayeredPanels, CodeTrace };
export { FlowProps } from './flow';

/** Built-in explainer scenes by component id (`core:BlueprintFlow`, …). */
export const coreScenes: Record<string, OverlayModule> = {
  'core:ConceptCards': { default: ConceptCards, meta: conceptCardsMeta } as OverlayModule,
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
    { id: 'core:BlueprintFlow', label: 'Blueprint' },
    { id: 'core:LayeredPanels', label: 'Panels' },
  ],
];

/** The looks a scene's component can switch to (empty when it has no alternatives). */
export function looksFor(component: string): { id: string; label: string }[] {
  return explainerLooks.find((g) => g.some((l) => l.id === component)) ?? [];
}

export * from './transitions';
