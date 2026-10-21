mod engine;

use std::time::Duration;

use engine::{EngineInfo, EngineState};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

/// Port and token of the engine, waiting for it to start if needed.
#[tauri::command]
async fn get_engine(state: tauri::State<'_, EngineState>) -> Result<EngineInfo, String> {
    // Waiting blocks while the sidecar boots, so keep it off the async runtime.
    let ready = state.ready_handle();
    tauri::async_runtime::spawn_blocking(move || ready.wait(Duration::from_secs(30)))
        .await
        .map_err(|e| e.to_string())?
}

/// Opens the Live window, or focuses it if it is already open.
#[tauri::command]
fn open_live_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("live") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, "live", WebviewUrl::App("index.html#/live".into()))
        .title("Tutorial Studio · Live")
        .inner_size(1440.0, 900.0)
        .min_inner_size(1000.0, 680.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Opens (or focuses) another Studio window on a route, e.g. to test multi-window sync.
#[tauri::command]
fn open_studio_window(app: tauri::AppHandle, label: String, route: String) -> Result<(), String> {
    if !label.starts_with("studio-") || !label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("window labels must look like studio-<name>".into());
    }
    if let Some(w) = app.get_webview_window(&label) {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(format!("index.html#{route}").into()))
        .title("Tutorial Studio")
        .inner_size(1200.0, 860.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(EngineState::default())
        .setup(|app| {
            let resources = app.path().resource_dir().ok();
            app.state::<EngineState>().spawn(resources, None);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_engine, open_live_window, open_studio_window])
        .build(tauri::generate_context!())
        .expect("error while building Tutorial Studio");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            handle.state::<EngineState>().kill();
        }
    });
}
