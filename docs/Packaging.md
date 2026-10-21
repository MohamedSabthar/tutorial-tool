# Packaging the app

`pnpm package` builds `Tutorial Studio.app` in `apps/desktop/src-tauri/target/release/bundle/macos/`. It runs three steps:

1. `pnpm --filter @studio/desktop build`: the UI.
2. `pnpm package:engine` (`scripts/package-engine.mjs`): stages the engine in `apps/desktop/src-tauri/resources/engine/`.
3. `tauri build --bundles app --config src-tauri/tauri.bundle.conf.json`: the app, with the staged engine as resources.

The extra config adds the engine to the bundle's resources. It's only used here, so `pnpm dev` doesn't copy about 500 MB on every build.

## What's in the bundle

The engine needs real packages at runtime. Vite and esbuild compile overlays and scripts, TypeScript and ESLint check agent overlays, Playwright drives the browsers, and the agent SDK ships a native Claude binary. So it ships as a folder rather than one executable (see the Decisions log, step 8.2):

| Path in `Contents/Resources/engine` | What |
|---|---|
| `node` | The Node runtime that ran the packaging (Node 20.19) |
| `apps/engine/dist/main.mjs` | The engine, bundled with esbuild |
| `apps/engine/seed/` | The workspace seed: skills and the reference tutorial |
| `apps/desktop/dist/` | The built UI, served to the render host |
| `packages/*/src/` | Package sources, for type-checking agent overlays |
| `node_modules/` | Runtime packages and the overlay type-check's types (installed with npm, no install scripts) |

## How the app runs it

Release builds start `engine/node engine/apps/engine/dist/main.mjs`. Everything per user lives in `~/.tutorial-studio`:

| | |
|---|---|
| `workspace/` | The workspace (Settings → Workspace can move it; the choice is kept in `app.json`) |
| `ms-playwright/` | Chromium, downloaded on first use (`PLAYWRIGHT_BROWSERS_PATH`) |
| `vscode/`, `extensions/` | The pinned VS Code and its extensions, downloaded on first use |
| `signin/<product>/` | Saved sign-in profiles (Brief → Sign in to the product) |
| `profiles/` | Throwaway profiles of runs in progress |
| `logs/engine.log` | The engine's log |

The engine also gets `/opt/homebrew/bin:/usr/local/bin` on its PATH, because apps opened from Finder get a minimal PATH and ffmpeg and git come from Homebrew. ffmpeg isn't bundled (its builds are GPL); the Get started checklist asks for `brew install ffmpeg`.

## Signing and notarization

Unsigned builds run on the machine that built them. Before sharing the app with teammates:

1. **Sign with a Developer ID Application certificate.** Set `bundle.macOS.signingIdentity` in `tauri.bundle.conf.json`, or `APPLE_SIGNING_IDENTITY` in the environment. Tauri signs the app and its main binary.
2. **Sign the nested executables too.** Tauri doesn't sign files under `Resources` on its own. Before notarizing, sign each of these with the hardened runtime and a timestamp:
   - `engine/node`
   - `engine/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`
   - esbuild's binary: `engine/node_modules/@esbuild/darwin-arm64/bin/esbuild`

   For example:

   ```sh
   codesign --force --options runtime --timestamp --entitlements entitlements.plist -s "$APPLE_SIGNING_IDENTITY" <file>
   ```

3. **Entitlements.** Node's JIT needs `com.apple.security.cs.allow-jit` and `com.apple.security.cs.allow-unsigned-executable-memory`. The agent SDK binary needs the same.
4. **Notarize and staple.** Set `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID`, and `tauri build` notarizes. Otherwise use `xcrun notarytool submit --wait`, then `xcrun stapler staple "Tutorial Studio.app"`.
5. **Check:**

   ```sh
   spctl -a -vv "Tutorial Studio.app"
   codesign --verify --deep --strict "Tutorial Studio.app"
   ```

## Testing on a clean account

The real check is a macOS user account that has never run the app. Log in as that user, copy the app to `/Applications`, open it, and follow Get started on the Projects screen. On the same Mac, the other accounts' Homebrew (ffmpeg) and `/Applications/WSO2 Integrator.app` are shared, but Claude sign-in, the ElevenLabs key, the workspace and all downloads are per user.
