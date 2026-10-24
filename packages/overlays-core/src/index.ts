import type { OverlayModule } from '@studio/overlay-sdk';
import {
  Arrow,
  arrowMeta,
  Blur,
  blurMeta,
  Box,
  boxMeta,
  Callout,
  calloutMeta,
  Highlight,
  highlightMeta,
  Zoom,
  zoomMeta,
} from './anchored';
import { ClickRipple, clickRippleMeta, Cursor, cursorMeta } from './pointer';
import {
  Captions,
  captionsMeta,
  FastForward,
  fastForwardMeta,
  Skip,
  skipMeta,
  Keystroke,
  keystrokeMeta,
  TextLabel,
  textLabelMeta,
  TitleCard,
  titleCardMeta,
} from './screen';

export const PACKAGE = {
  name: '@studio/overlays-core',
  role: 'Built-in overlays: cursor, zoom, callout, blur, captions',
} as const;

export { pointerAt } from './pointer';
export { zoomMove } from './anchored';

const mod = (meta: OverlayModule['meta'], component: OverlayModule['default']): OverlayModule => ({
  meta,
  default: component,
});

/**
 * Built-in overlays by component ref. Each has zod props with defaults; anchored ones need an
 * instance anchor; Cursor/ClickRipple read the recording; Zoom drives the camera (see zoomMove).
 */
export const coreOverlays: Record<string, OverlayModule> = {
  'core:Cursor': mod(cursorMeta, Cursor as OverlayModule['default']),
  'core:ClickRipple': mod(clickRippleMeta, ClickRipple as OverlayModule['default']),
  'core:Zoom': mod(zoomMeta, Zoom as OverlayModule['default']),
  'core:Highlight': mod(highlightMeta, Highlight as OverlayModule['default']),
  'core:Box': mod(boxMeta, Box as OverlayModule['default']),
  'core:Arrow': mod(arrowMeta, Arrow as OverlayModule['default']),
  'core:Callout': mod(calloutMeta, Callout as OverlayModule['default']),
  'core:Blur': mod(blurMeta, Blur as OverlayModule['default']),
  'core:TitleCard': mod(titleCardMeta, TitleCard as OverlayModule['default']),
  'core:TextLabel': mod(textLabelMeta, TextLabel as OverlayModule['default']),
  'core:Keystroke': mod(keystrokeMeta, Keystroke as OverlayModule['default']),
  'core:Captions': mod(captionsMeta, Captions as OverlayModule['default']),
  'core:FastForward': mod(fastForwardMeta, FastForward as OverlayModule['default']),
  'core:Skip': mod(skipMeta, Skip as OverlayModule['default']),
};

/** Instance props with the component's defaults applied (throws on invalid props). */
export function resolveProps(ref: string, props: Record<string, unknown>): Record<string, unknown> {
  const m = coreOverlays[ref];
  if (!m) throw new Error(`unknown core overlay "${ref}"`);
  return m.meta.props.parse(props) as Record<string, unknown>;
}
