# WSO2 Tutorial Studio

This is a desktop app (Tauri) in which a headless Claude Code agent records WSO2 product tutorials in VS Code with Playwright. The user then edits them in a Studio window: preview, timeline, agent-written React overlays, explainer scenes, ElevenLabs voice-over and GPU export.

- **Design:** `docs/PLAN.md`
- **Build plan with progress tracker:** `docs/Implementation.md`. Work through it **in order, one step at a time**.
- **UI mockups:** `ui/` (Design Component `.dc.html` files; see `ui/README.md`)

## Workflow

- Each step in `docs/Implementation.md` must end in something **testable in the UI** (`pnpm dev`). Finish the step's "Done when" check, run the checks below, and tick the step in the progress tracker. Record any change from the plan in the Decisions log.
- **Commit after each step:** one commit per step, message `step X.Y: <summary>`. Never add AI co-author trailers or "Generated with" lines.
- Hand the user short UI test instructions for what the step added.

## Commands

```bash
pnpm install          # install workspace deps
pnpm dev              # run the Tauri app (Vite on :1420 + Rust shell)
pnpm dev:web          # frontend only, in the browser
pnpm typecheck        # tsc -b across all project references
pnpm lint             # eslint
pnpm test             # vitest (projects: packages/*, apps/engine)
npx prettier --write . # format
```

Run `pnpm typecheck && pnpm lint && pnpm test` before every commit.

## Layout

```
apps/desktop      Tauri v2 shell (src-tauri/, Rust) + React 19/Vite 8 UI (src/)
apps/engine       Node sidecar: RPC, agent sessions, recorder, TTS, export
packages/core     zod schemas, patches, time mapping, RPC types
packages/recorder Playwright launchers (VS Code first) + tut helpers
packages/stage    composition runtime (R3F stage, virtual clock, camera)
packages/overlay-sdk, overlays-core, scenes-core   overlay/scene authoring
packages/tts      ElevenLabs client
packages/exporters GPU MP4, SRT/VTT, Markdown
packages/ui       WSO2 design tokens + shared React components
workspace/        (generated, git-ignored here) the agent's knowledge base: its own git repo
```

## Conventions

- **Environment:** Node 20.19 (`.nvmrc`), pnpm 10, TypeScript 5.9 strict, ESM everywhere. Packages export TS source (`"exports": "./src/index.ts"`); `tsc -b` only type-checks.
- **Imports:** `import type` for type-only imports (enforced by lint).
- **Validation:** zod at every I/O boundary (RPC, files, agent tool inputs, timeline patches).
- **Timeline changes:** `tutorial.json` changes only via validated patches, so undo/redo and window sync work.
- **Overlays and scenes** must be pure functions of time: no `Date.now`, unseeded `Math.random`, timers, CSS animations or transitions.
- **UI styling:** the WSO2 Slides design system in a light theme.
  - Colours: white `#FFFFFF`, `#F3F3F3` surfaces, `#D7D7D7` hairlines, navy `#13213B` text and active states, orange `#FF5800` primary buttons with white text, steel blue `#4F7AA3` for annotations and gates.
  - Type and shape: Inter, JetBrains Mono for data, 14px radii.
  - Once `packages/ui` exists (step 0.5), use its tokens and components. Don't put raw hex values in app code.
- **Accessibility:** real buttons, links and inputs, a label on every control, keyboard reachable.
- **Licences:** no commercially licensed dependencies (no Remotion).
- **Secrets:** API keys never go in the repo, logs or agent context.
