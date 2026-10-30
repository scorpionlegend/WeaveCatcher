use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

/// Mirrors the persisted `autoUpdate` setting so the background worker reacts
/// without re-reading the settings file on every poll.
static AUTO_UPDATE: AtomicBool = AtomicBool::new(false);
/// Set when auto-update is switched on so the worker checks immediately instead
/// of waiting for the next poll interval.
static WAKE: AtomicBool = AtomicBool::new(false);

const STARTUP_DELAY: Duration = Duration::from_secs(12);
const POLL_INTERVAL: Duration = Duration::from_secs(15 * 60);
const LOOP_TICK: Duration = Duration::from_secs(20);

pub fn set_enabled(enabled: bool) {
    AUTO_UPDATE.store(enabled, Ordering::SeqCst);
    if enabled { WAKE.store(true, Ordering::SeqCst); }
}

pub fn is_enabled() -> bool {
    AUTO_UPDATE.load(Ordering::SeqCst)
}

/// Checks for an update and, when one exists, downloads, installs and restarts
/// the app (restart exits the process, so the return only happens on failure paths).
pub async fn check_and_install(app: &AppHandle) -> Result<bool, String> {
    let updater = app.updater().map_err(|error| format!("The updater is unavailable: {error}"))?;
    let update = updater.check().await.map_err(|error| error.to_string())?;
    let Some(update) = update else { return Ok(false); };
    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|error| format!("Could not install the update: {error}"))?;
    app.restart();
    #[allow(unreachable_code)]
    Ok(true)
}

/// Polls for updates for as long as WeaveCatcher runs so a new version installs
/// the moment it ships, not just on the next launch.
pub fn spawn_worker(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(STARTUP_DELAY);
        let mut last_check: Option<Instant> = None;
        loop {
            let wake = WAKE.swap(false, Ordering::SeqCst);
            let due = last_check.is_none_or(|at| at.elapsed() >= POLL_INTERVAL);
            if is_enabled() && (due || wake) {
                last_check = Some(Instant::now());
                if let Err(error) = tauri::async_runtime::block_on(check_and_install(&app)) {
                    // The endpoint can be briefly unreachable; the next poll retries.
                    eprintln!("Auto-update check failed: {error}");
                }
            }
            std::thread::sleep(LOOP_TICK);
        }
    });
}
