# UI redesign: progress

Branch: `ui-redesign` (from `ux-review`). Target design: `docs/ux-review/prototype-v2.html`. Findings: `docs/ux-review/index.html`.

## Rules

- One step at a time, in order. Each step ends testable in `pnpm dev` / `pnpm dev:web`.
- Before each commit: `pnpm typecheck && pnpm lint && pnpm test`. Commit message `step 13.X: <summary>`, no AI trailers.
- The app chrome uses the new neutral theme (TUFFUI-style tokens in `packages/ui`). The video (Stage, overlays, scenes, exports) keeps the WSO2 look. Don't touch `packages/stage`, `overlays-core`, `scenes-core` styling.
- Real buttons, labels on every control, keyboard reachable. No raw hex in app code: use `--ui-*` tokens.
- Never touch the macOS Keychain. Don't run real pipelines or agent sessions to test; use the dev engine and existing projects.
- Tick the step here and in `docs/Implementation.md` (Phase 13), and log any change of plan in the Decisions log.

## Steps

- [x] 13.1 Kit v2: theme tokens (light/dark), Shell/Panel/Inset/IconTile, pill buttons (brand, primary, quiet, danger), StatusPill, Tag, Kbd, Dots, Elapsed, AgentStatus, StripeProgress, Sheet, Popover, Toasts, new icons
- [x] 13.2 App shell: top bar with text nav (Tutorials, Settings, Help), dev shell only in dev, engine chip only when disconnected, toasts and notifications (in-app + OS)
- [x] 13.3 Home: composer (one tutorial / series, product, who clicks, Customize = brief basics, estimate), start goes straight to Making; setup notice; tutorials as tiles with series tiles, open/expand, Add to series
- [ ] 13.4 Making: one screen for the run (status bar with 5 stages, timer, time left, stop), live view, "What it did" feed with details, approval cards, Check the script, Check the steps, late cues, failure recovery, done → Watch and edit
- [ ] 13.5 Series outline: draft, review, edit episodes, shared settings, approve and make
- [ ] 13.6 Studio editing: steps rail, preview with chapter scrubber, step panel (what's said + re-voice, on screen, pace), Fix this moment sheet and click-to-place
- [ ] 13.7 Studio agent: dock with live status, approvals, results (Keep / Undo / Tell it more), Changes history; old timeline behind "Timeline"
- [ ] 13.8 Export: name, size, save folder with reveal, outputs, progress, finished files
- [ ] 13.9 Settings: checklist with copy, accounts, agent (limit, ask before commands), voice, what the agent learned, appearance, advanced
- [ ] 13.10 Cleanup: old routes redirect to the new screens, short Help, docs, final checks

DONE: no
