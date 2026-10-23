use super::{Book, Folder, Scan};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;

#[derive(Default)]
pub struct LibraryLock(Mutex<()>);

fn config<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("library-folders.json"))
}

pub fn load<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<Folder>, String> {
    match fs::read(config(app)?) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| format!("No se pudo leer la biblioteca: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(e.to_string()),
    }
}

fn save<R: Runtime>(app: &AppHandle<R>, folders: &[Folder]) -> Result<(), String> {
    let path = config(app)?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let temporary = path.with_extension("json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec(folders).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temporary, path).map_err(|e| e.to_string())
}

pub fn pick<R: Runtime>(app: &AppHandle<R>) -> Result<Option<Folder>, String> {
    let Some(selected) = app
        .dialog()
        .file()
        .set_title("Añadir colección a la biblioteca")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|e| e.to_string())?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let folder = Folder {
        id: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .unwrap_or(path.as_os_str())
            .to_string_lossy()
            .into_owned(),
    };
    let state = app.state::<LibraryLock>();
    let _guard = state.0.lock().map_err(|e| e.to_string())?;
    let mut folders = load(app)?;
    if !folders.iter().any(|f| f.id == folder.id) {
        folders.push(folder.clone());
        save(app, &folders)?;
    }
    Ok(Some(folder))
}

pub fn remove<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<(), String> {
    let state = app.state::<LibraryLock>();
    let _guard = state.0.lock().map_err(|e| e.to_string())?;
    let mut folders = load(app)?;
    folders.retain(|f| f.id != id);
    save(app, &folders)
}

fn supported(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    matches!(
        extension.as_str(),
        "pdf"
            | "epub"
            | "cbz"
            | "cbr"
            | "cb7"
            | "cbt"
            | "mobi"
            | "azw"
            | "azw3"
            | "fb2"
            | "djvu"
            | "txt"
    )
    .then_some(extension)
}

pub fn scan<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<Scan, String> {
    if !load(app)?.iter().any(|f| f.id == id) {
        return Err("La carpeta no pertenece a la biblioteca.".into());
    }
    let root = PathBuf::from(id)
        .canonicalize()
        .map_err(|e| format!("Carpeta no disponible: {e}"))?;
    app.fs_scope()
        .allow_directory(&root, true)
        .map_err(|e| e.to_string())?;
    scan_tree(&root)
}

fn scan_tree(root: &Path) -> Result<Scan, String> {
    let mut result = Scan::default();
    let mut stack = vec![(root.to_path_buf(), 0)];
    let mut visited = 0;
    while let Some((directory, depth)) = stack.pop() {
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(e) if directory == root => return Err(format!("No se pudo leer la carpeta: {e}")),
            Err(_) => {
                result.warnings.push(format!(
                    "No se pudo leer {}",
                    directory.strip_prefix(root).unwrap_or(&directory).display()
                ));
                continue;
            }
        };
        for entry in entries {
            visited += 1;
            if visited > 100_000 || result.books.len() >= 25_000 {
                result.warnings.push("Se alcanzó el límite de exploración. Añade subcarpetas por separado para ver más archivos.".into());
                return Ok(result);
            }
            let entry = match entry {
                Ok(e) => e,
                Err(_) => {
                    result
                        .warnings
                        .push("No se pudo leer una entrada de la carpeta.".into());
                    continue;
                }
            };
            let kind = match entry.file_type() {
                Ok(k) => k,
                Err(_) => {
                    result.warnings.push(format!(
                        "No se pudo consultar {}",
                        entry.file_name().to_string_lossy()
                    ));
                    continue;
                }
            };
            if kind.is_symlink() {
                continue;
            }
            let path = entry.path();
            if kind.is_dir() {
                if depth < 64 {
                    stack.push((path, depth + 1));
                } else {
                    result.warnings.push(
                        "Se omitió una carpeta con demasiados niveles de profundidad.".into(),
                    );
                }
            } else if kind.is_file() {
                if let Some(format) = supported(&path) {
                    let metadata = entry.metadata().ok();
                    result.books.push(Book {
                        size: metadata.as_ref().map(|m| m.len()).unwrap_or(0),
                        modified: metadata
                            .and_then(|m| m.modified().ok())
                            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|duration| duration.as_millis() as u64),
                        name: entry.file_name().to_string_lossy().into_owned(),
                        relative_path: path
                            .strip_prefix(root)
                            .unwrap_or(&path)
                            .to_string_lossy()
                            .into_owned(),
                        path: path.to_string_lossy().into_owned(),
                        format,
                    });
                }
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn indexes_nested_supported_files_and_skips_other_formats() {
        let root =
            std::env::temp_dir().join(format!("universal-reader-test-{}", std::process::id()));
        fs::create_dir_all(root.join("manga")).unwrap();
        fs::write(root.join("book.EPUB"), b"sample").unwrap();
        fs::write(root.join("manga/volume.cbz"), b"sample").unwrap();
        fs::write(root.join("unrelated.exe"), b"sample").unwrap();
        let scan = scan_tree(&root).unwrap();
        assert_eq!(scan.books.len(), 2);
        assert!(
            scan.books
                .iter()
                .any(|b| b.format == "cbz" && b.relative_path.contains("manga"))
        );
        assert!(scan.books.iter().any(|b| b.format == "epub"));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn reports_missing_root() {
        assert!(
            scan_tree(&std::env::temp_dir().join("universal-reader-missing-folder-test")).is_err()
        );
    }
}
