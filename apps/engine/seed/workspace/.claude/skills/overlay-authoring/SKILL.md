---
name: overlay-authoring
description: How to write an overlay component (React + GSAP + optional React Three Fiber) for Tutorial Studio - the module contract, SDK hooks, determinism rules, WSO2 motion and theme, and reuse-first. Read before creating or editing any file under overlays/ or projects/*/overlays/.
---

# Writing overlay components

Overlays are React components rendered on top of the recording (and through the same camera,
so they stay attached during zooms). The timeline holds instances: a component reference, a
time range, an optional anchor (a step's target) and props.

## Reuse first

1. `list_overlays` shows core, workspace and project components with their prop schemas.
2. Prefer a core overlay with different props, then a workspace one. Write a new component only
   when none fits. New components go in `projects/<slug>/overlays/<Name>.tsx`; the retrospective
   may promote good ones to the shared `overlays/` library.
3. Add instances with `apply_timeline_patch`, never by editing `tutorial.json`.

## Module contract

```tsx
import { z } from 'zod';
import { DomLayer, theme, useAnchor, useGsap, type OverlayMeta, type OverlayProps } from '@studio/overlay-sdk';

const Props = z.object({
  title: z.string(),
  accent: z.enum(['orange', 'steel']).default('orange'),
});
type Props = z.infer<typeof Props>;

export const meta: OverlayMeta = {
  name: 'StepBadge',
  description: 'A numbered badge that pops in next to the step target', // shown in the library
  props: Props, // validates instances and drives the inspector form
  defaultDuration: 3,
};

export default function StepBadge({ props, duration }: OverlayProps<Props>) {
  const anchor = useAnchor(); // target box in stage px, or null when not anchored
  const scope = useGsap((tl) => {
    tl.from('.badge', { autoAlpha: 0, scale: 0.8, duration: theme.duration.enter, ease: theme.ease.pop })
      .to('.badge', { autoAlpha: 0, duration: theme.duration.exit }, duration - theme.duration.exit);
  }, [props.title]);
  if (!anchor) return null;
  return (
    <DomLayer follow>
      <div ref={scope}>
        <div className="badge" style={{ position: 'absolute', left: anchor.x + anchor.w + 16, top: anchor.y }}>
          {props.title}
        </div>
      </div>
    </DomLayer>
  );
}
```

- File name = component name, PascalCase: `StepBadge.tsx` → `project:StepBadge`.
- Allowed imports: `react`, `react-dom`, `zod`, `gsap`, `three`, `@react-three/fiber`,
  `@studio/overlay-sdk`, `@studio/overlays-core`, `@studio/stage`, `@studio/core`, and relative files.
  Anything else fails to load.
- Give every prop a default where a sensible one exists, so the inspector can add the overlay.

## SDK

| Import | Use |
|---|---|
| `useOverlayTime()` | `{ t, progress, duration, global }`: seconds into the instance, 0..1, its length, tutorial time |
| `useAnchor()` | The anchored step target as `{ x, y, w, h }` in stage px (null if unanchored) |
| `useGsap((tl) => …, deps)` | A paused GSAP timeline the stage seeks to `t`. Returns a ref for the scope element; class selectors resolve inside it |
| `<DomLayer follow>` | Absolutely positioned DOM over the stage. `follow` moves with the camera (zooms) |
| `<ThreeLayer>` | R3F content in the shared scene (glows, particles, 3D arrows). Use `useStageToScene()` to place it |
| `useStageSize()`, `useCamera()`, `useRecording()` | Stage size (1920×1080), camera state, recorded events |
| `theme` | WSO2 colours, fonts, radius, shadow, eases and durations |

## Determinism (required)

Export renders frames one at a time in a headless browser, so a component must look the same
every time it is drawn at the same `t`:

- Animate only through `useGsap` (or values computed from `useOverlayTime()`).
- No CSS transitions or animations, no `setTimeout`/`setInterval`, no `requestAnimationFrame`.
- No `Math.random()` (derive variation from props or the instance id), no `Date.now()`.
- No network requests or external assets; fonts come from the theme.

## Check your work (required)

After writing or editing a component, run `check_overlay({"file": "overlays/<Name>.tsx"})` (paths
are relative to the project, or `overlays/…` at the workspace root for shared ones). It:

1. type-checks the file, 2. lints it for the determinism rules above, 3. bundles it,
4. renders it in the tutorial (its first instance, or a test instance with default props on the
   first step) at its start, 25%, 50%, 75%, end and just after, with the recording and camera,
5. renders one moment twice to prove the frame depends only on time and props,

and returns the problems plus a contact sheet. Look at the sheet: is it beside its anchor and not
covering it, readable, inside the frame at every zoom, entering and leaving cleanly? Fix every
problem and run it again until it passes. `times` checks specific output times; `instanceId` picks
an instance. `capture_frame` shows the recording only; `check_overlay` shows the composited frame.

## Motion and look (WSO2)

- Colours from `theme.color`: orange for the action or call to action, navy for text panels, steel
  for secondary marks. White text on orange and navy.
- Inter for text (`theme.font.sans`), JetBrains Mono for code and paths. Sentence case.
- Enter with `theme.ease.pop` or `theme.ease.out` over `theme.duration.enter`; exit faster
  (`theme.duration.exit`) ending exactly at `duration`.
- Text sizes on the 1920×1080 stage: 28–36 px body, 44–64 px titles. Keep 48 px from the edges.
- Don't cover the element the step is about: place callouts beside the anchor, not on it.
