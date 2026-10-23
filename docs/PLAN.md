# WSO2 Tutorial Studio: plan

## Context
Making WSO2 product tutorials by hand is slow. We record the screen, write narration, add callouts and edit the video, and all of it has to be redone whenever the UI changes. This tool does that work automatically:

- Point it at a product: **VS Code-based WSO2 products first** (WSO2 Integrator/BI, Micro Integrator, Ballerina extensions), then SaaS web consoles (Choreo, Asgardeo, Bijira).
- A headless Claude Code agent writes a Playwright script, runs it, and records the screen.
- A separate editor window shows the recording live while it happens.
- After recording, the same editor produces the narration, the ElevenLabs voice-over and captions.
- **Overlays are animated React components that the agent writes** (React + React Three Fiber + GSAP). They are composited with the video so the result looks like one video.
- **Animated explainers can be inserted anywhere in the tutorial**, for example a full-screen motion-graphic scene that explains a concept ("how the listener routes a request") between two recorded steps. The agent writes them with the same React/R3F/GSAP stack, with their own narration, and they blend in with transitions.
- You can point at a spot or box on a frame and ask the agent to add or change things there.
- Outputs: an **MP4 with burned-in overlays**, **SRT/VTT captions**, a **Markdown step-by-step doc**, and the **reusable Playwright script**.
- **The tool learns.** Knowledge about each product and component is stored as Claude Code skills, general lessons go in a shared CLAUDE.md, and good overlay components go into a shared library. The agent only researches the live UI again when a script fails after a UI change, and then it updates the skill itself.

`/Users/admin/Desktop/tutorial-tool` is empty, so this is a new project. Node 20, ffmpeg and VS Code are already installed.

## Decisions
- **Desktop app: Tauri v2.**
  - Rust shell with a React/Vite UI and two windows: **Studio** (the editor) and **Live** (the recording view plus agent activity).
  - A **Node sidecar** (`apps/engine`) runs Playwright, the Claude Agent SDK, ElevenLabs, the overlay bundler and export.
  - The UI talks to the sidecar over a local WebSocket.
- **Agent:** the Claude Code Agent SDK (`@anthropic-ai/claude-agent-sdk`, `query()`), which is headless Claude Code.
  - Streaming-input prompt, so chat and annotations go into the live session.
  - `options.resume` for sessions.
  - `settingSources: ['project']` and `cwd = workspace/projects/<slug>`.
- **TTS:** ElevenLabs only. Use `with-timestamps` for character alignment, which drives captions and timing.
- **Composition engine: our own, no Remotion.** A React "stage" renders the video plus overlay components as a pure function of time `t`.
  - The video plays on a plane inside a shared **R3F** scene (GPU).
  - Overlays are React components: R3F/three.js for GPU visuals, React DOM/SVG for rich typography, and GSAP for animation.
  - **Preview:** the stage runs live in the Tauri webview.
  - **Export:** the same stage runs in a hidden GPU-enabled Chromium (Playwright already provides it) and is stepped through time frame by frame.
- **Cursor, zoom and captions** are ordinary built-in overlay components, driven by the recorded `events.jsonl`. The cursor is drawn in post, never injected into VS Code.

