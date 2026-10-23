use serde::{Deserialize, Serialize};
use tauri::{
    Manager, Runtime,
    plugin::{Builder, TauriPlugin},
};

#[derive(Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub path: String,
    pub name: String,
    pub relative_path: String,
    pub format: String,
    pub size: u64,
    pub modified: Option<u64>,
}

#[derive(Default, Serialize, Deserialize)]
pub struct Scan {
    pub books: Vec<Book>,
    pub warnings: Vec<String>,
}

#[cfg(target_os = "android")]
struct Mobile<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[tauri::command]
async fn folders<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Vec<Folder>, String> {
    #[cfg(target_os = "android")]
    return app
        .state::<Mobile<R>>()
        .0
        .run_mobile_plugin("folders", ())
        .map_err(|e| e.to_string());
    #[cfg(not(target_os = "android"))]
    desktop::load(&app)
}

#[tauri::command]
async fn pick_folder<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Option<Folder>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "android")]
        return app
            .state::<Mobile<R>>()
            .0
            .run_mobile_plugin("pickFolder", ())
            .map_err(|e| e.to_string());
        #[cfg(not(target_os = "android"))]
        desktop::pick(&app)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scan_folder<R: Runtime>(app: tauri::AppHandle<R>, id: String) -> Result<Scan, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "android")]
        return app
            .state::<Mobile<R>>()
            .0
            .run_mobile_plugin("scanFolder", serde_json::json!({"id": id}))
            .map_err(|e| e.to_string());
        #[cfg(not(target_os = "android"))]
        desktop::scan(&app, &id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn remove_folder<R: Runtime>(app: tauri::AppHandle<R>, id: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return app
        .state::<Mobile<R>>()
        .0
        .run_mobile_plugin("removeFolder", serde_json::json!({"id": id}))
        .map_err(|e| e.to_string());
    #[cfg(not(target_os = "android"))]
    desktop::remove(&app, &id)
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("library")
        .invoke_handler(tauri::generate_handler![
            folders,
            pick_folder,
            scan_folder,
            remove_folder
        ])
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            app.manage(Mobile(_api.register_android_plugin(
                "com.universalreader.library",
                "LibraryPlugin",
            )?));
            #[cfg(not(target_os = "android"))]
            app.manage(desktop::LibraryLock::default());
            Ok(())
        })
        .build()
}

#[cfg(not(target_os = "android"))]
mod desktop;
