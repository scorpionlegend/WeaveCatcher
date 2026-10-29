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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Saves every window's size and position on exit and restores it on the next launch.
        .plugin(tauri_plugin_window_state::Builder::default().build())
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
            ipc::get_export_preview,
            ipc::open_settings_window,
            ipc::open_project_folder,
            ipc::open_release_notes_window,
            ipc::read_workspace_file,
            ipc::write_workspace_file,
            ipc::list_quick_locations,
            ipc::open_in_system,
            ipc::load_app_settings,
            ipc::save_app_setting
        ])
        .run(tauri::generate_context!())
        .expect("failed to run WeaveCatcher");
}