## Repo layout
```
tutorial-tool/                    # app code (pnpm monorepo)
  apps/desktop/                   # Tauri v2 (src-tauri Rust + React UI: Studio + Live windows)
  apps/engine/                    # Node sidecar: WS API, agent sessions, recorder, TTS, bundler, export
  packages/core/                  # zod schemas: Timeline, Step, OverlayInstance, Annotation, Patch
  packages/recorder/              # Playwright runtime helpers + launchers (vscode, web)
  packages/stage/                 # composition runtime: <Stage>, time context, video plane, camera, clock shim
  packages/overlay-sdk/           # what overlay authors import: hooks, GSAP/R3F bindings, theme, types
  packages/overlays-core/         # built-ins: Cursor, ClickRipple, Zoom, Captions, Blur, Callout, Highlight, TitleCard
  packages/scenes-core/           # built-in explainer primitives (BlueprintFlow, LayeredPanels, CodeTrace, CardDeck, TermSpotlight, BlueprintDive, DepthLayers) + transitions
  packages/tts/                   # ElevenLabs client
  packages/exporters/             # MP4 renderer (headless GPU Chromium), SRT/VTT, Markdown doc
workspace/                        # its OWN git repo, so CLAUDE.md and skill lookup walk up to it
  CLAUDE.md                       # common knowledge; the agent appends to it after each tutorial
  .claude/skills/
    tutorial-authoring/SKILL.md   # scripts with packages/recorder, pacing, narration style
    overlay-authoring/SKILL.md    # how to write overlay components: SDK contract, determinism rules, motion style
    explainer-authoring/SKILL.md  # how to storyboard and build explainer scenes: beats, VO sync, brand motion, transitions
    skill-maintenance/SKILL.md    # when and how to research the UI and update product skills
    vscode-platform/SKILL.md      # generic VS Code automation: command palette, explorer, webviews, quick picks
    wso2-integrator/              # one folder per product
      SKILL.md                    # overview, extension id/version, setup, navigation map, component index
      components/<component>.md   # flows, selectors, gotchas, last_verified, product_version
      pages/<component>.ts        # reusable Playwright page-object helpers
  scenes/                         # SHARED explainer-scene library (e.g. RequestFlow.tsx), grown across tutorials
  overlays/                       # SHARED overlay library, grown by the agent across tutorials
    <Name>.tsx  +  index.json     # name, description, propsSchema summary, preview thumbnail
  theme/wso2.ts                   # motion and brand tokens: colours, fonts, easings, durations
  products.json
  projects/<slug>/
    CLAUDE.md                     # tutorial brief
    tutorial.json                 # timeline, the single source of truth
    script.spec.ts                # generated Playwright script, kept for re-recording
    overlays/<Name>.tsx           # tutorial-specific components (can be promoted to workspace/overlays)
    scenes/<Name>.tsx             # tutorial-specific explainer scenes (can be promoted to workspace/scenes)
    fixtures/  recordings/take-N/{video.mp4, events.jsonl}  audio/  output/
```

## Components

### 1. Recorder (`packages/recorder`)
- **VS Code launcher (first):**
  - `@vscode/test-electron` downloads a pinned VS Code build.
  - The WSO2 extension is installed into an isolated `--extensions-dir`.
  - Playwright `_electron.launch` with a fixture folder, `--user-data-dir=<tmp>`, `--disable-workspace-trust`, a seeded `settings.json` (theme, zoom, fixed window size, no notifications) and `recordVideo`.
  - Extension webviews are reached with `frameLocator`. Native OS dialogs are avoided by using commands instead.
- **Web launcher (later):** Chromium with a `storageState` saved from a one-time manual login.
- **Helpers:**
  - `tut.step(id, title, fn)`, `tut.click`, `tut.type`, `tut.hold` and `tut.mask` log steps, mouse paths, clicks, typing and target bounding boxes (webview coordinates converted to window coordinates) to `events.jsonl`.
  - After the take, the video is re-encoded to MP4 with dense keyframes (`-g 1` or a short GOP) so it seeks quickly and exactly.
- **Live view:** CDP `Page.startScreencast` sends JPEG frames over WebSocket to the Live window.
- **`dryRun` mode:** used for validation.

### 2. Agent orchestration (`apps/engine/agent`)
- One long-lived `query()` per project, with a streaming-input queue fed by chat and annotations.
- **In-process MCP tools** (`createSdkMcpServer`):
  - `get_timeline`, and `apply_timeline_patch` (zod-validated, broadcast to the UI)
  - `run_script({mode})`, which returns the failing step, error, screenshot and accessibility snapshot
  - `inspect_ui` (research), `capture_frame(t, region?)`, `generate_voiceover(stepIds)`, `export({formats})`
  - **`check_overlay(file)`**: type-check, bundle, lint against the determinism rules, then render it at sample times. Returns errors and **rendered frames as images**, so the agent sees its own overlay and iterates.
  - **`check_scene(file)`**: the same checks for an explainer scene, plus a contact sheet of one frame per beat and the beat-to-voice-over alignment.
  - `insert_explainer({at, brief})`: splits the recording at `at` (step boundary or playhead), proposes a storyboard, and inserts the scene with transitions once the user approves.
  - `list_overlays` and `promote_overlay(name)`, for the shared library.
