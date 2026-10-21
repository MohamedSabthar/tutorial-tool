//! Starts the Node engine sidecar and hands its port and token to the webviews.
//!
//! The engine prints `READY <port> <token>` on stdout once it is listening. It also exits
//! when its stdin closes, so it never outlives the app.
//!
//! Dev builds run the engine from the repo with `tsx watch`. Release builds run the packaged
//! engine (`pnpm package:engine`) from the app's resources, with its own Node runtime, and keep
//! the workspace, downloads and logs in `~/.tutorial-studio`.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone, serde::Serialize)]
pub struct EngineInfo {
    pub port: u16,
    pub token: String,
}

#[derive(Default)]
pub struct EngineState {
    ready: Arc<Mutex<Option<Result<EngineInfo, String>>>>,
    child: Mutex<Option<Child>>,
}

/// apps/engine, found relative to this crate at build time (dev builds).
fn engine_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../engine")
}

/// `~/.tutorial-studio`: the packaged app's workspace, downloads and logs.
pub fn studio_home() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/tmp"));
    home.join(".tutorial-studio")
}

/// Directories a Finder-launched app lacks on its PATH: Homebrew's (ffmpeg, git).
const EXTRA_PATH: &str = "/opt/homebrew/bin:/usr/local/bin";

impl EngineState {
    /// Starts the engine: the packaged one in `resources/engine` for release builds, the repo's
    /// otherwise. `workspace` overrides the default workspace folder.
    pub fn spawn(&self, resources: Option<PathBuf>, workspace: Option<PathBuf>) {
        // Fixed port and token for the app's lifetime, so a dev restart of the engine (tsx
        // watch reloads it when its code changes) keeps the same address and the windows
        // simply reconnect.
        let port = free_port().unwrap_or(4317);
        let token = random_token();
        let packaged = resources.map(|r| r.join("engine")).filter(|r| !cfg!(debug_assertions) && r.join("node").exists());
        let result = match &packaged {
            Some(dir) => packaged_command(dir, workspace, port, &token),
            None => dev_command(workspace, port, &token),
        }
        .and_then(|mut cmd| {
            cmd.env("STUDIO_PARENT_PID", std::process::id().to_string())
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .map_err(|e| format!("could not start the engine: {e}"))
        });

        let mut child = match result {
            Ok(c) => c,
            Err(e) => {
                *self.ready.lock().unwrap() = Some(Err(e));
                return;
            }
        };

        let stdout = child.stdout.take().expect("piped stdout");
        let ready = Arc::clone(&self.ready);
        std::thread::spawn(move || {
            let mut announced = false;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if !announced {
                    if let Some(info) = parse_ready(&line) {
                        *ready.lock().unwrap() = Some(Ok(info));
                        announced = true;
                        continue;
                    }
                }
                println!("[engine] {line}");
            }
            if !announced {
                *ready.lock().unwrap() = Some(Err(
                    "the engine exited before it was ready (see the terminal, or ~/.tutorial-studio/logs/engine.log)".into(),
                ));
            }
        });

        *self.child.lock().unwrap() = Some(child);
    }

    /// A handle that can wait for readiness off the async runtime.
    pub fn ready_handle(&self) -> ReadyHandle {
        ReadyHandle(Arc::clone(&self.ready))
    }

    pub fn kill(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            drop(child.stdin.take());
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub struct ReadyHandle(Arc<Mutex<Option<Result<EngineInfo, String>>>>);

impl ReadyHandle {
    pub fn wait(&self, timeout: Duration) -> Result<EngineInfo, String> {
        let start = Instant::now();
        loop {
            if let Some(r) = self.0.lock().unwrap().clone() {
                return r;
            }
            if start.elapsed() > timeout {
                return Err("timed out waiting for the engine to start".into());
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

/// The repo's engine under `tsx watch`, with `node` from the PATH.
fn dev_command(workspace: Option<PathBuf>, port: u16, token: &str) -> Result<Command, String> {
    let dir = engine_dir();
    let workspace = workspace.unwrap_or_else(|| dir.join("../../workspace"));
    let mut cmd = Command::new("node");
    // Workspace scripts and skills are imported at run time; editing them (the agent does)
    // must not restart the engine.
    cmd.args([
        "node_modules/tsx/dist/cli.mjs",
        "watch",
        "--clear-screen=false",
        "--exclude",
        "../../workspace/**",
        "--exclude",
        "**/workspace/**",
        "src/main.ts",
    ])
    .arg("--workspace")
    .arg(&workspace)
    .args(["--port", &port.to_string(), "--token", token])
    .env("STUDIO_EXIT_ON_STDIN_END", "0")
    .current_dir(&dir)
    .stderr(Stdio::inherit());
    Ok(cmd)
}

/// The packaged engine on its own Node runtime. Its log goes to `~/.tutorial-studio/logs`.
fn packaged_command(dir: &Path, workspace: Option<PathBuf>, port: u16, token: &str) -> Result<Command, String> {
    let home = studio_home();
    let logs = home.join("logs");
    std::fs::create_dir_all(&logs).map_err(|e| format!("could not create {}: {e}", logs.display()))?;
    let log = std::fs::File::create(logs.join("engine.log"))
        .map_err(|e| format!("could not open the engine log: {e}"))?;
    let path = match std::env::var("PATH") {
        Ok(p) if !p.is_empty() => format!("{EXTRA_PATH}:{p}"),
        _ => format!("{EXTRA_PATH}:/usr/bin:/bin:/usr/sbin:/sbin"),
    };
    let mut cmd = Command::new(dir.join("node"));
    cmd.arg(dir.join("apps/engine/dist/main.mjs"))
        .arg("--workspace")
        .arg(workspace.unwrap_or_else(|| home.join("workspace")))
        .args(["--port", &port.to_string(), "--token", token])
        .env("PATH", path)
        .env("STUDIO_CACHE", &home)
        .env("PLAYWRIGHT_BROWSERS_PATH", home.join("ms-playwright"))
        .current_dir(dir)
        .stderr(Stdio::from(log));
    Ok(cmd)
}

/// A free localhost port, chosen by binding to port 0.
fn free_port() -> Option<u16> {
    std::net::TcpListener::bind("127.0.0.1:0").ok()?.local_addr().ok().map(|a| a.port())
}

/// 24 random bytes as hex, from the OS random source.
fn random_token() -> String {
    use std::io::Read;
    let mut bytes = [0u8; 24];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        let _ = f.read_exact(&mut bytes);
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn parse_ready(line: &str) -> Option<EngineInfo> {
    let mut parts = line.split_whitespace();
    if parts.next()? != "READY" {
        return None;
    }
    let port = parts.next()?.parse().ok()?;
    let token = parts.next()?.to_string();
    Some(EngineInfo { port, token })
}

#[cfg(test)]
mod tests {
    use super::parse_ready;

    #[test]
    fn parses_the_ready_line() {
        let info = parse_ready("READY 4317 abc").unwrap();
        assert_eq!(info.port, 4317);
        assert_eq!(info.token, "abc");
        assert!(parse_ready("engine: listening").is_none());
    }
}
