import type { OverlayModule } from '@studio/overlay-sdk';
import CardDeck, { meta as cardDeckMeta } from './CardDeck';
import TermSpotlight, { meta as termSpotlightMeta } from './TermSpotlight';
import BlueprintDive, { meta as blueprintDiveMeta } from './BlueprintDive';
import DepthLayers, { meta as depthLayersMeta } from './DepthLayers';
import BlueprintFlow, { meta as blueprintFlowMeta } from './BlueprintFlow';
import LayeredPanels, { meta as layeredPanelsMeta } from './LayeredPanels';
import CodeTrace, { meta as codeTraceMeta } from './CodeTrace';

export const PACKAGE = {
  name: '@studio/scenes-core',
  role: 'Built-in explainer scenes and transitions',
} as const;

export { BlueprintFlow, LayeredPanels, CodeTrace, CardDeck, TermSpotlight, BlueprintDive, DepthLayers };
export { FlowProps } from './flow';
export { ConceptProps } from './concepts';
export { ArchitectureProps } from './architecture';

/** Built-in explainer scenes by component id (`core:BlueprintFlow`, …). */
export const coreScenes: Record<string, OverlayModule> = {
  'core:BlueprintFlow': { default: BlueprintFlow, meta: blueprintFlowMeta } as OverlayModule,
  'core:LayeredPanels': { default: LayeredPanels, meta: layeredPanelsMeta } as OverlayModule,
  'core:CodeTrace': { default: CodeTrace, meta: codeTraceMeta } as OverlayModule,
  'core:CardDeck': { default: CardDeck, meta: cardDeckMeta } as OverlayModule,
  'core:TermSpotlight': { default: TermSpotlight, meta: termSpotlightMeta } as OverlayModule,
  'core:BlueprintDive': { default: BlueprintDive, meta: blueprintDiveMeta } as OverlayModule,
  'core:DepthLayers': { default: DepthLayers, meta: depthLayersMeta } as OverlayModule,
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
  [
    { id: 'core:CardDeck', label: 'Deck' },
    { id: 'core:TermSpotlight', label: 'Spotlight' },
  ],
  [
    { id: 'core:BlueprintDive', label: 'Blueprint' },
    { id: 'core:DepthLayers', label: 'Layers' },
  ],
];

/** The looks a scene's component can switch to (empty when it has no alternatives). */
export function looksFor(component: string): { id: string; label: string }[] {
  return explainerLooks.find((g) => g.some((l) => l.id === component)) ?? [];
}

export * from './transitions';