- **Pipeline (phases in one session, driven by skills):**
  1. Plan the outline.
  2. Write the script from page objects.
  3. Dry run.
  4. **Repair and research only on failure.** Update `components/*.md` and `pages/*.ts`, commit, then retry with a cap and escalate to the user.
  5. Record, streamed live.
  6. **Post-production:**
     - Narration, then the ElevenLabs voice-over.
     - Fit the timing per step (holds or freezes, voice-over padding).
     - Lay out the built-in overlays from `events.jsonl` (cursor, ripples, zooms).
     - Write custom overlay components where the tutorial needs them. Reuse from `workspace/overlays` first.
     - Propose explainer scenes where a concept is easier to show than to click through. The agent suggests them in the outline at the Plan phase, the user approves them, and they're built here. Reuse from `workspace/scenes` first.
  7. **Retrospective:** product facts go to the skills, general lessons to `workspace/CLAUDE.md`, reusable overlays are promoted, then a git commit.
- The message stream goes to the Live window's activity feed.

### 3. Timeline model (`packages/core`)
`Timeline { takes, scenes[Scene], transitions[{between:[sceneA,sceneB], component, duration}], steps[{id,title,start,end,narration,voId,bbox}], overlays[OverlayInstance], captions, annotations[{id,t,rect|point,comment,status}] }`

The tutorial is an ordered list of **scenes**. Overlays, captions and the voice-over sit on the global (output) time, across scenes.
```jsonc
// recording scene: ranges of a take, plus holds/freezes/speed
{ "id": "sc_1", "kind": "recording", "take": "take-2", "segments": [{ "src": [0, 36] }, { "hold": 4 }, { "src": [36, 94] }] }
// explainer scene: a full-frame component; duration follows its narration
{ "id": "sc_2", "kind": "explainer", "component": "project:RequestFlow",
  "props": { "path": "/greeting", "port": 9090 },
  "narration": ["When a request hits port 9090…", "…the listener matches /greeting…"],
  "beats": [{ "id": "b1", "at": "vo:0" }, { "id": "b2", "at": "vo:1" }, { "id": "b3", "at": "word:matches" }],
  "duration": "auto" }
```
```jsonc
// OverlayInstance: a reference to a component plus its props, not static content
{ "id": "ov_12", "component": "workspace:CodeTypewriterCallout",   // or "project:..." / "core:Zoom"
  "start": 41.2, "end": 46.0, "layer": 30,
  "anchor": { "stepId": "s4", "target": "primary" },               // follows the recorded element bbox
  "props": { "title": "Service path", "code": "/greeting", "accent": "orange" } }
```
Every change is a validated patch, which gives undo/redo and keeps both windows in sync.

### 4. Composition engine and agent-authored overlays

**Overlay component contract** (`packages/overlay-sdk`):
```tsx
import { z } from 'zod';
import { useOverlayTime, useAnchor, useGsap, ThreeLayer, DomLayer, theme } from '@studio/overlay-sdk';

export const meta = {
  name: 'CodeTypewriterCallout',
  description: 'Callout that types out a code snippet next to an element',
  props: z.object({ title: z.string(), code: z.string(), accent: z.enum(['orange','blue']).default('orange') }),
};

export default function CodeTypewriterCallout({ props, duration }) {
  const anchor = useAnchor();                  // element rect in stage px, already through the camera/zoom
  const root = useRef<HTMLDivElement>(null);
  useGsap((tl) => {                            // paused GSAP timeline, seeked to overlay-local t every frame
    tl.from(root.current, { scale: 0.8, autoAlpha: 0, ease: theme.ease.pop, duration: 0.3 })
      .to('.code', { text: props.code, duration: 1.2, ease: 'none' })
      .to(root.current, { autoAlpha: 0, duration: 0.25 }, duration - 0.25);
  }, [props]);
  return (<>
    <ThreeLayer>{/* optional R3F content: glow plane, particles, 3D arrow, shader ring around anchor */}</ThreeLayer>
    <DomLayer><div ref={root} style={{ left: anchor.right + 16, top: anchor.top }}>…</div></DomLayer>
  </>);
}
```
- **SDK hooks:**
  - `useOverlayTime()`, which gives local and global `t` (no wall clock)
  - `useGsap()`, a paused timeline that the stage seeks
  - `useAnchor()`, `useCamera()`, `useStageSize()`, `useNarration()` (current words, for syncing emphasis to the voice-over), `theme`
  - `<ThreeLayer>`, a portal into the shared R3F scene
  - `<DomLayer>`, an absolutely positioned DOM layer over the canvas, clipped to the stage
