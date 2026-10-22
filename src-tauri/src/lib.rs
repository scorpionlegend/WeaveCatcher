pub mod commands;
pub mod document;
pub mod export;
pub mod ipc;
pub mod undo;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ipc::AppState::default())
        .invoke_handler(tauri::generate_handler![
            ipc::get_document,
            ipc::new_project,
            ipc::mutate_document,
            ipc::undo_document,
            ipc::redo_document,
            ipc::copy_element,
            ipc::paste_element,
            ipc::load_project,
            ipc::save_project,
            ipc::export_project,
            ipc::get_export_preview
        ])
        .run(tauri::generate_context!())
        .expect("failed to run VisionWeave");
}
