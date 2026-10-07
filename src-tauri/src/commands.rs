use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use cleaner_core::delete::DeleteOutcome;
use cleaner_core::filters::normalize;
use cleaner_core::{ProgressSnapshot, ScanContext, ScanOptions, ScanResult};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

/// Unused-file lists can be huge; the UI gets the largest ones.
const MAX_UNUSED: usize = 50_000;

#[derive(Default)]
pub struct AppState {
    scan: Mutex<Option<ScanContext>>,
    /// Normalized paths from the latest results: the only paths that may be
    /// sent to the Recycle Bin.
    deletable: Mutex<HashSet<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResponse {
    #[serde(flatten)]
    result: ScanResult,
    unused_total: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    home: Option<String>,
    drives: Vec<String>,
    last_access_tracking: Option<bool>,
}

#[tauri::command]
pub async fn start_scan(
    app: AppHandle,
    state: State<'_, AppState>,
    mut options: ScanOptions,
    on_progress: Channel<ProgressSnapshot>,
) -> Result<ScanResponse, String> {
    let ctx = ScanContext::new();
    {
        let mut current = state.scan.lock().unwrap();
        if current.is_some() {
            return Err("A scan is already running".into());
        }
        *current = Some(ctx.clone());
    }

    // Never scan our own data folder; keep the image-hash cache there.
    if let Ok(dir) = app.path().app_local_data_dir() {
        options.hash_cache_path = Some(dir.join("image-hashes.bin"));
        options.excludes.push(dir);
    }

    let worker_ctx = ctx.clone();
    let handle = std::thread::spawn(move || cleaner_core::run_scan(&options, &worker_ctx));
    while !handle.is_finished() {
        let _ = on_progress.send(ctx.progress.snapshot());
        tokio::time::sleep(Duration::from_millis(120)).await;
    }
    let _ = on_progress.send(ctx.progress.snapshot());
    *state.scan.lock().unwrap() = None;

    let mut result = handle
        .join()
        .map_err(|_| "The scan crashed unexpectedly".to_string())?
        .map_err(|e| e.to_string())?;
    let unused_total = result.unused.len();
    result.unused.truncate(MAX_UNUSED);

    *state.deletable.lock().unwrap() = deletable_paths(&result);
    Ok(ScanResponse { result, unused_total })
}

#[tauri::command]
pub fn cancel_scan(state: State<'_, AppState>) {
    if let Some(ctx) = state.scan.lock().unwrap().as_ref() {
        ctx.cancel();
    }
}

#[tauri::command]
pub async fn move_to_recycle_bin(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<Vec<DeleteOutcome>, String> {
    let paths: Vec<PathBuf> = {
        let deletable = state.deletable.lock().unwrap();
        if let Some(bad) = paths.iter().find(|p| !deletable.contains(&normalize(p.as_ref()))) {
            return Err(format!("Refusing to delete a path that is not in the scan results: {bad}"));
        }
        paths.into_iter().map(PathBuf::from).collect()
    };
    let outcomes = tauri::async_runtime::spawn_blocking(move || {
        cleaner_core::delete::move_to_recycle_bin(&paths)
    })
    .await
    .map_err(|e| e.to_string())?;

    let mut deletable = state.deletable.lock().unwrap();
    for o in outcomes.iter().filter(|o| o.ok) {
        deletable.remove(&normalize(o.path.as_ref()));
    }
    Ok(outcomes)
}

#[tauri::command]
pub fn system_info(app: AppHandle) -> SystemInfo {
    let drives = (b'A'..=b'Z')
        .map(|c| format!("{}:\\", c as char))
        .filter(|d| std::path::Path::new(d).exists())
        .collect();
    SystemInfo {
        home: app.path().home_dir().ok().map(|p| p.to_string_lossy().into_owned()),
        drives,
        last_access_tracking: cleaner_core::platform::last_access_tracking_enabled(),
    }
}

fn deletable_paths(r: &ScanResult) -> HashSet<String> {
    let files = r.duplicates.iter().flat_map(|g| g.files.iter().map(|f| &f.path));
    let images = r.similar.iter().flat_map(|g| g.images.iter().map(|i| &i.file.path));
    let unused = r.unused.iter().map(|f| &f.path);
    let caches = r.caches.iter().map(|c| &c.path);
    let empties = r.empty_dirs.iter().map(|e| &e.path);
    files
        .chain(images)
        .chain(unused)
        .chain(caches)
        .chain(empties)
        .map(|p| normalize(p.as_ref()))
        .collect()
}

