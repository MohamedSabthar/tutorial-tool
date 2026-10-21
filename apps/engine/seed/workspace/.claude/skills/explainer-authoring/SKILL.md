---
name: explainer-authoring
description: How to write and place animated explainer scenes (full-frame motion graphics with their own narration, inserted between recorded steps) - reuse first, SceneFrame, beats tied to the narration, the built-in scenes, recorded frames, and checking the result. Read before creating or editing anything under scenes/ or projects/*/scenes/, or adding an explainer scene to the timeline.
---

# Explainer scenes

An explainer is a full-frame scene in the timeline between recorded parts (`kind: "explainer"`
scenes). It has a component, props, narration lines and beats. Its length follows its narration
(`duration: "auto"`): estimated from the text until it is voiced, then from the voice-over.

## Reuse first

1. `list_scenes` shows built-in (`core:`), workspace and project scenes with their prop schemas.
2. Built-ins cover most needs with props alone:
   - `core:DiagramFlow`: boxes in a row and a packet travelling between them, one hop per beat
     (request flows, pipelines).
   - `core:ConceptCards`: up to four cards appearing one per beat (defining terms).
   - `core:CodeWalkthrough`: a code listing with a highlight moving through line ranges.
   - `core:ArchitectureZoom`: boxes on a 12×6 grid, zooming into one per beat.
3. Write `projects/<slug>/scenes/<Name>.tsx` only when none fits. A thin wrapper around a
   built-in with tutorial-specific props is often enough (e.g. `RequestFlow` = `DiagramFlow` with
   the tutorial's nodes).

## Beats: animate on the narration, not on seconds

- Declare the beat names in `meta.beats` (in order). By default beat i fires when narration
  line i starts, so write one narration line per beat.
- A scene in the timeline may override cues in `beats`: `{"id": "match", "at": "word:matches"}`
  (a narration word), `"vo:2"` (line 2) or a number of seconds.
- In the component: `useBeat()` gives `{ current, index, progress, since, at(id), reached(id) }`;
  `useGsap((tl, { beatAt, wordAt }) => tl.from('.x', {...}, beatAt('listener')))` places tweens at beats.
- Never hard-code times for things the narration talks about: when the narration is edited or
  re-voiced, beats move and the animation follows.

## Module contract

```tsx
import { z } from 'zod';
import { SceneFrame, sceneType, tween, useBeat, useOverlayTime, type OverlayMeta, type OverlayProps } from '@studio/overlay-sdk';

const Props = z.object({ path: z.string().default('/greeting') });
type Props = z.infer<typeof Props>;

export const meta: OverlayMeta = {
  name: 'PathAnatomy',
  kind: 'scene',
  description: 'Splits a URL into listener, base path and resource, one part per beat',
  props: Props,
  beats: ['host', 'base', 'resource'],
};

export default function PathAnatomy({ props }: OverlayProps<Props>) {
  const { t } = useOverlayTime();
  const beat = useBeat();
  return (
    <SceneFrame theme="wso2-dark" eyebrow="HTTP services">
      <div style={{ fontSize: sceneType.title, opacity: tween(t, 0, 0.5) }}>{props.path}</div>
      {beat.reached('base') && <div style={{ opacity: tween(t, beat.at('base'), beat.at('base') + 0.4) }}>…</div>}
    </SceneFrame>
  );
}
```

- `<SceneFrame theme="wso2-dark" | "wso2-light">` draws the backdrop, the orange edge accent, the
  footer mark and an 84 px safe area; lay content out inside it. `sceneType` is the type scale
  (display 76, title 56, heading 40, body 30, caption 22); `scenePalette(theme)` its colours.
- `tween(t, a, b)` is an eased 0..1 between two times, for styles computed from time.
- `<RecordingFrame time={takeSeconds} style={...} />` (or `useRecordingFrame(time)` for a three.js
  texture) brings a recorded frame into the scene, e.g. the product screen shrinking into a box.
- Same determinism rules as overlays: no clocks, randomness, timers, network or CSS animation.
- Imports: as for overlays, plus `@studio/scenes-core` (the built-ins).

## Look

WSO2 brand: navy backdrop (dark) or white (light), orange for what the narration is about right
now, Inter, sentence case, one idea per beat, no more than ~12 words on screen per beat.
