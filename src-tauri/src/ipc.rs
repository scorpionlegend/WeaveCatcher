use crate::{commands::{self, EditIntent}, document::{Document, Element}, export, undo::History};
use serde::Serialize;
use std::{fs, path::{Path, PathBuf}, sync::Mutex};
use tauri::State;

pub struct EditorState {
    pub document: Document,
    pub history: History,
    pub project_path: Option<PathBuf>,
    pub clipboard: Option<Element>,
}

pub struct AppState(pub Mutex<EditorState>);

impl Default for AppState {
    fn default() -> Self { Self(Mutex::new(EditorState { document: Document::default(), history: History::default(), project_path: None, clipboard: None })) }
}

fn lock_state(state: &AppState) -> Result<std::sync::MutexGuard<'_, EditorState>, String> {
    state.0.lock().map_err(|_| "The editor state is unavailable.".to_string())
}

#[tauri::command]
pub fn get_document(state: State<'_, AppState>) -> Result<Document, String> {
    Ok(lock_state(&state)?.document.clone())
}

#[tauri::command]
pub fn new_project(state: State<'_, AppState>) -> Result<Document, String> {
    let mut editor = lock_state(&state)?;
    editor.document = Document::default();
    editor.history = History::default();
    editor.project_path = None;
    editor.clipboard = None;
    Ok(editor.document.clone())
}

#[tauri::command]
pub fn mutate_document(state: State<'_, AppState>, intent: EditIntent) -> Result<Document, String> {
    let mut editor = lock_state(&state)?;
    let before = editor.document.clone();
    let mut next = before.clone();
    commands::apply(&mut next, intent)?;
    if next != before {
        editor.history.record(before);
        editor.document = next;
    }
    Ok(editor.document.clone())
}

#[tauri::command]
pub fn undo_document(state: State<'_, AppState>) -> Result<Document, String> {
    let mut editor = lock_state(&state)?;
    let current = editor.document.clone();
    if let Some(previous) = editor.history.undo(current) { editor.document = previous; }
    Ok(editor.document.clone())
}

#[tauri::command]
pub fn redo_document(state: State<'_, AppState>) -> Result<Document, String> {
    let mut editor = lock_state(&state)?;
    let current = editor.document.clone();
    if let Some(next) = editor.history.redo(current) { editor.document = next; }
    Ok(editor.document.clone())
}

#[tauri::command]
pub fn copy_element(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut editor = lock_state(&state)?;
    let page = commands::active_page(&editor.document)?;
    editor.clipboard = Some(commands::find_element(&page.elements, &id).ok_or_else(|| "Element not found.".to_string())?.clone());
    Ok(())
}

#[tauri::command]
pub fn paste_element(state: State<'_, AppState>, parent_id: Option<String>) -> Result<Document, String> {
    let mut editor = lock_state(&state)?;
    let element = editor.clipboard.clone().ok_or_else(|| "Copy an element before pasting.".to_string())?;
    let before = editor.document.clone();
    let mut next = before.clone();
    commands::apply(&mut next, EditIntent::PasteElement { element, parent_id, index: None })?;
    editor.history.record(before);
    editor.document = next;
    Ok(editor.document.clone())
}

#[tauri::command]
pub fn load_project(state: State<'_, AppState>, path: String) -> Result<Document, String> {
    let source = fs::read_to_string(&path).map_err(|error| format!("Could not read project: {error}"))?;
    let mut document: Document = serde_json::from_str(&source).map_err(|error| format!("This project file is not valid: {error}"))?;
    if document.pages.is_empty() { return Err("This project does not contain a page.".into()); }
    if !document.pages.iter().any(|page| page.id == document.active_page_id) { document.active_page_id = document.pages[0].id.clone(); }
    let mut editor = lock_state(&state)?;
    editor.document = document.clone();
    editor.history = History::default();
    editor.project_path = Some(PathBuf::from(path));
    Ok(document)
}

