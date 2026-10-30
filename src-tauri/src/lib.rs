pub mod commands;
pub mod document;
pub mod export;
pub mod ipc;
pub mod undo;
pub mod updater;

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
        .manage(ipc::HelpTopic(std::sync::Mutex::new("tour".to_string())))
        .setup(|app| {
            let handle = app.handle().clone();
            updater::set_enabled(ipc::read_setting(&handle, "autoUpdate").and_then(|value| value.as_bool()).unwrap_or(false));
            updater::spawn_worker(handle);
            Ok(())
        })
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
            ipc::open_help_window,
            ipc::get_help_topic,
            ipc::open_project_folder,
            ipc::open_release_notes_window,
            ipc::read_workspace_file,
            ipc::write_workspace_file,
            ipc::list_quick_locations,
            ipc::open_in_system,
            ipc::load_app_settings,
            ipc::save_app_setting,
            ipc::set_auto_update
        ])
        .run(tauri::generate_context!())
        .expect("failed to run WeaveCatcher");
}