- **Determinism (needed for frame-exact export):**
  - Components must be a pure function of `t`. GSAP's ticker is turned off; the stage calls `tl.seek(t)`.
  - R3F runs with `frameloop="never"` and the stage calls `advance()`.
  - A **clock shim** in the render context overrides `Date.now`, `performance.now`, `requestAnimationFrame` and timers to virtual time.
  - An ESLint rule pack plus a check that rendering the same `t` twice gives identical frames reject CSS animations/transitions, `Math.random` without a seed, and network fetches.

**Making it feel like a single video:**
- The video itself is a texture on a plane in the same R3F scene, with sRGB in and out and no tone mapping, so there's no colour seam between video and 3D overlays.
- **Zoom/pan is the R3F camera.** Anchored DOM and 3D overlays are projected through the same camera, so they stay attached during zooms.
- A shared `theme` (fonts, palette, easings, durations) keeps the motion design consistent. The `overlay-authoring` skill tells the agent to use it.
- Optional motion blur on camera moves and soft shadows/depth on overlays.
- Fixed 1920×1080 stage at DPR 1 in both preview and export. Fonts are bundled locally.

**Loading and hot reload:**
- The engine runs **Vite in middleware mode** over `workspace/overlays` and `projects/<slug>/overlays`. It serves `overlays-core` and the SDK as shared singletons (one React, three.js and GSAP).
- The Studio preview dynamically imports components by id. When the agent saves a `.tsx`, HMR swaps it into the preview immediately.
- Each overlay renders inside an **error boundary**. Errors show as a red badge on the timeline and are fed back to the agent automatically.
- **Security:** agent-written code runs only in the sandboxed stage webview or export Chromium. Tauri IPC is not exposed to the stage frame, there's no Node access, and network is blocked except the local Vite origin.

**Three ways overlays get created** (all end up as `OverlayInstance` patches):
1. **Auto-generated** from `events.jsonl` using core components (cursor path, ripple, zoom, blur).
2. **Agent-written:** for example, an annotation like "add a callout here showing the endpoint being typed". The agent reuses or creates a component, verifies it with `check_overlay`, and inserts the instance.
3. **User:** drag/resize the anchor and position on the canvas, set timing on the overlay track, and edit props in a form generated from the component's zod `props`. The user can also ask the agent to edit the component's code.

### 4b. Animated explainer scenes

**What they are.** A full-frame React component (`packages/overlay-sdk`, same stack: R3F for 3D and diagrams, DOM/SVG for typography, GSAP for animation) that takes over the stage for a while. It isn't layered on the video. Typical uses: request-flow diagrams, architecture zoom-ins, "what is a listener" concept cards, code walkthroughs, before/after comparisons. They can sit between recorded steps, or at the start or end as an intro or recap.

