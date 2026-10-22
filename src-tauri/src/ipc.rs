use crate::{commands::{self, EditIntent}, document::{Document, Element}, export, undo::History};
use std::{fs, path::PathBuf, sync::Mutex};
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
