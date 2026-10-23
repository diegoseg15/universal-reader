fn main() {
    tauri_plugin::Builder::new(&["folders", "pick_folder", "scan_folder", "remove_folder"])
        .android_path("android")
        .build();
}