**Contract** (extends the overlay contract):
```tsx
export const meta = { name: 'RequestFlow', kind: 'scene', props: z.object({ path: z.string(), port: z.number() }),
  beats: ['client', 'listener', 'resource', 'response'] };
export default function RequestFlow({ props }) {
  const beat = useBeat();                    // which beat is active + progress, from VO word timings
  useGsap((tl, { beatAt }) => {              // place tweens at beat times, not hard-coded seconds
    tl.from('.client', { x: -80, autoAlpha: 0 }, beatAt('client'))
      .to('.packet', { motionPath: '#wire', duration: 0.8 }, beatAt('listener'));
  });
  return <SceneFrame theme="wso2-dark">…</SceneFrame>;   // brand backdrop, safe margins, footer mark
}
```
- **`useBeat()` and `beatAt()`** tie animation to the narration. Beats are anchored to voice-over lines or specific words (from ElevenLabs alignment). If the narration is edited or re-voiced, the animation re-times automatically instead of drifting.
- **`<SceneFrame>`** applies the WSO2 brand rules (navy gradient or white backdrop, 84px safe margin, left-edge accent, footer mark, Inter type scale), so explainers look consistent with each other.
- Scenes can embed brand assets (architecture diagrams, logos) and **live material from the recording**: `useRecordingFrame(take, t)` brings a recorded frame in as a texture. That lets a scene, for example, shrink the VS Code screen into a box in the diagram, then expand back.

**Seamless in and out (transitions).** Transitions are components too (`core:ZoomThrough`, `core:Crossfade`, `core:Push`, `core:FreezeMorph`). `FreezeMorph` freezes the last recorded frame, then animates it into the explainer's first layout (for example the screen shrinks into a node in the diagram), and plays in reverse on the way back. The cursor and camera state carry across, so cutting away and back feels continuous rather than like jumping to a slide.

**Workflow:**
1. **Trigger.** Any of: the agent proposes it in the outline; the user clicks **"Insert explainer here"** on the timeline at the playhead or a step boundary; or the user annotates a frame ("explain what happens to this request").
2. **Storyboard first.** The agent writes a short storyboard: beats, narration lines and one rough frame per beat, from `check_scene`. The Studio shows it as cards for approval or edits, before any detailed animation work.
3. **Build.** The agent writes or reuses `scenes/<Name>.tsx`, generates the voice-over, and iterates with `check_scene` until the contact sheet matches the storyboard.
4. **Refine.** The user scrubs, annotates frames inside the scene ("make this arrow orange", "hold here longer"), and the agent patches the component or its props.
5. **Learn.** Good scenes are promoted to `workspace/scenes/` with a description and thumbnail, so later tutorials reuse them (for example one `RequestFlow` scene with different props).

**Export.** Explainer scenes with no recorded footage and mostly R3F content go through the GPU fast path (canvas → `VideoEncoder`), so they're cheap to render.

### 5. Desktop UI (`apps/desktop`)
- **Live window:** screencast, agent activity feed, current step, pause/stop.
- **Studio window:**
  - Stage preview with real-time playback and scrubbing.
  - Multi-track timeline: a **scene track** (recording and explainer blocks, transition handles), plus steps, overlays, voice-over and captions; a props inspector.
  - **"Insert explainer here"** at the playhead or a step boundary. A storyboard panel shows the beats as cards, each with a rough frame, editable narration, approve and regenerate.
  - Scene library browser next to the overlay library.
  - Overlay library browser (thumbnails from `index.json`).
  - "Regenerate VO" per step.
- **Annotation:** pause, click a point or drag a box, then type a request. The agent receives the cropped frame, coordinates, nearby steps, overlays and narration.
- **Chat panel:** free-form instructions to the same session.
- **Export dialog.**

### 6. Exporters
- **MP4 (GPU):**
  - Launch hidden Chromium with GPU (ANGLE Metal/D3D/Vulkan) on the export page, which mounts the same `<Stage>`.
  - For each frame `t`: seek the video and wait for the decoded frame (WebCodecs `VideoDecoder` from the dense-keyframe MP4, uploaded as a texture), set the virtual clock, seek GSAP, `advance()` R3F, then capture.
  - **Capture path:** Chromium's GPU compositor output, including the WebGL canvas and DOM overlays, through CDP `HeadlessExperimental.beginFrame` (Linux/Windows) or `Page.captureScreenshot` (macOS, `optimizeForSpeed`).
  - Frames are streamed to ffmpeg with a **hardware encoder** (`h264_videotoolbox` / `h264_nvenc` / `hevc_*`) and the voice-over mix.
  - The timeline is split into chunks across N parallel Chromium workers, then joined with ffmpeg concat.
  - **Fast path:** for time ranges with no DOM layers active, the R3F canvas is turned directly into a `VideoFrame` and encoded in the page with the WebCodecs `VideoEncoder`, skipping screenshot readback.