#[tauri::command]
pub fn save_project(state: State<'_, AppState>, path: Option<String>) -> Result<String, String> {
    let mut editor = lock_state(&state)?;
    let destination = path.map(PathBuf::from).or_else(|| editor.project_path.clone()).ok_or_else(|| "Choose a project file location first.".to_string())?;
    let data = serde_json::to_string_pretty(&editor.document).map_err(|error| format!("Could not encode project: {error}"))?;
    fs::write(&destination, data).map_err(|error| format!("Could not save project: {error}"))?;
    editor.project_path = Some(destination.clone());
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn export_project(state: State<'_, AppState>, folder: String) -> Result<(), String> {
    let editor = lock_state(&state)?;
    export::write_project(&editor.document, &PathBuf::from(folder))
}

#[tauri::command]
pub fn get_export_preview(state: State<'_, AppState>) -> Result<export::ExportBundle, String> {
    let editor = lock_state(&state)?;
    export::preview(&editor.document)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub children: Vec<FileEntry>,
}

const SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", "dist", "__pycache__", ".zcode", ".idea", ".vscode"];
const MAX_SCAN_DEPTH: usize = 5;

fn scan_dir(root: &Path, relative: &str, depth: usize) -> Vec<FileEntry> {
    let mut entries = Vec::new();
    let Ok(read) = fs::read_dir(root) else { return entries; };
    for item in read.flatten() {
        let Ok(file_type) = item.file_type() else { continue; };
        let name = item.file_name().to_string_lossy().into_owned();
        let path = if relative.is_empty() { name.clone() } else { format!("{relative}/{name}") };
        if file_type.is_dir() {
            if SKIP_DIRS.contains(&name.as_str()) { continue; }
            let children = if depth < MAX_SCAN_DEPTH { scan_dir(&item.path(), &path, depth + 1) } else { Vec::new() };
            entries.push(FileEntry { name, path, is_dir: true, size: 0, children });
        } else {
            let size = item.metadata().map(|meta| meta.len()).unwrap_or(0);
            entries.push(FileEntry { name, path, is_dir: false, size, children: Vec::new() });
        }
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    entries
}

#[tauri::command]
pub fn open_project_folder(path: String) -> Result<Vec<FileEntry>, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() { return Err("That path is not a folder.".into()); }
    Ok(scan_dir(&root, "", 0))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickLocation { pub name: String, pub path: String }

/// Entry points for the Files panel's root picker: known user folders plus existing drives.
#[tauri::command]
pub fn list_quick_locations() -> Vec<QuickLocation> {
    let mut locations = Vec::new();
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).map(PathBuf::from).ok();
    if let Some(home) = home {
        for (name, folder) in [("Desktop", "Desktop"), ("Documents", "Documents"), ("Downloads", "Downloads")] {
            let path = home.join(folder);
            if path.is_dir() { locations.push(QuickLocation { name: name.into(), path: path.to_string_lossy().into_owned() }); }
        }
    }
    for letter in b'C'..=b'Z' {
        let drive = format!("{}:\\", letter as char);
        if PathBuf::from(&drive).is_dir() { locations.push(QuickLocation { name: format!("Local Disk ({}:)", letter as char), path: drive }); }
    }
    locations
}

const MAX_EDITABLE_BYTES: usize = 5_000_000;

/// Resolves a tree-relative path and refuses anything that escapes the opened folder.
fn resolve_in_root(root: &str, relative: &str) -> Result<PathBuf, String> {
    let root_path = PathBuf::from(root).canonicalize().map_err(|error| format!("Could not resolve the opened folder: {error}"))?;
    let target = root_path.join(relative.replace('/', "\\"));
    let canonical = target.canonicalize().map_err(|error| format!("Could not resolve that file: {error}"))?;
    if !canonical.starts_with(&root_path) { return Err("That file is outside the opened folder.".into()); }
    Ok(canonical)
}

#[tauri::command]
pub fn read_workspace_file(root: String, relative: String) -> Result<String, String> {
    let path = resolve_in_root(&root, &relative)?;
    let bytes = fs::read(&path).map_err(|error| format!("Could not read that file: {error}"))?;
    if bytes.len() > MAX_EDITABLE_BYTES { return Err("This file is too large to edit here (over 5 MB).".into()); }
    // Windows text files are often ANSI-encoded; decode lossily so they still open for editing.
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
pub fn write_workspace_file(root: String, relative: String, content: String) -> Result<(), String> {
    let path = resolve_in_root(&root, &relative)?;
    fs::write(&path, content).map_err(|error| format!("Could not save that file: {error}"))
}

/// Opens a local path with the system default app from the Rust side — the opener
/// plugin's webview-side `openPath` is blocked by its ACL scope for arbitrary paths.
#[tauri::command]
pub fn open_in_system(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(path, None::<&str>).map_err(|error| format!("Could not open that path: {error}"))
}

type SettingsMap = std::collections::BTreeMap<String, serde_json::Value>;

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = app.path().app_config_dir().map_err(|error| format!("Could not locate the config directory: {error}"))?;
    fs::create_dir_all(&dir).map_err(|error| format!("Could not create the config directory: {error}"))?;
    Ok(dir.join("settings.json"))
}

fn read_settings_file(app: &tauri::AppHandle) -> Result<SettingsMap, String> {
    let path = settings_path(app)?;
    if !path.exists() { return Ok(SettingsMap::new()); }
    let data = fs::read_to_string(&path).map_err(|error| format!("Could not read the settings file: {error}"))?;
    serde_json::from_str(&data).map_err(|error| format!("The settings file is not valid: {error}"))
}

fn write_settings_file(app: &tauri::AppHandle, settings: &SettingsMap) -> Result<(), String> {
    let data = serde_json::to_string_pretty(settings).map_err(|error| format!("Could not encode settings: {error}"))?;
    fs::write(settings_path(app)?, data).map_err(|error| format!("Could not save settings: {error}"))
}

#[tauri::command]
pub fn load_app_settings(app: tauri::AppHandle) -> Result<SettingsMap, String> {
    read_settings_file(&app)
}

/// Read-side helper for the Rust side (updater worker init at startup).
pub fn read_setting(app: &tauri::AppHandle, key: &str) -> Option<serde_json::Value> {
    read_settings_file(app).ok()?.get(key).cloned()
}

#[tauri::command]
pub fn set_auto_update(enabled: bool) {
    crate::updater::set_enabled(enabled);
}

#[tauri::command]
pub fn save_app_setting(app: tauri::AppHandle, key: String, value: serde_json::Value) -> Result<(), String> {
    let mut settings = read_settings_file(&app)?;
    settings.insert(key, value);
    write_settings_file(&app, &settings)
}

/// The tutorial the help window should show; written by `open_help_window` before the
/// window exists (read on load) or emitted to the running window when it's already open.
pub struct HelpTopic(pub Mutex<String>);

/// Async so the window builds off the main thread — a sync command that builds a
/// window deadlocks the Windows event loop (blank window, nothing closable).
#[tauri::command]
pub async fn open_help_window(app: tauri::AppHandle, topic: String) -> Result<(), String> {
    use tauri::{Emitter, Manager};
    *app.state::<HelpTopic>().0.lock().map_err(|_| "Help state unavailable.".to_string())? = topic.clone();
    if let Some(existing) = app.get_webview_window("help") {
        let _ = existing.set_focus();
        let _ = existing.emit_to("help", "help-topic", topic);
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(&app, "help", tauri::WebviewUrl::App("index.html".into()))
        .title("WeaveCatcher Help")
        .inner_size(780.0, 640.0)
        .min_inner_size(560.0, 480.0)
        .build()
        .map_err(|error| format!("Could not open the help window: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_help_topic(state: tauri::State<'_, HelpTopic>) -> Result<String, String> {
    state.0.lock().map(|topic| topic.clone()).map_err(|_| "Help state unavailable.".into())
}

/// Async so the window builds off the main thread — a sync command that builds a
/// window deadlocks the Windows event loop (blank window, nothing closable).
#[tauri::command]
pub async fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(existing) = app.get_webview_window("settings") {
        let _ = existing.set_focus();
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(&app, "settings", tauri::WebviewUrl::App("index.html".into()))
        .title("WeaveCatcher Settings")
        .inner_size(480.0, 640.0)
        .min_inner_size(380.0, 480.0)
        .build()
        .map_err(|error| format!("Could not open the settings window: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn open_release_notes_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(existing) = app.get_webview_window("release") {
        let _ = existing.set_focus();
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(&app, "release", tauri::WebviewUrl::App("index.html".into()))
        .title("What's new — WeaveCatcher")
        .inner_size(460.0, 580.0)
        .min_inner_size(380.0, 420.0)
        .build()
        .map_err(|error| format!("Could not open the release notes window: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_and_writes_files_inside_root() {
        let root = std::env::temp_dir().join(format!("vw-test-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("page.html"), "<p>hello</p>").unwrap();
        let root_str = root.to_string_lossy().to_string();
        let content = read_workspace_file(root_str.clone(), "page.html".into()).unwrap();
        assert_eq!(content, "<p>hello</p>");
        write_workspace_file(root_str.clone(), "page.html".into(), "<p>changed</p>".into()).unwrap();
        assert_eq!(fs::read_to_string(root.join("page.html")).unwrap(), "<p>changed</p>");
        assert!(read_workspace_file(root_str, "../escape.html".into()).is_err());
        fs::remove_dir_all(&root).unwrap();
    }
}
