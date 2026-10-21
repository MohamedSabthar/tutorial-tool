# Testing

`pnpm test` runs the unit and integration tests (vitest, projects `packages/*` and `apps/engine`). Run it with `pnpm typecheck && pnpm lint` before every commit.

Two suites need the real machine and only run on demand.

## Preview/export parity: `pnpm test:parity`

Builds the app, then checks that the export draws what the preview shows, and that export is deterministic. File: `apps/engine/test/parity.gpu.test.ts`.

**Needs:** a GPU (Apple silicon or a discrete GPU), Playwright's Chromium and WebKit (`npx playwright install chromium webkit`), and ffmpeg on the PATH.

**What it does:** it makes a fixture project with a synthetic H.264 take (colour bars, a moving line, a burned-in timecode), two steps, the automatic overlays, core and agent-written overlays, captions, and an explainer with FreezeMorph transitions. Then it runs two tests:

1. **Parity.** Eight moments (title card, click ripple and zoom, box/badge/captions, transition in, explainer, transition out, typing/callout/keystroke, end of recording) are rendered twice:
   - as the preview shows them: the render page in WebKit, the engine of the app's webview, with a seeking `<video>`;
   - as export draws them: GPU Chromium in export mode, with WebCodecs frames.

   Each pair must be within the tolerance below.
2. **Determinism.** Two separate export runs render the first 45 frames, and the frames around the explainer, byte for byte the same.

**Tolerance:** `TOLERANCE` in the test file.

| Measure | Limit | Typical |
|---|---|---|
| Mean absolute difference per channel (0–255) | ≤ 2 | 0.01–1.0 |
| Share of pixels off by more than 24 | ≤ 1% | 0.02–0.4% |

The remaining differences are text antialiasing and gradient dithering between WebKit and Chromium.

**Output:** `test-results/parity/` gets each pair of frames (`NN-<moment>-export.png`, `NN-<moment>-preview.png`) and `report.txt` with the numbers. When it fails, compare the pair. The fixture's burned-in timecode (top left) shows which video frame each side drew.

## Recorder regression: `pnpm test:recorder`

Opens real product windows. On first run it downloads the pinned VS Code into `~/.tutorial-studio`.

- `packages/recorder/test/vscode.e2e.test.ts`: launches WSO2 Integrator twice and checks the window (full screen, project detected, no dialogs, the same layout both times).
- `apps/engine/test/reference.e2e.test.ts`: dry-runs the seeded reference tutorial (`apps/engine/seed/workspace/projects/demo-http`) in two products:
  - `wso2-integrator-vscode`: the pinned VS Code with `WSO2.wso2-integrator@1.0.1`;
  - `wso2-integrator`: the installed WSO2 Integrator app.

  All five steps must pass.

A failure means the product UI changed under the seed skill's page objects. The error names the failing step and what it waited for. Fix the page objects in `apps/engine/seed/workspace/.claude/skills/wso2-integrator/`. The agent does the same for existing workspaces through its repair loop.