- **SRT/VTT:** from ElevenLabs alignment.
- **Markdown doc:** step titles, instructions rewritten from the narration, and key-frame stills rendered through the same stage.
- **Script:** `script.spec.ts`, kept for re-recording.

## Milestones
1. **Scaffold:** pnpm monorepo, Tauri app with two windows, Node sidecar WS, core schemas, workspace repo seeded with `CLAUDE.md` and the skills (`tutorial-authoring`, `overlay-authoring`, `skill-maintenance`, `vscode-platform`).
2. **VS Code recorder and live view:** launcher, helpers, `events.jsonl`, screencast. Test with a hand-written WSO2 Integrator flow.
3. **Stage and SDK:** `<Stage>` with the video plane and camera, clock shim, `useGsap`, `ThreeLayer`/`DomLayer`, core overlays, Vite HMR overlay loading, Studio preview and timeline.
4. **Agent loop:** SDK session and MCP tools, plan → script → dry run → repair/research → record, skill self-update, `check_overlay` with rendered-frame feedback.
5. **Post-production and interaction:** ElevenLabs voice-over and timing fit, annotations, chat, undo, overlay library promotion.
5b. **Explainer scenes:** scene model in the timeline, `SceneFrame`/`useBeat`/`useRecordingFrame`, core transitions (FreezeMorph, ZoomThrough, Crossfade), storyboard flow, `check_scene`, `insert_explainer`, scene library.
6. **Export:** GPU Chromium renderer, parallel chunks, hardware encode, SRT/VTT, Markdown.
7. **Web target:** Chromium launcher with storageState, plus Choreo/Asgardeo skills.

## Verification
- **Milestone 2:** run the hand-written script. The Live window shows frames, and `events.jsonl` has webview bounding boxes in correct window coordinates.
- **Milestone 3:** a sample overlay using R3F, GSAP and DOM at once plays smoothly at 60 fps in the preview, stays attached during a zoom, and scrubbing to any `t` shows the same frame as playback.
- **Milestone 4:**
  - From an empty skill, "Create an HTTP service in WSO2 Integrator" makes the agent research, write skills, record and commit.
  - A second related tutorial runs **without** research.
  - A deliberately broken selector gets repaired and the skill updated.
  - The agent writes a new overlay, sees its frames from `check_overlay`, and fixes a seeded mistake.
- **Milestone 5:** an annotation "add a typewriter callout here" creates a component and an instance at that rect and time. The voice-over lines up with the action.
- **Milestone 5b:**
  - "Insert explainer here" between steps 2 and 3 with the brief "explain how a request reaches /greeting": a storyboard appears, approving it builds the scene, and FreezeMorph transitions in and back out to the recording.
  - Editing one narration line re-times the scene's beats with no code change.
  - The promoted scene is reused with different props in a second tutorial.
- **Milestone 6:**
  - Frames exported at chosen `t` values match preview stills (pixel diff within tolerance).
  - Rendering twice gives identical output.
  - `ffprobe` validates the MP4, and export with the hardware encoder is near or above real time.
  - VTT/SRT and `tutorial.md` are valid.

## Open risks
- **Export speed with DOM overlays:** screenshot capture limits throughput. Mitigated by parallel workers and the canvas-only fast path. The skill nudges the agent towards R3F for heavy animation.
- **Agent-written code quality:** mitigated by `check_overlay` (type-check, lint, determinism check, visual feedback), error boundaries and the curated shared library.
- **Small differences between the WebKit preview (Tauri on macOS) and the Chromium export:** use the same fonts, avoid engine-specific CSS, and check with the pixel-diff test. If needed, the preview can be pinned to the same output by rendering stills through the export Chromium.
- **Packaging the Node sidecar in Tauri:** bundled Node binary, plain `node` in dev.
- **Personal data in VS Code UI:** seeded clean profile and blur overlays.
