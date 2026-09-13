mod commands;
mod db;
mod models;

use db::Db;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let conn = db::init(&app.handle());
            app.manage(Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_bundle,
            commands::list_bundles,
            commands::rename_bundle,
            commands::set_bundle_archived,
            commands::delete_bundle,
            commands::create_note,
            commands::list_notes,
            commands::get_note,
            commands::update_note,
            commands::delete_note,
            commands::search_notes,
            commands::create_tag,
            commands::list_tags,
            commands::delete_tag,
            commands::assign_tag,
            commands::remove_tag,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
