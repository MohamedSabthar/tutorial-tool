# Brief for agents implementing the UI redesign (Phase 13)

Read first: `CLAUDE.md`, `docs/ux-review/redesign-progress.md`, and the target design `docs/ux-review/prototype-v2.html` (a clickable HTML prototype; its JS shows the intended behaviour, its CSS the intended look). The findings behind it are in `docs/ux-review/index.html`.

## What's already done (13.1, 13.2)

- **Theme:** `packages/ui/src/styles.css` has new tokens. Use the kit-v2 names in new code: `--ui-bg`, `--ui-fg`, `--ui-muted`, `--ui-faint`, `--ui-surface`, `--ui-inset`, `--ui-raised`, `--ui-f04/f06/f08/f12` (translucent foreground), `--ui-brand`, `--ui-brand-ink`, `--ui-brand-15`, `--ui-brand-08`, `--ui-positive(-15)`, `--ui-negative(-15)`, `--ui-warning(-15)`, `--ui-on-fill`, `--ui-pop`, `--ui-scrim`, `--ui-radius-sm/md/lg/xl/pill`, `--ui-font`, `--ui-mono`, `--ui-display`, `--ui-ease`. Light and dark both work through these. No raw hex in app code.
- **Kit components** (`packages/ui/src/kit.tsx`, `glyphs.tsx`, exported from `@studio/ui`):
  - Surfaces: `Shell`, `ShellHeader` (icon, tone, title, subtitle, aside), `ShellPanel`, `Inset`, `IconTile`.
  - Labels: `StatusPill` (tone, icon, busy dots), `Tag`, `Kbd`, `Dots`, `Spinner`, `Elapsed`, `formatElapsed`.
  - Progress and activity: `StripeProgress`, `AgentStatus` (label, since, steps, onStop).
  - Overlays: `Sheet` (modal), `Popover`, `Menu`/`MenuItem`/`MenuLabel`/`MenuSeparator`, `ToastProvider` (already mounted in `main.tsx`), `useToast()` (message, `{ undo, action, tone }`), `notifySystem`.
  - Icons: `Glyph` (filled icons by name: play, pause, back, next, spark, wand, mic, arrow, label, box, hide, gauge, check, x, warn, stop, pin, undo, redo, history, upload, folder, film, gear, plus, trash, lock, send, clock, dots, help, search, copy, timeline, record, expand).
  - Buttons: the existing `Button`/`LinkButton`/`IconButton` with variants `brand` (main action), `silver`, `secondary`, `quiet`, `danger`, plus sizes `sm`/`md`/`lg`. They're pill-shaped now.
  - Also still there: `Segmented`, `Field`, `Input`, `TextArea`, `Select`, `Switch`, `Stepper`.
- **App shell** (`apps/desktop/src/routes/frame.tsx`):
  - `TopBar` (current: tutorials/settings/help, center, actions), `AppFrame` (old frame, now uses TopBar), `EngineStatus`, `LiveChip`, `navigate()`, `runRoute()`.
  - `RunNotifier` (`routes/RunNotifier.tsx`) toasts gates, completion and failures app-wide.
  - The developer pages only exist in dev builds.

## Rules

- **Your own files.** Put new screen code in new files under your assigned folder, with a CSS file per screen imported from its `.tsx`. Use class prefixes unique to your screen. Touch shared files (`main.tsx`, `frame.tsx`, `routes.css`, `packages/ui`) only where your task says so, and keep those edits small.
- **Reuse the engine.** Use the existing RPC methods (`packages/core/src/rpc.ts`) and the existing hooks (`apps/desktop/src/pipeline.ts`, `studio/useTimeline.ts`, `studio/useAgent.ts`, `studio/useRuns.ts`, …). Don't change the engine unless your task says so. If a feature truly needs an engine change, keep it small, tested, and mention it in your report.
- **Copy.** Plain words from the user's side. Use the glossary in `docs/ux-review/index.html` ("One word per idea"): Recording (not take), Script (what the narrator says), Voice-over, Check the script / Check the steps (not gate), Explainer, Overlay, Note (not annotation), Ask the agent. Keep IDs, costs, session IDs and tool names behind a "Details" disclosure.
- **Accessibility.** Real buttons and links, a label on every control, keyboard reachable, visible focus, and state never shown by colour alone.
- **Before you commit:** `pnpm typecheck && pnpm lint && pnpm test`. The 2 `videoCheck` test failures are known: they need ffmpeg `drawtext`. Commit message `step 13.X: <summary>`, no AI co-author trailers or "Generated with" lines. Tick your step in `docs/ux-review/redesign-progress.md` and `docs/Implementation.md`.

## Safety: never do these while testing

Never start or approve a real pipeline, recording, agent session, export, voice-over synthesis or product sign-in. In RPC terms, never call:

- `pipeline.start`, `pipeline.approve`, `pipeline.resume`, `pipeline.revise`
- `project.record`, `agent.send`
- `vo.generate`, `tts.synthesize`, `tts.setKey`, `tts.clearKey`
- `export.start`
- `capture.start`
- `product.signIn`, `recorder.*`
- `series.plan`, `explainers.start`

Also never use `security` or the macOS Keychain.

**Never change or delete anything in the existing workspace** (`workspace/`: projects, series, skills, overlays, scenes, settings, products, pronunciations), so every existing project keeps working. Only read-only RPC calls; no writing calls of any kind (no `timeline.patch`/`undo`/`redo`, `project.*` writes, `brief.save`, `series.*` writes, `vo.*`, `settings.update`, `products.save`, `pronunciations.save`, `runs.*`, `capture.*`). For states you can't reach safely (a run in progress, a check waiting, the agent working), add a dev-only preview: a fixture that renders the component with sample data when `import.meta.env.DEV` and a `?preview=<state>` hash parameter are set.

## How to run and look at it

The dev engine is already running on port 4317, with the repo's `workspace/`. Your worktree needs dependencies: run `pnpm install --frozen-lockfile --prefer-offline`. Start your own Vite on your assigned port in the background:

```
cd apps/desktop && npx vite --port <PORT> --strictPort
```

Run it with stdin kept open and outside the sandbox (`dangerouslyDisableSandbox: true`), because the sandbox blocks localhost between processes.

Screenshot with the helper (also outside the sandbox):

```
node /private/tmp/claude-501/-Users-admin-Desktop-tutorial-tool/063b4a2e-844d-4c35-9ead-e328e71e9506/scratchpad/snap.mjs <PORT> <outDir> name=/route name2=/route2 [--dark] [--w=1440] [--h=900]
```

It prints page errors. Look at the PNGs with the Read tool. For interactions, write a small Playwright script modelled on `snap.mjs`. Check light, dark and a 1280×800 window. Projects with real data: `creating-an-ai-agent` (recorded and edited), `math-tutor`, `demo-http`, `test`.

Stop your Vite when you're done.
