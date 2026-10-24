# Tutorial Studio

A macOS desktop app that makes WSO2 product tutorials. You describe a task; a Claude Code agent plans the steps, records them in the real product with Playwright, and drafts the narration, overlays and explainers. You review it at each gate and finish the edit in the Studio, then export an MP4, captions, a Markdown write-up and the script.

- **Using the app:** open the Guide from the **?** icon in the app's header (`#/guide`). It covers every screen and editing tool, and ends with how the app is built.
- **Design:** [docs/PLAN.md](docs/PLAN.md). **Build plan and decisions log:** [docs/Implementation.md](docs/Implementation.md).

## Requirements

| Tool                     | Version                | Notes                                                                                                                                                |
| ------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS                    | Apple Silicon or Intel | The DMG is built for the Mac that builds it.                                                                                                         |
| Node                     | 20.19 or later         | `.nvmrc` pins it: `nvm use`.                                                                                                                         |
| pnpm                     | 10                     | `corepack enable` provides it.                                                                                                                       |
| Rust                     | stable                 | [rustup.rs](https://rustup.rs). Needed for the Tauri shell.                                                                                          |
| Xcode Command Line Tools |                        | `xcode-select --install`                                                                                                                             |
| ffmpeg                   | 7                      | `brew install ffmpeg`. Encoding takes, voice-over mixing and export.                                                                                 |
| Claude Code              | latest                 | Installed by each user, not shipped with the app: `curl -fsSL https://claude.ai/install.sh \| bash` (or `npm install -g @anthropic-ai/claude-code`). |
| git                      |                        | The workspace is a git repository.                                                                                                                   |
| WSO2 Integrator          |                        | Installed in `/Applications`, or VS Code with the WSO2 extension (set in Settings → Products).                                                       |

Accounts:

- **Claude:** the agent runs the Claude Code installed on the Mac (found on the PATH or in `~/.local/bin`; Settings can point at another) with its own sign-in. Run `claude auth login` in Terminal, then **Check sign-in** in Settings.
- **Models:** Settings → New tutorials → **Agent model** picks the Claude models the pipeline uses: Balanced (Opus for research, planning and repairs; Sonnet for the rest), all Sonnet, all Opus, or **Custom models** with any model id or alias for each of the two roles.
- **ElevenLabs:** an API key for the voice-over, added in Settings. It is checked with ElevenLabs and kept in the macOS Keychain; it never goes into the repo, logs or the agent's context.

## Run it in development

```bash
nvm use
corepack enable
pnpm install
pnpm dev
```

`pnpm dev` starts the whole app: Vite on port 1420, the Tauri window, and the engine (the Node sidecar) under `tsx watch`, so the engine restarts when its code changes and the window reconnects by itself. UI changes hot-reload.

| Command                   | What runs                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                | The full app: Tauri window + Vite (:1420) + engine. Start here.                                                  |
| `pnpm dev:web`            | Only the UI, in a browser at <http://localhost:1420>. It needs an engine: run `pnpm engine` in another terminal. |
| `pnpm engine`             | The engine alone on port 4317 with the token `dev-token` (what `dev:web` connects to).                           |
| `pnpm rec <slug> [--dry]` | Runs a project's `script.spec.ts` against the product from the terminal; without `--dry` it saves a take.        |

In development builds the header has a **‹›** icon that opens the developer pages (one per build step).

### Where things are kept

|                                               | Development (`pnpm dev`)                                               | Installed app                                                |
| --------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| Workspace (projects, skills, shared overlays) | `./workspace` in the repo, git-ignored here and its own git repository | `~/.tutorial-studio/workspace` (change it in Settings)       |
| Engine log                                    | the terminal running `pnpm dev`                                        | `~/.tutorial-studio/logs/engine.log`                         |
| Browsers for previews and export              | Playwright's default cache                                             | `~/.tutorial-studio/ms-playwright` (downloaded on first use) |
| App settings                                  | `~/.tutorial-studio/app.json`                                          | same                                                         |

A new workspace is created from `apps/engine/seed/workspace` the first time the engine starts with an empty folder.

## Checks

Run these before every commit:

```bash
pnpm typecheck && pnpm lint && pnpm test
npx prettier --write .
```

Slower suites, run on demand:

- `pnpm test:recorder`: end-to-end recording against the real product (`STUDIO_E2E=1`).
- `pnpm test:parity`: GPU export parity between the preview and the renderer (`STUDIO_PARITY=1`, builds the UI first).

## Build the app

```bash
pnpm dmg            # .app and .dmg
pnpm package        # .app only
```

`pnpm dmg` (`scripts/build-dmg.mjs`) checks the tools, builds the UI, stages the engine, and runs `tauri build --bundles app,dmg`. It prints where the DMG is:

```
apps/desktop/src-tauri/target/release/bundle/dmg/Tutorial Studio_<version>_<arch>.dmg
apps/desktop/src-tauri/target/release/bundle/macos/Tutorial Studio.app
```

Options: `--skip-ui` and `--skip-engine` reuse the last UI build or staged engine; `--open` reveals the DMG in Finder.

What goes into the app (about 280 MB installed, a 77 MB DMG):

| Part                                 | Size   | What it is                                                                                                                                                                                                                                                     |
| ------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Contents/MacOS/tutorial-studio`     | 11 MB  | The Tauri shell (Rust) with the built UI.                                                                                                                                                                                                                      |
| `Resources/engine/node`              | 84 MB  | The Node runtime that ran the build, so users don't need Node.                                                                                                                                                                                                 |
| `Resources/engine/apps/engine/dist`  | 7 MB   | The engine, bundled with esbuild.                                                                                                                                                                                                                              |
| `Resources/engine/apps/desktop/dist` | 4 MB   | The UI again, for the export renderer.                                                                                                                                                                                                                         |
| `Resources/engine/apps/engine/seed`  | < 1 MB | The workspace seed: skills, `CLAUDE.md`, the reference tutorial.                                                                                                                                                                                               |
| `Resources/engine/packages/*/src`    | < 1 MB | Package sources, so agent-written overlays type-check against the SDK.                                                                                                                                                                                         |
| `Resources/engine/node_modules`      | 171 MB | Packages the engine loads at run time: Playwright, the Claude Agent SDK (JavaScript only), Vite and rolldown, esbuild, TypeScript and ESLint (to compile and check agent-written overlays), React, three.js, GSAP and zod (the overlay runtime and its types). |

Not in the app, installed on the Mac instead: **Claude Code**, **ffmpeg**, **git** (from the Xcode Command Line Tools), the **WSO2 product**, and the **Chromium** used for previews and export (downloaded on first use into `~/.tutorial-studio/ms-playwright`). The packaging script removes the Agent SDK's bundled Claude Code binary.

The version comes from `apps/desktop/src-tauri/tauri.conf.json`.

### Installing on other Macs

The DMG runs on any Mac with the **same architecture** as the build Mac (Apple Silicon builds `aarch64`; build on an Intel Mac for `x64`), on macOS 11 or later. Each Mac needs Claude Code, ffmpeg, git and the WSO2 product installed; the Settings checklist shows what is missing.

By default the app is **ad-hoc signed and not notarized**. The first time it is opened on another Mac, macOS blocks it: right-click the app and choose **Open**, or go to **System Settings → Privacy & Security → Open Anyway**. To skip that, sign and notarize it (below).

### Signing and notarizing

With a Developer ID certificate and an Apple developer account, set these before `pnpm dmg`. The script signs every executable in the engine folder (Node, esbuild and the native modules) with the hardened runtime and `src-tauri/engine.entitlements`, Tauri signs the app, and with the Apple ID variables Tauri notarizes it, so it opens on any Mac without a warning:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: <Name> (<TEAMID>)"
export APPLE_ID="<apple id email>"
export APPLE_PASSWORD="<app-specific password>"
export APPLE_TEAM_ID="<TEAMID>"
pnpm dmg
```

The installed app still needs ffmpeg and git on the Mac (it adds `/opt/homebrew/bin` and `/usr/local/bin` to its PATH, since apps opened from Finder don't get the shell's PATH).

## Engine options

The Tauri shell passes these; set them yourself only when running the engine by hand.

| Flag / variable                   | Meaning                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `--workspace`, `STUDIO_WORKSPACE` | Workspace folder (default `./workspace`).                                    |
| `--port`, `STUDIO_PORT`           | Port (default: a free one).                                                  |
| `--token`, `STUDIO_TOKEN`         | Token the UI must send (default: random).                                    |
| `STUDIO_PARENT_PID`               | Exit when that process is gone. The engine also exits when its stdin closes. |
| `ELEVENLABS_API_KEY`              | Overrides the saved ElevenLabs key.                                          |
| `STUDIO_NO_KEYCHAIN=1`            | Keep secrets in a file instead of the Keychain (test engines).               |
| `STUDIO_SECRETS_FILE`             | That file's path.                                                            |
| `STUDIO_UI_URL`, `STUDIO_UI_DIST` | Where the export renderer loads the app from (dev server or a built `dist`). |

The engine prints `READY <port> <token>` once it listens; the shell reads that line.

## Troubleshooting

- **"Engine offline" in the browser:** `pnpm dev:web` needs `pnpm engine` running.
- **Port 1420 in use:** another `pnpm dev` or `pnpm dev:web` is running; stop it first.
- **The installed app's engine won't start:** read `~/.tutorial-studio/logs/engine.log`.
- **Export or preview can't find a browser:** the Settings checklist downloads Chromium on first use.
- **Voice-over missing after recording:** choose a voice in the brief before starting; see the Guide's "Write the brief".

## Repo layout

```
apps/desktop       Tauri v2 shell (src-tauri/, Rust) + React 19 / Vite UI (src/)
apps/engine        Node sidecar: RPC, pipeline, agent sessions, recorder, voice-over, export
packages/core      zod schemas, timeline patches, time mapping, RPC types
packages/recorder  Playwright launchers and the tut helpers scripts use
packages/stage     composition runtime: R3F stage, virtual clock, camera
packages/overlay-sdk, overlays-core, scenes-core   overlay and explainer authoring
packages/tts       ElevenLabs client
packages/exporters GPU MP4, SRT/VTT, Markdown
packages/ui        WSO2 design tokens and shared components (light and dark)
scripts/           package-engine.mjs, build-dmg.mjs
ui/                design mockups
workspace/         (generated, git-ignored) the agent's knowledge base and projects
```

Conventions (TypeScript, validation, timeline patches, styling) are in [CLAUDE.md](CLAUDE.md).
