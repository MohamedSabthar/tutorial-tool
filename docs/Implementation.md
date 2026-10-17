# WSO2 Tutorial Studio: implementation plan

This is the step-by-step build plan for the design in [`PLAN.md`](./PLAN.md). The UI follows the mockups saved in [`../ui/`](../ui/README.md) (Projects → Brief → Live → Storyboard → Studio → Agent fix → Export).

**How to use this document**
- We work through the steps **in order, one step at a time**. Every step ends in something runnable or testable.
- Each step lists its **goal**, the **work**, the **files** it touches, and a **Done when** check. A step counts as done only when that check passes.
- When a step is finished, tick it in the [Progress tracker](#progress-tracker) and note anything that changed from the plan under [Decisions log](#decisions-log).
- If a step turns out bigger than expected, split it (e.g. `3.4a`, `3.4b`) instead of skipping ahead.
- **Every step ends with a UI test.** After a step, the app (`pnpm dev`) shows what the step added, so it can be tested end to end in the UI before moving on. Findings go in the Decisions log or become fix-up steps.

---

## Ground rules

| Area | Choice |
|---|---|
| Machine | macOS 15 on arm64. Rust 1.98, Node 20.19, pnpm 10.11, ffmpeg, VS Code 1.140 and Claude Code 2.1 are already installed. |
| Monorepo | pnpm workspaces plus TypeScript project references. Everything is ESM. |
| Language | TypeScript (strict) for everything except the Tauri shell (Rust). |
| Desktop | Tauri v2 with a React 18 + Vite UI and two windows (`studio`, `live`). |
| Engine | A Node sidecar (`apps/engine`) running Fastify and `ws`. The UI talks to it over a local WebSocket using a typed RPC and event protocol. |
| Agent | `@anthropic-ai/claude-agent-sdk` (`query()`, streaming input, in-process MCP tools). |
| Validation | `zod` for every schema: timeline, RPC, tool inputs. |
| Tests | `vitest` for unit and integration tests, `@playwright/test` for the recorder and end-to-end tests. |
| Lint/format | ESLint (flat config) + Prettier. A custom ESLint rule pack enforces determinism in overlays and scenes. |
| Styling (UI) | WSO2 Slides design-system tokens, light theme: white `#FFFFFF`, `#F3F3F3` surfaces, `#D7D7D7` hairlines, navy `#13213B` text, orange `#FF5800` primary with white text, steel blue `#4F7AA3` for annotations and gates, Inter, 14px radii. |
| Licences | No commercially licensed dependencies: no Remotion. GSAP and its plugins are free to use. three.js, R3F and mp4-muxer are MIT. |
| Secrets | `ANTHROPIC_API_KEY` (or the Claude login) and `ELEVENLABS_API_KEY` live in the macOS Keychain through Tauri, or in `.env.local` in dev. They're never committed. |

**Repo layout (target)** is the one in `PLAN.md`: `apps/desktop`, `apps/engine`, `packages/{core,recorder,stage,overlay-sdk,overlays-core,scenes-core,tts,exporters,ui}` and a separate git repo `workspace/`.

> `packages/ui` is a new addition compared with PLAN.md: the shared React component kit built from the design tokens (Button, Segmented, Chip, Panel, Pin, Timeline lanes). It's used by both windows.

---

## Progress tracker

- [x] **Phase 0: Foundations**
  - [x] 0.1 Monorepo scaffold
  - [x] 0.2 `packages/core` schemas
  - [x] 0.3 Engine skeleton and RPC
  - [x] 0.4 Tauri shell with two windows
  - [x] 0.5 `packages/ui` design tokens and kit
  - [x] 0.6 Workspace repo bootstrap
- [x] **Phase 1: VS Code recorder and Live window**
  - [x] 1.1 VS Code launcher
  - [x] 1.2 Recorder helpers and `events.jsonl`
  - [x] 1.3 Live screencast
  - [x] 1.4 Take post-processing
  - [x] 1.5 Hand-written reference tutorial
  - [x] 1.6 Live window UI (static data)
- [x] **Phase 2: Stage, overlay SDK, Studio preview**
  - [x] 2.1 Stage runtime and virtual clock
  - [x] 2.2 Video plane and camera
  - [x] 2.3 Overlay SDK hooks
  - [x] 2.4 Core overlays
  - [x] 2.5 Overlay hot-loading (Vite middleware)
  - [x] 2.6 Timeline store, patches, undo
  - [x] 2.7 Studio window: preview and timeline
  - [x] 2.8 Studio window: inspector and library
- [x] **Phase 3: Agent loop and self-learning skills**
  - [x] 3.1 Agent session manager
  - [x] 3.2 MCP tools: timeline and project
  - [x] 3.3 MCP tools: `run_script` and `inspect_ui`
  - [x] 3.4 Seed skills and CLAUDE.md
  - [x] 3.5 Pipeline orchestration and gates
  - [x] 3.6 Repair and research loop
  - [x] 3.7 Retrospective and knowledge commits
  - [x] 3.8 Projects, Brief and Storyboard screens
- [ ] **Phase 4: Voice-over and post-production**
  - [x] 4.1 ElevenLabs client
  - [x] 4.2 Narration and voice-over generation
  - [x] 4.3 Timing fit
  - [x] 4.4 Auto-overlays from events
  - [ ] 4.5 Captions model
- [ ] **Phase 5: Interaction: annotations, chat, agent-written overlays**
  - [ ] 5.1 Annotation tools on the preview
  - [ ] 5.2 Annotation → agent context
  - [ ] 5.3 `check_overlay` with rendered frames
  - [ ] 5.4 Agent runs, snapshots and Agent fix review
  - [ ] 5.5 Overlay library promotion
- [ ] **Phase 6: Explainer scenes**
  - [ ] 6.1 Scene model and scene track
  - [ ] 6.2 `SceneFrame`, `useBeat`, `useRecordingFrame`
  - [ ] 6.3 Transitions
  - [ ] 6.4 `insert_explainer` and the storyboard flow
  - [ ] 6.5 `check_scene` and the scene library
- [ ] **Phase 7: Export**
  - [ ] 7.1 Headless GPU render host
  - [ ] 7.2 Frame stepping and capture
  - [ ] 7.3 Hardware encode, audio mux, chunking
  - [ ] 7.4 Fast path (canvas → VideoEncoder)
  - [ ] 7.5 SRT/VTT and the Markdown doc
  - [ ] 7.6 Export screen
- [ ] **Phase 8: Hardening and packaging**
  - [ ] 8.1 Parity and determinism test suite
  - [ ] 8.2 Sidecar packaging and app bundle
  - [ ] 8.3 Settings, secrets and onboarding
- [ ] **Phase 9 (later): Web console target**

---

## Phase 0: Foundations

### 0.1 Monorepo scaffold
**Goal:** an empty monorepo that builds, lints and tests.
- `git init`, `.gitignore` (node_modules, dist, target, `.env*`, `workspace/projects/*/recordings`), `.editorconfig`, `.nvmrc` (20).
- Root `package.json` with pnpm workspaces (`apps/*`, `packages/*`), plus scripts `dev`, `build`, `test`, `lint`, `typecheck`.
- `tsconfig.base.json` (strict, `moduleResolution: bundler`, `jsx: react-jsx`) and per-package `tsconfig.json` with references.
- ESLint flat config, Prettier, and Vitest workspace config.
- Create empty packages with `package.json`, `src/index.ts` and one trivial test each.

**Files:** `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `vitest.workspace.ts`, `apps/*/package.json`, `packages/*/package.json`
**Done when:** `pnpm i && pnpm typecheck && pnpm lint && pnpm test` all pass.

### 0.2 `packages/core`: schemas
**Goal:** one source of truth for every data shape.
- **Zod schemas:** `Project`, `Timeline`, `Take`, `Scene` (recording | explainer), `Segment` (src | hold | freeze | speed), `Step`, `OverlayInstance`, `Anchor`, `Transition`, `Caption`, `Annotation`, `Beat`, `VoiceLine`, plus `RecorderEvent` (the lines of `events.jsonl`).
- **Patches:** `TimelinePatch` (RFC 6902 subset) with `applyPatch(timeline, patch)` and `invert(patch)` for undo, both validated.
- **Time mapping:** `timeMap(timeline)` converts between output time and source time and back, accounting for scenes, segments and transitions.
- **Exports:** inferred TS types, plus JSON Schema output (`zod-to-json-schema`) for agent tool descriptions.

**Files:** `packages/core/src/{schemas,patch,timemap}.ts`, `packages/core/test/*`
**Done when:**
- Unit tests cover patch apply/invert round-trips.
- `timeMap` passes these cases: holds, a freeze, an explainer inserted between two recording segments, and a transition overlap.
- Invalid patches are rejected with a readable error.

### 0.3 Engine skeleton and RPC
**Goal:** a sidecar process the UI can talk to.
- Fastify server bound to `127.0.0.1` on a random port. On start it prints `READY <port> <token>` to stdout. Every request needs the token: as a header for HTTP, and in the first message for WS.
- **WS protocol** in `packages/core/src/rpc.ts`:
  - Requests `{id, method, params}`, replies `{id, result|error}`, events `{event, data}`.
  - Methods are zod-typed.
  - Start with `ping`, `project.list`, `project.create`, `project.open`.
- **Project store:** reads and writes `workspace/projects/<slug>/` (`tutorial.json`, `CLAUDE.md`).
- **Static media route** `/media/<slug>/...` with HTTP range support, so `<video>` can seek.

**Files:** `apps/engine/src/{main,server,rpc,projects,media}.ts`
**Done when:** a Vitest integration test starts the engine, connects over WS, creates a project and reads it back. A range request returns `206`.

### 0.4 Tauri shell with two windows
**Goal:** the desktop app opens Studio and Live windows that are connected to the engine.
- `apps/desktop` is created from Tauri v2 with the React + Vite template.
- **Windows in `tauri.conf.json`:** `studio` (1440×960) and `live` (1440×900, opened on demand). Each loads a route of the same Vite app (`/#/studio`, `/#/live`).
- **Rust side:**
  - Spawns the engine (in dev: `node apps/engine/dist/main.js`; later the bundled sidecar) and parses `READY <port> <token>`.
  - Exposes `get_engine()` to the webview.
  - Kills the sidecar when the app exits.
- **UI client:** `useEngine()` hook with WS reconnect and typed `call(method, params)` and `on(event)`.
- **Security:** CSP limited to self plus the engine origin. Tauri IPC allow-list limited to the commands we define.

**Files:** `apps/desktop/src-tauri/{tauri.conf.json,src/main.rs,src/engine.rs}`, `apps/desktop/src/{main.tsx,engine.ts,routes/*}`
**Done when:** `pnpm dev` opens the Studio window and shows "Engine connected · ping 2 ms". "Open Live window" opens the second window, which is connected too.

### 0.5 `packages/ui`: design tokens and component kit
**Goal:** reusable UI parts that match the mockups.
- **Tokens:** `tokens.css` and `tokens.ts` from the design system (colours, Inter, 14px radii, shadows, motion `cubic-bezier(0.22,1,0.36,1)`).
- **Components:**
  - AppHeader (traffic-light space, logo mark, icon nav, context pill), Panel, Button (primary/secondary/ghost/danger), Segmented, Chip (status variants), Pin (annotation teardrop), Stepper (pipeline)
  - GateBanner, Field/TextArea/Select, MonoBox, EdgeAccent (orange left strip), Rule (2px orange)
- Bundle the WSO2 mark and logo assets from the design-system zip under `packages/ui/assets`.
- A **`/#/kit`** route in the desktop app renders every component in every state, for visual review.

**Files:** `packages/ui/src/**`, `apps/desktop/src/routes/kit.tsx`
**Done when:** the kit page matches the canvas mockups by eye, in light theme. Tab order works and every control has a label.

### 0.6 Workspace repo bootstrap
**Goal:** the knowledge base that Claude Code sessions run inside.
- Engine command `workspace.init(path)`: creates `workspace/` as its own git repo containing:
  - `CLAUDE.md`: common knowledge, with section headings only for now
  - `.claude/settings.json`: permissions allow-list for the tools the agent needs
  - `.claude/skills/` (empty), `overlays/`, `scenes/`, `theme/wso2.ts`
  - `products.json`, `projects/`
- New projects get `projects/<slug>/CLAUDE.md` from a template (goal, audience, product, constraints).

**Files:** `apps/engine/src/workspace.ts`, `apps/engine/templates/**`
**Done when:** running `init`, then creating a project, gives the expected tree and one initial commit. A manual `claude -p "list your skills" --cwd workspace/projects/demo` prints that it sees the workspace CLAUDE.md. Skills arrive in 3.4.

---

## Phase 1: VS Code recorder and Live window

### 1.1 VS Code launcher
**Goal:** launch a clean, repeatable VS Code with the WSO2 extension under Playwright.
- `@vscode/test-electron` downloads and caches a **pinned** VS Code build in `~/.tutorial-studio/vscode/<version>`.
- Install the extension (marketplace id or VSIX) into an isolated `--extensions-dir`, keyed by extension version.
- **Seeded user settings:** theme, `window.zoomLevel`, font size, `workbench.tips.enabled=false`, notifications off, telemetry off, a fixed window size of 1920×1080 at DPR 1, and an explicit `--disable-workspace-trust`.
- `launchVSCode({product, fixture, record?})` returns `{app, page, close()}` using Playwright `_electron.launch`.
- `products.json` entry for **WSO2 Integrator**.

**Files:** `packages/recorder/src/launch/vscode.ts`, `packages/recorder/src/settings/*.json`
**Done when:** a test opens VS Code with an empty fixture folder, finds the WSO2 Integrator activity-bar item, takes a screenshot at exactly 1920×1080, and closes cleanly. Running it twice gives the same layout.

### 1.2 Recorder helpers and `events.jsonl`
**Goal:** the API that generated scripts call.
- **`tut` helpers:**
  - `tut.step(id, title, fn)` logs step start and end.
  - `tut.click(locator, opts)` and `tut.type(locator, text, {cps})` move along a humanised mouse path (logged as points over time) and type at a human pace.
  - `tut.hold(ms)`, `tut.mask(locator, label)`, `tut.waitIdle()` (network and animation quiet).
- **Target bounding boxes:** each helper resolves the target's bbox. Webview iframes are converted to window coordinates by summing frame offsets.
- **Event stream:** events are typed with `RecorderEvent` and written to `recordings/take-N/events.jsonl` with monotonic `t`, which is aligned to video time using a start marker.
- **`mode: 'dry' | 'record'`:** dry runs use shorter waits, no video, and fail fast with the failing step, error, screenshot and an accessibility snapshot.

**Files:** `packages/recorder/src/{tut,events,bbox,human}.ts`
**Done when:** a sample script clicks into a webview input and types. The logged bbox, drawn over the screenshot, sits exactly on the element. Dry mode reports a deliberately wrong locator as `{stepId, error, screenshot, a11y}`.

### 1.3 Live screencast
**Goal:** the agent's view appears in the Live window as it happens.
- A CDP session on the Electron page runs `Page.startScreencast` (JPEG, quality 70, `everyNthFrame` tuned to about 25–30 fps). Each frame is acknowledged.
- The engine forwards frames as binary WS messages on channel `live.frame`. The UI draws them to a `<canvas>`.
- Overlay events (`live.action`: the current helper call and bbox) let the Live window draw the orange "what Playwright is doing" box.

**Files:** `packages/recorder/src/screencast.ts`, `apps/engine/src/live.ts`
**Done when:** during a sample run the Live window shows smooth frames with under 200 ms delay, and the action box follows each click or type.

### 1.4 Take post-processing
**Goal:** recordings that the editor can seek exactly.
- After the run, re-encode Playwright's `video.webm` to `video.mp4` with ffmpeg: H.264, `-g 15` (short GOP), `yuv420p`, constant frame rate 30.
- Detect the start marker frame, so video t=0 equals events t=0.
- Generate `poster.jpg` and a keyframe index.

**Files:** `packages/recorder/src/post.ts`
**Done when:**
- Seeking `<video>` to any timestamp shows the right frame, within 1 frame of the matching event.
- `ffprobe` reports CFR 30 at 1920×1080.

### 1.5 Hand-written reference tutorial
**Goal:** prove the recorder end to end before the agent exists.
- Write `workspace/projects/demo-http/script.spec.ts` by hand, covering six steps of "Create an HTTP service" in WSO2 Integrator.
- Write the first page objects by hand in `workspace/.claude/skills/wso2-integrator/pages/http-service.ts`. These become the seed skill in 3.4.

**Done when:** `pnpm rec demo-http` produces `video.mp4` and `events.jsonl` for all six steps, and the Live window shows the run.

### 1.6 Live window UI (static wiring)
**Goal:** the Live screen from the mockup, wired to real recorder events.
- **Layout:**
  - Header: REC pill, context pill, Pause agent, Stop take.
  - Left: pipeline stepper.
  - Centre: live view and step progress.
  - Right: agent console (Readable/Raw), with the steer input disabled until Phase 3.
- The step progress and the action box come from real events. The pipeline and console use placeholder data until 3.5.

**Files:** `apps/desktop/src/routes/live/**`
**Done when:** running the reference tutorial fills the step progress live, and Stop take ends the run cleanly.

---

## Phase 2: Stage, overlay SDK, Studio preview

### 2.1 Stage runtime and virtual clock
**Goal:** a React tree that is a pure function of time `t`.
- `<Stage timeline t={number} mode="preview"|"export">` provides `TimeContext`. A fixed 1920×1080 surface is scaled to fit in preview.
- **Clock shim** (export mode, and an opt-in in preview tests): overrides `Date.now`, `performance.now`, `requestAnimationFrame` and `setTimeout`/`setInterval` to virtual time.
- **Player controller:** play, pause, seek, rate. Real-time playback drives `t` from `requestAnimationFrame`. Scrubbing sets `t` directly.

**Files:** `packages/stage/src/{Stage,clock,player}.tsx`
**Done when:** a test component that shows `t` renders identical output for the same `t` across runs and stays correct when scrubbed backwards.

### 2.2 Video plane and camera
**Goal:** the recording rendered on the GPU inside the shared R3F scene.
- **Canvas:** an R3F `<Canvas frameloop="never">` with an orthographic camera, `toneMapping: NoToneMapping`, and sRGB output.
- **`<VideoPlane take>`:** in preview, a `<video>` element as a `VideoTexture`, synced to the stage time via `timeMap` and `requestVideoFrameCallback`. In export it uses a frame provider; see 7.2.
- **Camera:** driven by `core:Zoom` instances (pan and scale with easing). `useCamera()` exposes the current transform. A `project(rect)` helper maps source rects to stage pixels.
- **`<DomLayer>`:** an absolutely positioned layer over the canvas, clipped to the stage, and transformed with the same camera when asked.

**Files:** `packages/stage/src/{VideoPlane,camera,layers}.tsx`
**Done when:**
- The reference take plays in the stage at 60 fps.
- A hard-coded zoom keyframe pans and zooms smoothly.
- A DOM box anchored to a bbox stays on its element throughout the zoom.

### 2.3 Overlay SDK hooks
**Goal:** the stable API that overlay authors (the agent) code against.
- **`@studio/overlay-sdk` exports:**
  - Time and layout: `useOverlayTime()`, `useAnchor()`, `useCamera()`, `useStageSize()`
  - Animation: `useGsap(build, deps)` returns a paused GSAP timeline; the stage seeks it to local `t` every frame. GSAP's ticker is disabled.
  - Content: `useNarration()` for current words, filled in Phase 4. `useRecordingFrame()` arrives in 6.2.
  - Layers and theme: `ThreeLayer` (portal into the shared scene), `DomLayer`, `theme` (WSO2 tokens and easings)
- **Types:** `OverlayMeta` (name, description, zod `props`) and `OverlayProps`.
- **ErrorBoundary per overlay:** reports `{overlayId, error}` to the engine.

**Files:** `packages/overlay-sdk/src/**`
**Done when:** a sample overlay using GSAP plus a `ThreeLayer` mesh plus a `DomLayer` box animates correctly when played and when scrubbed, and looks the same at the same `t` either way.

### 2.4 Core overlays
**Goal:** the built-ins that auto-overlays (4.4) will use.
- `Cursor`: a path from events with smoothing and a configurable style.
- `ClickRipple`, `Zoom` (camera keys), `Highlight`/`Spotlight`, `Box`, `Arrow`, `Callout`, `TextLabel`, `TitleCard`, `Keystroke`, `Blur` (two-pass shader on a mask rect), `Captions` (screen space).
- Each has a zod `props` schema and default motion from `theme`.

**Files:** `packages/overlays-core/src/*.tsx`
**Done when:** a gallery route renders each core overlay on the reference take with sensible defaults. Blur hides text, and the cursor follows the recorded path.

### 2.5 Overlay hot-loading (Vite middleware)
**Goal:** components written to disk appear in the preview straight away.
- The engine runs Vite in middleware mode over `workspace/overlays`, `workspace/scenes`, `projects/<slug>/overlays` and `projects/<slug>/scenes`.
- React, three.js, GSAP and the SDK are **shared singletons**: an import map or dedupe pointing at the host's copies.
- **Component ids** are `core:Name`, `workspace:Name` and `project:Name`. The preview loads them with dynamic `import()` from the engine origin. HMR swaps changed modules.
- **Sandbox:** the stage runs in an iframe with no Tauri IPC and a CSP that allows only the engine origin. Errors are forwarded to the engine.

**Files:** `apps/engine/src/overlayServer.ts`, `packages/stage/src/loader.ts`, `apps/desktop/src/stage-frame/*`
**Done when:**
- Editing `project/overlays/Test.tsx` on disk updates the preview within about 1 s without losing the playhead.
- A thrown error shows a red badge on that overlay only.

### 2.6 Timeline store, patches, undo
**Goal:** one state model shared by both windows and the agent.
- **Owner:** the engine owns `tutorial.json`.
- **Changes:**
  - `timeline.patch(patch, {author: 'user'|'agent'|'auto', runId?})` validates, applies, saves, and broadcasts a `timeline.changed` event with the patch.
  - `timeline.undo` / `timeline.redo` use inverted patches, grouped per user gesture or per agent run.
- **UI copy:** a zustand store mirrors the timeline and applies broadcast patches, so the UI updates optimistically and reconciles.

**Files:** `apps/engine/src/timeline.ts`, `apps/desktop/src/state/timeline.ts`
**Done when:**
- Two windows stay in sync.
- Undo after a five-patch drag restores the original state in one step.
- An invalid patch is rejected and no window changes.

### 2.7 Studio window: preview and timeline
**Goal:** the centre and bottom of the Studio mockup, working.
- **Viewer:**
  - Stage preview inside a panel, with a progress bar showing step ticks and transport controls (previous/next step, play, timecode).
  - View segmented control: Final / With annotations / Raw take.
- **Timeline:**
  - Lanes: Scenes, Steps, Overlays, Camera, Voice-over, Captions, Annotations.
  - Interactions: zoom; drag to move or trim overlays (sends patches); split; white playhead with tab; keyboard shortcuts (Space, J/K/L, S, A, X).

**Files:** `apps/desktop/src/routes/studio/{Viewer,Transport,Timeline/*}.tsx`
**Done when:** you can scrub the reference take, see core overlays laid out by hand, drag an overlay's start on the timeline and watch the preview update, and undo it.

### 2.8 Studio window: inspector and library
**Goal:** the right column of the mockup.
- **Inspector:**
  - The form is generated from the selected component's zod `props` (string, number, enum, colour, boolean), plus start/end and an anchor picker that lists recorded targets.
  - Actions: "Open source" (in VS Code) and "Promote" (stub until 5.5).
- **Library:** Overlays/Explainers toggle with thumbnails taken from `index.json`. Dragging onto the timeline creates an instance.
- **Direct manipulation:** drag and resize on the preview with snapping to recorded element bboxes.

**Files:** `apps/desktop/src/routes/studio/{Inspector,Library,Manipulator}.tsx`
**Done when:** editing a callout's text in the inspector updates the preview, dragging it on the canvas re-anchors it, and both actions undo.

---

## Phase 3: Agent loop and self-learning skills

### 3.1 Agent session manager
**Goal:** one long-lived headless Claude Code session per project.
- `AgentSession` wraps `query()` with:
  - `prompt` as an async iterable fed by a queue (chat, annotations, pipeline instructions)
  - `cwd = workspace/projects/<slug>` and `settingSources: ['project']`, so both CLAUDE.md files and the skills load
  - `options.resume` from the stored `sessionId`
  - `mcpServers: { studio: <in-process server> }`
  - `allowedTools` and `permissionMode` from settings, with the `canUseTool` hook surfacing anything unexpected to the UI
- **Message handling:** messages are normalised into `agent.event` events (text, tool_use, tool_result, result, cost) for the Live console and the Studio agent panel. `interrupt()` is wired to Pause.
- **Robustness:** the generator is guarded so a thrown error never aborts the session silently. It logs and recovers.

**Files:** `apps/engine/src/agent/{session,queue,events}.ts`
**Done when:**
- Sending "Which skills and CLAUDE.md files can you see?" from the Studio agent box streams a reply that names the workspace CLAUDE.md.
- After restarting the app, the session resumes.

### 3.2 MCP tools: timeline and project
**Goal:** the agent changes the tutorial only through validated tools.
- **Tools** built with `createSdkMcpServer` and `tool()`:
  - `get_timeline` (whole timeline, or a summary plus a range)
  - `apply_timeline_patch` (zod-validated; the error text helps the agent fix its patch)
  - `list_steps`, `get_events(stepId)`, `capture_frame(t, region?)` (returns an image)
  - `list_overlays` and `list_scenes` (catalogue with prop schemas as JSON Schema)
- **Attribution:** every patch is tagged with the current `runId`.

**Files:** `apps/engine/src/agent/tools/{timeline,project,frames}.ts`
**Done when:** asking the agent to "add a TitleCard at 0–3 s saying 'HTTP services'" creates a valid instance that appears in the preview, and undo removes it.

### 3.3 MCP tools: `run_script` and `inspect_ui`
**Goal:** the agent can run and debug Playwright scripts.
- **`run_script({mode: 'dry'|'record', fromStep?})`** runs `script.spec.ts` through the recorder.
  - On failure it returns `{passed:false, stepId, error, screenshot(image), a11ySnapshot, domExcerpt}`.
  - On success it returns the step timings.
  - In record mode it creates a new take and streams to Live.
- **`inspect_ui({product, fixture, actions?})`** launches VS Code, optionally replays steps up to a point, and returns the accessibility snapshot, a screenshot and the results of locator probes (`probe: ["getByRole('button',{name:'Create'})", ...]`).

**Files:** `apps/engine/src/agent/tools/{runScript,inspectUi}.ts`
**Done when:** the agent can run the reference script in dry mode and report "6/6 passed". With a broken locator, it uses `inspect_ui` to find the right one.

### 3.4 Seed skills and CLAUDE.md
**Goal:** the knowledge base the agent starts from.
- **Skills:**
  - `tutorial-authoring/SKILL.md`: the `tut` API, pacing rules, narration style (sentence case, ~150 wpm, "you"), the script template.
  - `skill-maintenance/SKILL.md`: when to research (only after a dry-run failure), and how to update `components/*.md` and `pages/*.ts` with `last_verified` and `product_version`, deduplicate, and commit.
  - `vscode-platform/SKILL.md`: command palette, quick picks, explorer, webviews via `frameLocator`, avoiding native dialogs.
  - `overlay-authoring/SKILL.md`: SDK contract, determinism rules, WSO2 motion and theme usage, reuse-first.
  - `explainer-authoring/SKILL.md`: a placeholder until Phase 6.
  - `wso2-integrator/SKILL.md` plus `components/http-service.md` plus `pages/http-service.ts`, taken from step 1.5.
- **CLAUDE.md:** the workspace file gets sections for Conventions, Learned lessons and Gotchas. The project template sets out the brief.

**Files:** `workspace/.claude/skills/**`, `workspace/CLAUDE.md` (generated by `workspace.init` from `apps/engine/templates`)
**Done when:** in a fresh session, "write the script for 'Create an HTTP service'" produces a script that imports the page objects and passes the dry run **without** calling `inspect_ui`.

### 3.5 Pipeline orchestration and gates
**Goal:** run plan → script → dry run → (repair) → record → … as visible stages.
- **Stage machine** in the engine, saved in `project.json`: `plan`, `storyboard_gate`, `script`, `dry_run`, `repair`, `record`, `post`, `retro`. Each stage sends a structured instruction into the agent queue and waits for a completion signal (a `stage_done({stage, summary})` tool).
- **Plan stage output:** steps and proposed explainers, written to `tutorial.json` as a draft.
- **Gates** (from the Brief): pause the machine, emit `gate.waiting`, and resume on Approve or "Revise with agent".
- **Live window wiring:** the pipeline stepper, agent console, elapsed/cost/session counters, and the steer input (goes into the queue).

**Files:** `apps/engine/src/pipeline/*.ts`, `apps/desktop/src/routes/live/*`
**Done when:** starting from the Brief runs the plan, stops at the storyboard gate, and after approval continues through script, dry run and record, producing a take. Live shows every stage change.

### 3.6 Repair and research loop
**Goal:** self-healing when the product UI changes.
- On a dry-run failure the machine enters `repair`. The agent follows `skill-maintenance`:
  1. `inspect_ui`
  2. fix `pages/*.ts`
  3. update `components/*.md`
  4. dry run again
- The loop is capped at N attempts (default 3), then escalates with a gate banner: "Agent needs help at step 5".
- Every skill change is committed to the workspace repo with a structured message (`skills(wso2-integrator): http-service add-resource moved to + menu [v1.4.2]`).

**Files:** `apps/engine/src/pipeline/repair.ts`, `apps/engine/src/workspaceGit.ts`
**Done when:** a selector broken on purpose in `pages/http-service.ts` gets repaired automatically and shows up as a commit, and the next run needs no research.

### 3.7 Retrospective and knowledge commits
**Goal:** the tool gets better after every tutorial.
- In the `retro` stage the agent reviews the run log and:
  - updates product skills with new facts
  - adds general lessons to `workspace/CLAUDE.md`, deduplicated and kept under a size budget
  - suggests overlays and scenes to promote
- The diff is shown for user approval, then committed.

**Files:** `apps/engine/src/pipeline/retro.ts`
**Done when:** after a run with one repair, the retrospective adds a concise lesson and the commit is visible in a Knowledge panel. Running a second, related tutorial shows no research calls.

### 3.8 Projects, Brief and Storyboard screens
**Goal:** the first row of the mockups, working.
- **Projects:**
  - Hero prompt with product picker and suggestions.
  - Recent-tutorial cards from `project.list`: poster thumbnail, duration, and a status chip (In edit / Storyboard review / Exported / Draft).
- **Brief:**
  - Form: goal, product, workspace, audience/length/style segmented controls, voice, the "propose explainers" switch, review gates, notes.
  - Side panel: references dropzone, skill coverage (from `skills.coverage(product, goal)`), what happens next.
  - "Plan and record" starts the pipeline.
- **Storyboard gate:**
  - Gate banner, then step cards and explainer cards with narration editable in place (sends patches).
  - Timing bar, "Ask for changes" → agent, "Approve and record".

**Files:** `apps/desktop/src/routes/{projects,brief,storyboard}/**`
**Done when:** the full flow Projects → Brief → Live → Storyboard (approve) → Live (record) works in the app for the HTTP-service tutorial.

---

## Phase 4: Voice-over and post-production

### 4.1 ElevenLabs client
**Goal:** reliable text-to-speech with timing data.
- `packages/tts`: `synthesize({text, voiceId, modelId, settings})` calls the `with-timestamps` endpoint and returns `{audio: mp3, alignment: {chars, starts, ends}}`.
- Cache by hash of (text, voice, settings) in `audio/`, with retry and backoff and a rate limit.
- `voices.list()` feeds the voice picker in the Brief.

**Files:** `packages/tts/src/**`
**Done when:** synthesising a line returns audio and per-character timings, and calling it again with the same input hits the cache.

### 4.2 Narration and voice-over generation
**Goal:** final narration per step, and voice-over lines on the timeline.
- `generate_voiceover({stepIds?})` tool and a "Regenerate VO" UI action.
- Character alignment is converted to word timings (`VoiceLine.words[]`).
- **Voice-over lane:** waveform peaks are computed with ffmpeg and cached.

**Files:** `apps/engine/src/vo.ts`, `apps/engine/src/agent/tools/vo.ts`
**Done when:** each step has a voice line, and the Voice-over lane shows waveforms placed at the step starts.

### 4.3 Timing fit
**Goal:** narration and on-screen action line up.
- **Per step:** if the voice-over is longer than the action, insert a `hold` (freeze) segment at the step's end or at a chosen point. If the action is longer, pad with silence or speed up idle stretches (`speed` segments, capped at 1.5×).
- Keep a gap of at least 0.6 s after each click before the next line (a rule from CLAUDE.md).
- "Fit timing" button plus automatic run after voice-over generation. The result is patches, so it can be undone.

**Files:** `apps/engine/src/timing.ts`
**Done when:** after fitting, no voice line overlaps the next step's action, and the total length matches the Storyboard timing estimate within ±10%.

### 4.4 Auto-overlays from events
**Goal:** a good default edit without any agent work.
- **Rules over `events.jsonl`:**
  - click → Cursor path + ClickRipple + short Zoom
  - type → Zoom on the field
  - step start → optional TitleCard on the first step
  - mask → Blur
- Created with `author: 'auto'`. Re-running replaces only `auto` instances.

**Files:** `apps/engine/src/autoOverlays.ts`
**Done when:** the reference tutorial gets cursor, ripples, zooms and blur automatically, and they look right in the preview.

### 4.5 Captions model
**Goal:** caption cues from the voice-over alignment.
- Split lines into cues (≤42 characters per line, ≤2 lines, 1–6 s), mapped onto output time.
- Captions lane plus the `core:Captions` overlay. Cues can be edited inline on the lane.

**Files:** `packages/core/src/captions.ts`, `apps/engine/src/captions.ts`
**Done when:** captions show up synced to the voice-over in the preview, and editing one updates both the overlay and the export data.

---

## Phase 5: Interaction: annotations, chat, agent-written overlays

### 5.1 Annotation tools on the preview
**Goal:** point at something and say what you want.
- **Tool rail** (floating circles with keys V/P/R/T/Z/B): pin (point) and region (drag a box). An annotation is created at the current `t`.
- **Popover:** pin number, timecode, textarea, "Frame, region and step context attached", Save, and Send to agent.
- **Display:** the Annotations list in the left column (open/resolved), the Annotations lane with pins, and annotations drawn only in "With annotations" view, never exported.

**Files:** `apps/desktop/src/routes/studio/{ToolRail,AnnotationPopover,Annotations}.tsx`
**Done when:** you can create, edit, resolve and delete pin and region annotations. They persist and show up in all three places.

### 5.2 Annotation → agent context
**Goal:** the agent gets everything it needs from one annotation.
- "Send to agent" (single) or "Send open annotations (N)" (batch) builds a message containing:
  - the cropped frame plus the full frame as images, and the rect in stage pixels
  - `t`, the step, nearby overlays and scenes, the narration around `t`, and the instruction
- The message is queued into the session as one turn per batch.

**Files:** `apps/engine/src/agent/annotationContext.ts`
**Done when:** the request "add a callout here explaining the base path" creates a callout anchored to the right element at the right time.

### 5.3 `check_overlay` with rendered frames
**Goal:** the agent can see and verify its own components.
- **`check_overlay(file, {times?})`:**
  1. type-check with `tsc --noEmit` on that file
  2. ESLint with the determinism rule pack (no `Date`/`Math.random`/timers/fetch, no CSS animation or transition)
  3. bundle
  4. render with the headless stage at sample times (default: start, 25%, 50%, 75%, end, plus exit)
  5. determinism check: render the same `t` twice and compare
- It returns errors and a contact sheet image.
- `overlay-authoring` skill tells the agent to always run it after writing an overlay.

**Files:** `apps/engine/src/agent/tools/checkOverlay.ts`, `packages/overlay-sdk/eslint-plugin/**`
**Done when:** given a seeded mistake (a misplaced arrow and a `Date.now()` call), the agent sees the frame and the lint error, fixes both, and the check passes.

### 5.4 Agent runs, snapshots and Agent fix review
**Goal:** every agent change can be reviewed and undone.
- Each agent turn that changes something is a **run**:
  - A git snapshot of the project folder and touched overlays: a commit on a project-local branch in the workspace repo.
  - The timeline patch group.
- **Agent fix screen:**
  - Annotations with statuses.
  - Before/after frames at the annotation time, rendered by the headless stage for run N-1 and run N.
  - A unified diff of the changed files and the timeline.
  - The agent summary and checks, a follow-up box, and Accept / Reopen / Revert run.

**Files:** `apps/engine/src/runs.ts`, `apps/desktop/src/routes/agentfix/**`
**Done when:** after the "arrow at Create" annotation, the review shows the correct before/after and diff. Revert restores the exact previous state; Accept resolves the annotation.

### 5.5 Overlay library promotion
**Goal:** good components get reused.
- "Promote" moves `project:Name` to `workspace:Name`, rewrites references, and generates an `index.json` entry (description, props summary, thumbnail from `check_overlay`).
- The retrospective (3.7) can suggest promotions.

**Files:** `apps/engine/src/library.ts`
**Done when:** a promoted overlay appears in the library for a new project and works there with different props.

---

## Phase 6: Explainer scenes

### 6.1 Scene model and scene track
**Goal:** a tutorial becomes recording and explainer scenes in sequence.
- Turn on `Scene` and `Transition` in `timeMap`, the stage and the timeline UI. In the Scenes lane:
  - recording blocks
  - explainer blocks (orange)
  - transition handles
- The stage renders an explainer scene full-frame, with no `VideoPlane` underneath.

**Files:** `packages/core/src/timemap.ts`, `packages/stage/src/Scenes.tsx`, `apps/desktop/src/routes/studio/Timeline/ScenesLane.tsx`
**Done when:** a hand-made explainer scene placed between steps 2 and 3 plays in the preview, overlays and captions keep their output times, and `timeMap` tests still pass.

### 6.2 `SceneFrame`, `useBeat`, `useRecordingFrame`
**Goal:** the authoring kit for explainers.
- **`<SceneFrame theme="wso2-dark"|"wso2-light">`:** brand backdrop gradients, 84px safe margin, left-edge accent, footer mark, Inter type scale.
- **`useBeat()` / `beatAt(id)` / `wordAt(word)`:** beat times come from voice-over words (4.2). They re-time automatically when the narration changes.
- **`useRecordingFrame(take, t)`:** a recorded frame as a texture.
- Built-ins in `packages/scenes-core`: `DiagramFlow`, `CodeWalkthrough`, `ConceptCards`, `ArchitectureZoom`.

**Files:** `packages/overlay-sdk/src/scene/*.tsx`, `packages/scenes-core/src/*.tsx`
**Done when:** a `RequestFlow` scene built from `DiagramFlow` animates on its beats. Editing one narration line moves the beats without code changes.

### 6.3 Transitions
**Goal:** cuts to explainers feel continuous.
- `core:Crossfade`, `core:Push`, `core:ZoomThrough`, and **`core:FreezeMorph`**: the last recorded frame animates into the scene's first layout, and the reverse on the way out.
- Cursor and camera state carry across scene boundaries.

**Files:** `packages/scenes-core/src/transitions/*.tsx`
**Done when:** FreezeMorph in and out of `RequestFlow` looks seamless at 60 fps in the preview.

### 6.4 `insert_explainer` and the storyboard flow
**Goal:** add an explainer from anywhere.
- **Triggers:** the plan stage proposal, the timeline "+ Insert explainer here" (X), or an annotation such as "explain this".
- **`insert_explainer({at, brief})` tool:**
  1. Splits the recording scene at `at`.
  2. The agent writes a storyboard (beats, narration and one rough frame per beat via `check_scene`).
  3. The Storyboard panel shows the cards for approval.
  4. The agent builds the scene, generates the voice-over, and adds transitions.

**Files:** `apps/engine/src/agent/tools/insertExplainer.ts`, `apps/desktop/src/routes/storyboard/*`
**Done when:** "explain how a request reaches /greeting" between steps 2 and 3 goes through storyboard approval to a finished scene with transitions, with no manual coding.

### 6.5 `check_scene` and the scene library
**Goal:** verifying and reusing scenes.
- `check_scene(file)`: the same pipeline as `check_overlay`, plus a contact sheet with one frame per beat and a report of beat-to-voice-over alignment.
- Scene promotion to `workspace/scenes/` and the "Explainers" tab in the library.

**Done when:** the promoted `RequestFlow` is reused in a second tutorial with different props.

---

## Phase 7: Export

### 7.1 Headless GPU render host
**Goal:** the same stage, rendered offscreen on the GPU.
- The engine launches Playwright Chromium (headless with GPU: `--use-angle=metal --enable-gpu-rasterization --ignore-gpu-blocklist`) on `/export.html?project=…&chunk=…`, which mounts `<Stage mode="export">`.
- Confirm the GPU is in use (`chrome://gpu` style check via `WEBGL_debug_renderer_info`). Fail loudly if it falls back to software rendering.

**Files:** `packages/exporters/src/host.ts`, `apps/desktop/src/export-page/*` (or served by the engine)
**Done when:** the export page reports a Metal-backed renderer and renders a single frame identical to the preview still, within tolerance.

### 7.2 Frame stepping and capture
**Goal:** frame-exact rendering.
- **Recorded frames:** a WebCodecs `VideoDecoder` decodes from the short-GOP MP4 (demuxed with `mp4box.js`), and a frame provider serves exact frames by timestamp.
- **Per output frame:**
  1. set the virtual clock
  2. seek the video
  3. `await` the decoded frame
  4. seek the GSAP timelines
  5. `advance()` R3F
  6. wait for fonts and images
  7. capture
- **Capture:** CDP `Page.captureScreenshot` (`optimizeForSpeed`, clip to the stage), or `HeadlessExperimental.beginFrame` where supported.

**Files:** `packages/exporters/src/{frames,capture}.ts`, `packages/stage/src/exportDriver.ts`
**Done when:** rendering frames 0–300 twice gives byte-identical PNGs (determinism), and they match the preview at the same timestamps.

### 7.3 Hardware encode, audio mux, chunking
**Goal:** a fast, valid MP4.
- Frames are piped to ffmpeg `-c:v h264_videotoolbox -b:v 12M`. The voice-over and music mix is built with ffmpeg filters, loudness-normalised to −16 LUFS.
- Split into N chunks across parallel Chromium workers (default: CPU cores / 2), then `concat` and mux.
- Progress events (overall %, sub-steps) and cancel.

**Files:** `packages/exporters/src/{encode,audio,chunks}.ts`
**Done when:** the 2:41 reference exports at 1080p30 faster than real time, `ffprobe` validates it, and the audio is in sync (checked against clap markers within ±1 frame).

### 7.4 Fast path (canvas → VideoEncoder)
**Goal:** speed for GPU-only ranges.
- For ranges with no active `DomLayer`, use `new VideoFrame(canvas)` → in-page `VideoEncoder` (H.264, hardware) → `mp4-muxer` chunks. These are spliced with the screenshot-path chunks at keyframes.

**Done when:** an explainer-heavy tutorial exports at least 2× faster than the screenshot path, with no visible seams.

### 7.5 SRT/VTT and the Markdown doc
**Goal:** the other three outputs.
- `captions.srt` and `captions.vtt` from the caption cues.
- `tutorial.md`: step titles, instructions rewritten by the agent from the narration (one tool call), and stills per step from the export host with a highlight box on the target.
- `script.spec.ts` copied alongside, with a README on how to re-record.

**Files:** `packages/exporters/src/{captions,markdown}.ts`
**Done when:** all four outputs are in `output/`, VTT validates, and the Markdown renders with images.

### 7.6 Export screen
**Goal:** the Export mockup, working.
- Big preview of the frame being rendered with a frame counter, percentage and progress bar, sub-step chips, and settings (resolution and fps segmented controls, outputs list, specs box). Cancel and Reveal in Finder.

**Files:** `apps/desktop/src/routes/export/**`
**Done when:** you can export from Studio, watch the progress, cancel and resume, and reveal the files.

---

## Phase 8: Hardening and packaging

### 8.1 Parity and determinism test suite
**Goal:** checks against preview/export drift and flaky renders.
- **CI-style test:** pixel-diff the preview stills (Tauri WebKit) against export frames (Chromium) at fixed timestamps for core overlays, a sample agent overlay and a scene. The tolerance threshold is documented.
- **Recorder regression:** run the reference tutorial in dry mode against the pinned VS Code and extension.

**Done when:** `pnpm test:parity` and `pnpm test:recorder` pass and are documented.

### 8.2 Sidecar packaging and app bundle
**Goal:** a `.app` that a teammate can install.
- Bundle the engine as a single executable (Node SEA or `bun build --compile`), registered as a Tauri sidecar (`externalBin`).
- First-run downloads of Playwright Chromium and the VS Code build go into `~/.tutorial-studio/`.
- Code signing and notarization notes.

**Done when:** a built `.app` runs on a clean macOS user account and records the reference tutorial.

### 8.3 Settings, secrets and onboarding
**Goal:** usable by teammates.
- **Settings screen:**
  - API keys (Keychain), default voice, workspace path, permission mode, cost limits per run.
  - Product registry (`products.json`) editor.
- **First-run checklist:** keys, workspace init, VS Code download, a test recording.

**Done when:** a new user goes from install to first recorded tutorial using only the UI.

---

## Phase 9 (later): Web console target
- Chromium launcher with a one-time manual login and saved `storageState`.
- `wso2-choreo` and `wso2-asgardeo` skills.
- `@playwright/mcp` for research on web targets.
- The same pipeline and editor, unchanged.

---

## Cross-cutting checklists

**Every step:**
- Types are strict, there are no `any` leaks across package boundaries, and zod sits at every I/O boundary.
- Unit tests for logic, and an integration test when the step crosses a process boundary.
- UI uses `packages/ui` components and tokens only: no raw hex values in app code.
- Accessibility: labels on every control, visible focus, keyboard reachable.

**Security:**
- Engine bound to `127.0.0.1` and token-authenticated.
- Agent-written code runs only in the sandboxed stage iframe or the export Chromium.
- The agent's tool permissions are an allow-list. Secrets never reach the agent context or logs.

**Performance budgets:**
- Preview: 60 fps at 1080p with about 20 overlays.
- Live screencast: under 200 ms delay.
- Export: at or above real time at 1080p30 with hardware encoding.

---

## Decisions log
Record any change from `PLAN.md` here as we build. Give each entry the date, the step, the decision and why.

| Date | Step | Decision | Why |
|---|---|---|---|
| 2026-10-16 | — | Added `packages/ui` (shared component kit) | Both windows reuse the design-system components from the mockups |
| 2026-10-16 | 0.1 | Vitest 4 rather than 5 | Vitest 5 needs Node 22, and the default Node here is 20.19 |
| 2026-10-16 | 0.1 | React 19, Vite 8, TypeScript 5.9 (not 7), Tauri 2.12 | Current stable versions. typescript-eslint supports TS below 6.1 |
| 2026-10-16 | 0.1 | 0.1 ships a minimal Tauri window that lists every linked package | Lets each step be tested end to end in the UI |
| 2026-10-16 | 0.1 | Packages export TS source (`exports: ./src/index.ts`). `tsc -b` only type-checks and emits declarations | No per-package build step needed while iterating. The engine gets a bundled build in 0.3 |
| 2026-10-16 | 0.2 | zod 4 with built-in `z.toJSONSchema` instead of `zod-to-json-schema` | One less dependency. zod 4 can output JSON Schema itself |
| 2026-10-16 | 0.2 | Steps store take-relative `from`/`to`; transitions overlap the end of scene A with the start of scene B and shorten the total | Steps survive retiming. Overlap is how crossfade-style transitions behave |
| 2026-10-16 | 0.2 | Dev shell with one page per step (left nav). The newest step opens by default | Each step can be tested in the UI. Replaced by real navigation in 3.8 |
| 2026-10-16 | 0.3 | WebSocket auth uses a `?token=` query parameter on `/rpc` (not a first message). Media URLs use the same parameter | Simpler, and `<video>` can't send headers anyway. The engine only listens on 127.0.0.1 |
| 2026-10-16 | 0.3 | Engine runs with `tsx` in dev (`pnpm engine` → port 4317, token `dev-token`). `@studio/engine`'s index stays browser-safe; the server lives in `src/server.ts` | No build step in dev. Keeps fastify out of the UI bundle |
| 2026-10-16 | 0.3 | The typed RPC client is in `@studio/core` and accepts a WebSocket constructor | Shared by the UI (browser WebSocket) and tests (`ws`) |
| 2026-10-16 | 0.4 | In dev, Rust starts the engine with `node --import tsx src/main.ts` in `apps/engine`, and the workspace is `<repo>/workspace`. The engine also exits when its stdin closes | No build step. Even a hard kill of the app never leaves an orphaned engine |
| 2026-10-16 | 0.4 | The Live window is created by a Rust command (`open_live_window`), not by JS | No webview-creation permission is exposed to the frontend |
| 2026-10-16 | 0.4 | In a plain browser (`pnpm dev:web`) the UI falls back to the dev engine (`pnpm engine`, port 4317, token `dev-token`) | The UI can be worked on without Tauri |
| 2026-10-16 | 0.5 | `@studio/ui` uses plain CSS classes (`ui-*`) plus CSS variables, a `tokens.ts` mirror for JS and canvas, and React components. No CSS-in-JS library | No runtime cost, and stage overlays can share the tokens |
| 2026-10-16 | 0.5 | Step pages from 0.1–0.4 keep a small legacy class set aliased to the ui tokens | Avoids rewriting throwaway dev pages. New screens use `@studio/ui` components |
| 2026-10-16 | 0.6 | Workspace templates are TS string constants (`apps/engine/src/templates.ts`), not files under `templates/` | Nothing extra to copy when the engine is bundled in 8.2 |
| 2026-10-16 | 0.6 | `project.create` initializes the workspace if needed and commits each new project. The workspace `.gitignore` excludes recordings, audio and output | Every knowledge change is a commit. Media stays out of git history |
| 2026-10-16 | 0.6 | Verified: `claude -p` started in `projects/<slug>` loads the workspace and project CLAUDE.md files. It also loads the user's global CLAUDE.md, so 3.1 must use `settingSources: ['project']` | Keeps personal instructions out of agent sessions |
| 2026-10-16 | fix | Timeline scrubbing uses `@studio/ui` `Scrubber` (playhead plus handle drawn on the lanes' own scale, drag or arrow keys), not a native range input | A native range thumb is inset by its radius and sits on a different scale, so it never lines up with the bars. 2.7 reuses it |
| 2026-10-16 | 1.1 | The default target is the installed **WSO2 Integrator.app** (VS Code fork 1.127.0 with WSO2 Integrator, MI, SI and Ballerina built in), launched from its own executable. The pinned VS Code 1.140 plus marketplace extension stays as the second product `wso2-integrator-vscode` | Requested by the user. It is the real product the tutorials are about |
| 2026-10-16 | 1.1 | Recordings must open a **valid project**. BI = root `Ballerina.toml` with `[workspace]` + one `[package]` folder per integration (same files as the product's own create flow), plus `.vscode/settings.json` `ballerina.isBI`. MI = `pom.xml` with `<projectType>integration-project</projectType>`. SI = `*.siddhi`. `createBIProject()` builds BI fixtures | An empty folder triggers a blocking native modal ("We couldn't detect the project type"), which is invisible in page screenshots |
| 2026-10-16 | 1.1 | Display is **full screen by default** (macOS simple full screen, no Space switch or animation), with `window.customTitleBarVisibility: auto` so the in-window title bar ("greeting-project — WSO2 Integrator") stays on camera. Theme **Default Light Modern**. A window mode (e.g. 1280×720 @ 1.5×) remains available | Requested by the user. Frames follow the screen shape (2268×1473 on this Mac), and the stage fits them into the 16:9 output |
| 2026-10-16 | 1.1 | `window.dialogStyle: custom` (dialogs drawn in the window, clickable by Playwright). Native message boxes are also logged from the main process and reported as problems | No invisible blocking dialogs during recording |
| 2026-10-16 | 1.1 | Known issue: WSO2 Integrator ignores `window.commandCenter: false`, so the title text appears inside the command-center box. `window.title` is set to `${rootName} — ${appName}`, so it still reads "greeting-project — WSO2 Integrator" | Cosmetic. Revisit if the product name needs a different placement |
| 2026-10-16 | 1.2 | Events store coordinates and boxes in **frame pixels** (CSS px × scale). The `start` marker carries mode, scale, product, version and viewport | Overlays anchor directly onto the video with no conversion |
| 2026-10-16 | 1.2 | Webview targets go through `webview(page)` = `iframe.webview.ready` → `#active-frame`. Playwright's `boundingBox()` is already in main-window coordinates, so no manual iframe offset is needed (verified visually) | WSO2 Integrator's editors are VS Code webviews |
| 2026-10-16 | 1.2 | Pointer paths and typing rhythm are seeded (deterministic). Failure reports include a screenshot plus window **and** webview ARIA snapshots, and name the missing target | Re-records move the same way. The agent needs webview structure to repair locators |
| 2026-10-16 | 1.3 | The live stream is JSON `live.frame` events (base64 JPEG, max 1600×1100, every 2nd frame), plus `live.action` (target box and label before each action) and `live.session`. Measured: ~40 fps, 10–13 ms from engine to window | Simple and fast enough locally. Binary frames are an option later |
| 2026-10-16 | fix | In dev, Tauri runs the engine under `tsx watch` with a fixed port and token, so engine code changes reload it and the windows reconnect. The engine exits (and stops its watcher) when the app's process is gone (`STUDIO_PARENT_PID`) | Before this, a running app kept the stale engine ("unknown method recorder.launchCheck") |
| 2026-10-16 | 1.4 | Takes are recorded from the **CDP screencast at full resolution** (JPEG q90, every frame, Chromium timestamps), not Playwright `recordVideo`. They are encoded with ffmpeg (ffconcat with per-frame durations → `fps=30`, `crop` to even size, libx264 CRF 18, GOP 15, faststart) plus `poster.jpg` | Higher quality than recordVideo. Exact alignment because frames and the tut start share the wall clock (`epoch` in the start marker), so no marker-frame detection is needed. Verified: frames pulled at event times show the logged boxes exactly on the elements |
| 2026-10-16 | 1.4 | While recording, the same screencast feeds the Live window at 15 fps | Chromium runs one screencast per target |
| 2026-10-16 | 1.5 | Script format: `script.spec.ts` exports a `fixture` (BI project spec) and a default `TutorialScript(ctx)`, where `ctx = { tut, page, webview }`. Page objects live in the skill (`pages/*.ts`) and take the same `ctx`. Scripts and page objects only *type*-import `@studio/recorder/node`, so they load from the workspace without its own node_modules | One runner (`runTutorial`) for samples, reference and agent scripts |
| 2026-10-16 | 1.5 | Seed knowledge is kept as real files in `apps/engine/seed/workspace/**` (the `wso2-integrator` skill and the `demo-http` reference project). `workspace.init`/`ensure` copy only missing files, then commit. This partly replaces the "templates as TS strings" decision for code-heavy files | Page objects are code and need real files. Agent-updated skills are never overwritten |
| 2026-10-16 | 1.5 | Reference tutorial (5 steps, ~35 s): Artifacts → HTTP Service `/greeting` → GET `hello` → Return `"Hello, World!"` → service overview. "Try It" was left out (it needs a running service and a notification action) and is recorded as a gotcha in the skill | Keep the reference deterministic |
| 2026-10-16 | 1.5 | `tut.type(..., { insert: true })` enters text in one go, for code/expression editors whose auto-closing quotes would garble per-key typing | WSO2 Integrator expression editor |
| 2026-10-16 | 1.5 | Dev engine watcher excludes `workspace/**` | Scripts and skills are imported at run time, and the agent edits them; that must not restart the engine |
| 2026-10-16 | 1.6 | Live window layout matches the mockup: a pipeline stepper driven by `live.stage` (fixture → launch → load → run → encode, plus failed/stopped), the live view with the action box and step progress, and an agent console (Readable with tags / Raw JSON). Pause and steer are present but disabled until the agent arrives (3.5) | The real layout now, so Phase 3 only adds data |
| 2026-10-16 | 1.6 | **Stop take** (`recorder.stop`) aborts through an `AbortSignal`: it closes the product window, and the run ends as "Stopped by user" with no take. Temporary profiles are removed with retries, and stale ones are swept at launch | Electron keeps writing briefly after close |
| 2026-10-16 | 2.1 | `<Stage t>` gives `useStageTime()`/`useFrame()` on a fixed surface (scaled to fit in preview, unscaled in export). `createPlayer` owns preview time (rate, loop, seek) and gets its raf/now injected for tests. `installVirtualClock` fakes Date, performance.now, raf and timers for export | Rendering is a pure function of t, so preview, scrubbing and export agree |
| 2026-10-16 | 2.2 | Coordinates: source px (recorded frame) → stage px via `fitSource` (letterbox) → camera (`zoom` around `focus`, clamped to the video). `<Scene3D>` is one R3F canvas (orthographic, `frameloop` demand/never, `flat`, sRGB, no tone mapping) with `resize.offsetSize` and a manual frustum. `<DomLayer follow>` applies the same camera transform to HTML | The CSS scale-to-fit transform otherwise shrinks the canvas (seen and fixed). The same camera drives both GPU and DOM layers |
| 2026-10-16 | fix | Engine sends CORS headers (`*`, range and token headers allowed, content-range exposed) and answers OPTIONS without a token | The UI origin (tauri://localhost or Vite) differs from the engine. fetch and WebGL video textures need CORS |
| 2026-10-16 | 2.3 | Overlay SDK: `useOverlayTime`, `useAnchor` (stage px, before the camera), `useGsap` (a paused timeline rebuilt on deps and seeked to local t in a layout effect, TextPlugin registered), `ThreeLayer` (a tunnel into the stage's single R3F canvas that carries the overlay context), `DomLayer`, `useStageToScene`, `theme`, `OverlayRenderer` + `OverlayBoundary` (time window and error isolation), and re-exported R3F JSX types | The stable API agent-written overlays target. Verified: same DOM at the same t when scrubbing both ways (jsdom test and in Chrome) |
| 2026-10-16 | 2.4 | Core overlays: Cursor and ClickRipple read the recording through `useRecording()` (events, fit, sourceTime). Zoom renders nothing; hosts turn Zoom instances into camera moves (`zoomMove`). Blur uses CSS `backdrop-filter` over the camera-following layer instead of a custom shader | backdrop-filter composites over the WebGL canvas in WebKit and Chromium, and export captures composited frames (7.2). It avoids a shader per blur |
| 2026-10-16 | 2.4 | Known limitation: Callout `side` is fixed. When zoomed onto wide elements the card can fall outside the view; choosing a side automatically from the camera's final view is left for agent-authored overlays (5.3) | Seen in the gallery check |
| 2026-10-16 | 2.5 | The engine runs its own Vite dev server (separate localhost port, `cors`, no HMR client), rooted at the workspace. A transform plugin rewrites overlays' imports of shared packages (React, jsx-runtime, zod, gsap, three, R3F, @studio/*) into reads from `globalThis.__STUDIO_SHARED__`, which the app fills; other bare imports are rejected. File changes are pushed as `overlays.changed` over the RPC socket, and the preview re-imports cache-busted | Guarantees one React/three/GSAP instance (hooks and contexts work). A separate port is simpler than mounting Vite inside Fastify. Measured edit→preview ~80–100 ms |
| 2026-10-16 | 2.5 | Error boundaries reset only when the overlay **module** changes (StageHost keys instances by module identity). Compile errors show Vite's message, not "Failed to fetch" | An earlier reset-on-children loop blanked the page on a runtime error (found and fixed) |
| 2026-10-16 | 2.5 | Deferred: running overlays in a sandboxed iframe | The agent that writes overlays already runs locally with file and shell access, so an iframe adds little security now. It also complicates the shared singletons. Revisit in 8.x |
| 2026-10-16 | 2.6 | `TimelineStore` in the engine: per-project serialized ops, validated patches, atomic saves, versioned `timeline.changed` broadcasts, and server-side undo/redo where consecutive patches with the same `group` (a drag, an agent run) form one entry. Windows use `useTimeline` (optimistic apply; skip broadcasts while their own patch is in flight; the reply is authoritative; gaps reload) instead of zustand | One shared history for every window and the agent. A tiny hook was enough for the sync, so no new store library |
| 2026-10-16 | 2.6 | Rust `open_studio_window(label, route)` opens extra Studio windows (`studio-*` capability) | To test multi-window sync, and later to pop out panels |
| 2026-10-16 | 2.7 | Registering a take now derives one recording scene and the steps (source ranges plus the first click/type box as the step's `primary` anchor) from `events.jsonl` (`withTake`, keeps overlays). Older projects get a "Build from take" banner (`timeline.rebuildFromTake`) | The Studio needs scenes and steps, and anchors resolve through step boxes |
| 2026-10-16 | 2.7 | The Studio is a full-window route `#/studio/<slug>`. A resolver maps the timeline to stage instances (time map, anchors → stage px). The timeline panel packs overlays into rows; drag/trim send grouped patches snapped to 1/30 s; S splits the segment under the playhead. Shortcuts: Space, J/K/L, ←/→, S, ⌫, ⌘Z/⇧⌘Z. "Add overlay" (left column) stands in for library drag-and-drop until 2.8 | Usable editing now; the library and inspector come next |
| 2026-10-16 | 2.8 | The inspector form comes from `z.toJSONSchema(meta.props)` (string/textarea, number with range, boolean switch, enum segmented/select, string arrays, colour). Consecutive edits to one field are one undo step (group `field-<id>-<name>`). The library is draggable tiles (HTML5 drag-and-drop onto the Overlays lane, or click to add at the playhead). The on-canvas manipulator moves/resizes the selected overlay in the camera-following layer; dropping near the current or next step's target re-anchors it, otherwise it becomes a free `rect`. Selecting an overlay outside the playhead seeks into it | Covers the done-when in the real app. Thumbnails are glyphs until `check_overlay` renders real ones (5.3) |
| 2026-10-16 | 3.1 | `AgentSession` (one per project, `apps/engine/src/agent`) wraps Agent SDK 0.3.301 `query()` with a streaming-input queue, `cwd = projects/<slug>`, `settingSources: ['project']`, `resume` from `.studio/agent.json`, model `claude-opus-5-5`, `permissionMode: 'default'`. Isolation from the user's own setup also needs `strictMcpConfig`, inline settings `disableClaudeAiConnectors` + `disableBundledSkills`, and `skills` = the workspace skill folders (account-synced skills are otherwise visible); outer Claude Code session env vars are stripped, `CLAUDE_CONFIG_DIR`/`ANTHROPIC_*` kept | Verified live: a fresh session sees only `wso2-integrator`, both CLAUDE.md files and the `studio` MCP server |
| 2026-10-16 | 3.1 | Messages become `agent.event`s (user, init, text, tool_use, tool_result, result, permission, status, error), numbered per project and logged to `.studio/agent-log.jsonl` (git-ignored; existing workspaces get the rule on `ensure`) so a window opened later replays the conversation. Claude Code repeats `init` every turn; the UI shows it once per start. A thrown generator emits an error and the next message restarts with `resume`. `canUseTool` auto-allows the in-process `studio` server and surfaces anything else as an Allow/Deny card | Robust, observable sessions; permission prompts never block silently |
| 2026-10-16 | 3.1 | Studio agent panel (chat, inline tool calls, permission cards, Pause, New conversation, session id and cost). The Live console shows agent lines; Pause agent and the steer box are wired to the latest active session | Pause and steer were placeholders; they only need the session slug |
| 2026-10-16 | 3.2 | `studio` MCP tools: `get_project`, `get_timeline` (summary with output-time step spans and overlay indexes, or full; optional range), `apply_timeline_patch`, `list_steps`, `get_events(stepId)` (mouse paths condensed), `capture_frame(t, region?)` (ffmpeg JPEG of the take at the mapped source time, ≤1280 px wide, no overlays yet), `list_overlays`/`list_scenes` (with JSON Schema props and a word filter). Patches are dry-run first: unknown components (with the available list), props that fail the component's zod schema, and anchors to missing steps are rejected with actionable text; agent-added overlays get `author: "agent"`; every patch in one agent turn shares the undo group `runId` | The agent edits only through validated tools, and one ⌘Z undoes a whole agent turn |
| 2026-10-16 | 3.2 | The engine now builds the component catalogue itself: core overlays are imported directly, workspace/project files through the overlay server's Vite `ssrLoadModule` with `globalThis.__STUDIO_SHARED__` filled in Node (imports run one at a time; three.js breaks on parallel CJS/ESM loading). The engine gained React/three/GSAP/R3F and the stage/SDK/overlays packages as dependencies for this | Same compile as the preview, so a component that validates here renders there |
| 2026-10-16 | 3.3 | `run_script({mode})` runs script.spec.ts through a new engine `Runner` (one product window at a time, streamed to Live; the RPC handlers use it too). Failure results carry the step, the error plus Playwright's call log (`errorDetail`, new on `StepFailure`), a ≤1280 px JPEG screenshot and the window/webview ARIA snapshots. `fromStep` is deferred: later steps depend on UI state from earlier ones, so partial runs need their own design | Enough for the agent to repair without research when the snapshot already shows the answer (seen live) |
| 2026-10-16 | 3.3 | `inspect_ui({uptoStep?, actions?, probes?, restart?, snapshot, screenshot, close?})`: the recorder's new `openInspector` opens the product on the script's fixture (or the reference fixture), replays steps before `uptoStep` at dry-run pace, then stays open (5 min idle, or until a run takes the window). `actions` are Playwright statements with `page`/`webview()`/`tut`; `probes` are locator expressions returning count, visibility, text and frame-pixel boxes | Verified live: replay to s3, click Add Resource → GET, probe `/Resource Path/i` (1 visible) vs the broken `/Endpoint Route/i` (0), fix, 5/5 |
| 2026-10-16 | 3.3 | `loadScript` now bundles the script and its relative imports with esbuild into a fresh module on every load (under the recorder package's `node_modules/.cache`, so package imports resolve). Node caches ES modules per process, so the old cache-busted import kept running page objects the agent had already fixed | Found live: a broken locator still passed until the engine restarted |
| 2026-10-16 | 3.3 | Sessions get `additionalDirectories: [workspace]`, so reading skills above the project folder no longer prompts. Still prompting: edits under `.claude/skills/` (Claude Code guards `.claude/`) and compound `cd … && git …` commands; these are handled with the unattended repair loop in 3.6 | Keeps 3.3 focused; the Allow/Deny cards cover it meanwhile |
| 2026-10-16 | 3.4 | Seed skills (copied into workspaces without overwriting): `tutorial-authoring` (workflow, script template, the `tut` API table, pacing, narration style), `skill-maintenance` (research only after a failed dry run; failure output first, then `inspect_ui`; locator preference; front matter `product_version`/`last_verified`; dedupe; structured commits, git run from the project folder without `cd`), `vscode-platform`, `overlay-authoring` (contract, SDK table, determinism, WSO2 motion), `explainer-authoring` (placeholder). The workspace CLAUDE.md template now maps tools and skills; an untouched older workspace CLAUDE.md (no lessons or gotchas) is upgraded on `ensure`. The project brief gained Outline and Notes | Verified live: a fresh session in a new project loaded `tutorial-authoring` + `wso2-integrator`, wrote a script from the page objects, and passed its first dry run (5/5) without `inspect_ui`, for $0.16 |
| 2026-10-16 | 3.4 | `canUseTool` now approves file edits inside the workspace (skills, scripts, overlays, CLAUDE.md), except `.claude/` outside `skills/` (the agent must not change its own permissions), `.git/` and `.env*`. Claude Code otherwise asks for every new file and every edit under `.claude/` | The repair and retrospective loops need to edit skills unattended |
| 2026-10-16 | 3.5 | `PipelineManager` (`apps/engine/src/pipeline`) runs plan → storyboard gate → script → dry run (⇄ repair, capped at 3 then a "Agent needs help at step N" gate) → record → post → retro. State lives in `projects/<slug>/.studio/pipeline.json` (not project.json, which only gets the status chip: storyboard → recording → edit). Agent stages send a `[Pipeline · …]` message and wait for the `stage_done` tool plus the end of that turn; a turn that ends without it gets one nudge, then a help gate. Dry runs and recordings are run by the engine, so their outcome never depends on the agent's report. The plan is saved with a new `save_plan` tool (steps with action + draft narration, proposed explainers). Post writes step narration for now; retro is skipped until 3.7. A gate survives an app restart; a running stage becomes "stopped" | Verified live from the Studio: plan (5 steps) → gate → Approve → script → dry run 5/5 → take-1 (37.6 s) → narration, in 151 s with no permission prompts |
| 2026-10-16 | 3.5 | UI: a Pipeline panel in the Studio (stepper with stage summaries, storyboard gate listing the plan, Approve / Revise with agent, Start from brief with a storyboard-review switch, Stop). Live shows the agent pipeline stepper above the current recorder run, a gate with Approve, and pipeline elapsed / cost / session counters | The real Brief and Storyboard screens replace the panel's gate list in 3.8 |
| 2026-10-16 | 3.6 | The repair loop itself (capped repair stage, "Agent needs help at step N" gate) shipped with 3.5. 3.6 adds knowledge commits: after every agent stage the engine commits changed skill files only (`WorkspaceGit`, `apps/engine/src/workspaceGit.ts`) as `skills(<product>): <knowledge line> [<product version from the run's start marker>]`. `stage_done` gained a `knowledge` field for that line; in pipeline stages the agent no longer commits itself (it used `cd … && git` and heredocs, which prompt). The commit hash and subject are appended to the stage summary | Verified live: a deliberately broken locator was restored and committed as `skills(wso2-integrator): …` (one file), and the next run passed its dry run with no research |
| 2026-10-16 | 3.6 | `Workspace.commit` now takes the paths to commit: seed commits cover only the seed files `ensure()` added (plus `.gitignore`/`CLAUDE.md` upgrades), take and project commits only `projects/<slug>`. Before, every dry run's `ensure()` ran `git add -A` and swept the agent's skill edits into "workspace: add seed knowledge" commits | Found live: the first repair test produced no skills commit because of this |
| 2026-10-16 | 3.7 | Retro stage: the agent gets the run's stage log and updates product skills, adds at most 3 one-line lessons/gotchas to the workspace CLAUDE.md (merge, don't repeat; 8 KB budget, current size given), and names overlays worth promoting in its summary (promotion itself is 5.5). Retro edits are not auto-committed: the machine collects the uncommitted knowledge diff (CLAUDE.md + `.claude/skills`, new files via intent-to-add) and opens a `knowledge` gate showing it. Commit → one `lessons: <line> [<version>]` commit; Revise → the agent redoes it with the feedback; Discard → changes reverted. No diff → no gate | Verified live: after a run whose script stage fixed a broken locator, the retro proposed measured timings in the skill plus two lessons and a gotcha; Commit produced `lessons: …` visible in the Knowledge panel |
| 2026-10-16 | 3.7 | Knowledge panel in the Studio: the last 15 `skills(...)` and `lessons:` commits (via new `workspace.show`), each expandable to its diff. Commit subjects strip any commit-style prefix or version the agent put in its knowledge line | The agent wrote "skills(x): …" inside its line, producing doubled prefixes |
| 2026-10-17 | 3.8 | The main window's home is now the Projects screen (`#/projects`). `main.tsx` routes by hash without reloads: `/projects`, `/brief/<slug>`, `/storyboard/<slug>`, `/studio/<slug>`, `/live`; anything else is a developer page ("Developer pages" in the header). "Set up tutorial" creates a draft project right away (title from the goal's first sentence), so the Brief always has a slug for references and Draft cards appear on Projects. Cards route by state: a running or waiting pipeline → Storyboard, a take → Studio, a draft → Brief | One code path for drafts; no special "unsaved" brief state |
| 2026-10-17 | 3.8 | The brief is `brief.json` (zod `Brief` in core: goal, starting workspace, audience/length/style, voice, explainers, gates, notes, references). `brief.save` renders the Goal, Audience, Constraints and References sections of the project CLAUDE.md and keeps the rest (Outline, Notes, the agent's own sections). References are copied into `references/` (Tauri drops give paths; the browser and the file picker send contents, ≤5 MB) or kept as links. The plan instruction follows the explainers switch | The agent keeps reading the brief from CLAUDE.md as before |
| 2026-10-17 | 3.8 | Not wired yet, shown disabled: the voice picker (4.1), and the "After recording" and "Before export" gates (only the storyboard gate exists). The cost and time estimate in "What happens next" is left out until there are enough past runs to base it on | Avoids controls that look like they work but don't |
| 2026-10-17 | 3.8 | Skill coverage (`skills.coverage`) lists the product skill's component notes with `last_verified`, and marks notes that share words with the goal as "likely used". There is no list of the steps a goal needs before planning, so "needs research" is a sentence, not a per-step chip | Honest with the data that exists |
| 2026-10-17 | 3.8 | Storyboard edits go through `pipeline.editPlan` with validated `PlanEdit`s (step narration, explainer idea), only while the storyboard gate is open, sent on blur and before Approve/Revise. They change the plan in `pipeline.json`, not `tutorial.json`: steps reach the timeline only after recording. Post-production now gets the reviewed narration in its instruction. Durations are estimates (narration at 150 wpm, at least 5 s a step; 20 s an explainer) until voice-over timing (4.3) | The spec said "sends patches"; the plan is not the timeline yet |
| 2026-10-17 | 3.8 | `project.list` returns `ProjectSummary`: duration (timeline, or the take for older projects), a poster frame extracted once with ffmpeg into `.studio/poster-<take>.jpg`, and the pipeline status/stage for the chip and routing | Cards need real thumbnails and state |
| 2026-10-17 | fix | Permission prompts: the Live console and the Storyboard screen now show Allow/Deny for waiting tool calls (before, only the Studio's agent panel did, so a prompt during planning had no button). `canUseTool` also auto-allows read-only shell commands that stay inside the workspace (`cd`, `cat`, `ls`, `grep`, `find` without -exec/-delete, `sed -n '…p'`, read-only git; no redirects, substitutions or background jobs) | Found in the 3.8 UI test: the plan stage stopped on `cd <skill>; cat components/*.md; ls …` |
| 2026-10-17 | fix | Auto mode per project: the brief has an "Auto mode" switch (on by default). Sessions start with Claude Code's `permissionMode: 'auto'` (a safety classifier approves tool calls; `canUseTool` and the Allow/Deny cards only see calls it can't decide), and saving the brief switches a running session with `setPermissionMode`. The permission bar on the Storyboard has "Turn on auto mode". Off = `default`, as before | Asked for during the 3.8 UI test. Verified live: in auto mode `ls /usr/bin` outside the project ran without a prompt |
| 2026-10-17 | fix | The recorded pointer is visible now (part of 4.4 pulled forward). Playwright already moved the mouse along human paths and clicked the real elements, but the screencast has no cursor and nothing drew one, so takes looked like elements activating on their own. Registering a take now adds `auto-cursor` (core:Cursor) and `auto-click-ripple` (core:ClickRipple) over the whole take, replaced on the next take; older takes get an "Add the cursor" banner in the Studio (a patch, so step narration is kept, unlike Build from take). The recorder streams `live.pointer` (frame px, every other path point and each click) and the Live window draws the cursor and a click ring over the screencast | Raised in the 3.8 UI test. 4.4 still adds the per-click zooms and the other rules |
| 2026-10-17 | 4.1 | `@studio/tts` (browser entry: schemas; `@studio/tts/node`: client and cache). `synthesize` posts to `/v1/text-to-speech/<voice>/with-timestamps` (`eleven_multilingual_v2`, `mp3_44100_128`, optional previous/next text for flow) and returns MP3 plus `{chars, starts, ends}`; `listVoices` pages through `/v2/voices`. Retries 429/5xx/network errors with exponential backoff (Retry-After wins), at most 2 requests in flight, errors never contain the key. The cache is `projects/<slug>/audio/<sha256 of text, voice, model, settings, neighbours, format>.mp3` + `.json` alignment, sharing in-flight requests | Done-when checked with a fake ElevenLabs in tests; the live check needs the user's key |
| 2026-10-17 | 4.1 | The key lives in the macOS login Keychain (service "Tutorial Studio", written through `security -i` on stdin so it never appears in a process list); `ELEVENLABS_API_KEY` overrides it; other platforms use a 0600 file under ~/.config. `tts.setKey` checks the key by listing voices before storing it. RPCs report only whether a key is set and where from. `agentEnv` drops `ELEVENLABS_*`, so the agent never sees it. The Brief's voice picker is live once a key exists. (This is the Keychain part of 8.3, pulled forward) | Secrets rule in CLAUDE.md |
| 2026-10-17 | 4.2 | `Voiceover` (`apps/engine/src/vo.ts`): one line per step with narration (`vo-<step>`), synthesized with the brief's voice and the neighbouring narrations as previous/next text, written as one `replace /voice` patch (one undo). `VoiceLine.start` is relative to its owner (as the time map already treated explainer lines): 0.25 s after the step's first shown frame; `voiceSpans`/`ownerStart` in core place lines in output time. Words come from the character alignment (`wordsFromAlignment`, split on whitespace, punctuation kept). Regenerating some steps keeps the other lines | Lines follow their step when the timeline is cut or held |
| 2026-10-17 | 4.2 | `generate_voiceover({stepIds?})` agent tool, `vo.generate` RPC and "Regenerate VO" in the Studio timeline toolbar; the pipeline voices the narration right after post-production when the brief has a voice and a key exists (otherwise its summary says why not). Waveform peaks: ffmpeg decodes to mono f32 at 4 kHz, max-abs per 1/50 s, cached as `audio/<hash>.peaks.json`; the lane scales each line to its loudest peak. Added `VoicePlayer` so the preview plays the voice-over in sync (not in the plan, needed to review it) | Checked with a fake ElevenLabs (real MP3s from ffmpeg); the live check still needs the user's key |
| 2026-10-17 | 4.3 | `fitTiming` (`apps/engine/src/timing.ts`) rebuilds each recording scene's segments from the source ranges it currently shows (so cuts survive; earlier holds and speed changes are recomputed, i.e. the fit owns holds/speeds in recording scenes). Per step: needed = lead-in + line + 0.35 s tail; longer voice → a `hold` of the step's last frame; longer action → event-free stretches ≥1.2 s (no pointer, click, typing or key activity) sped up uniformly, at most 1.5×; otherwise the action just runs on. Lead-in is ≥0.25 s and ≥0.6 s after the previous click. Back-to-back pieces are compacted. The patch replaces segments and `/voice` and stretches the automatic Cursor/ClickRipple to the new length. Runs automatically after voice-over generation (same undo group) and from "Fit timing" | Verified on the demo-http take with test voice lines: 1 freeze, 3 sped-up stretches, no line runs into the next step |
| 2026-10-17 | 4.3 | Not guaranteed: "total within ±10% of the storyboard estimate". The estimate counts narration only; steps whose action is still longer than the voice after 1.5× keep their extra length (silence), as the plan prefers over faster playback | Reported instead of forced |
| 2026-10-17 | 4.4 | `autoOverlays` (`apps/engine/src/autoOverlays.ts`): Cursor + ClickRipple over the whole video; one Zoom per cluster of clicks/typing in the same step less than 3 s apart (0.7 s before the first action to 1 s after the last; typing lasts length/14 s; overlapping zooms merge; zoom 1.25–1.8× so the target fills about half the frame); a Blur over each `tut.mask` box from its time to the end; a TitleCard with the project title over the first step. Zoom and Blur use `rect` in stage px (`STAGE_SIZE` now lives in @studio/stage). All are `author: "auto"`, ids `auto-…`. They are rebuilt when a take is registered, on Build from take, after every timing fit (they are in output time) and from "Auto overlays" | Verified on the reference take: 9 overlays, the zoom frames the base-path field while it is typed |
| 2026-10-17 | 4.4 | A user edit to an automatic overlay (move, trim, props) also sets its author to "user" (`claimAutoOverlays` in the timeline store), so rebuilds keep it and skip its fresh twin. The reference script has no `tut.mask` yet (nothing sensitive in its title bar); the Blur rule was checked with a mask event added to a copy of the take | Rebuilding never throws away the user's edits |
