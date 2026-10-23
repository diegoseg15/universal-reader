# Universal Reader

A cross-platform, offline-first digital library and universal reader for books, comics, manga, and documents.

Built with **Tauri 2, React, TypeScript, and Rust**, with an emphasis on performance, privacy, maintainability, and a consistent reading experience.

## Current Status

**Early development — Local library and PDF/EPUB readers**

Current features:
- Add multiple library folders, including subfolders, and remember them across app restarts.
- Browse books, comics, manga archives, and documents with filename search, folder selection, and type/format filters.
- Refresh folders and remove them from the library without deleting their files.
- Read PDF and EPUB files directly from the library or the native file picker.
- PDF text search, zoom, page navigation, and EPUB table of contents, appearance settings, and saved reading progress.
- Responsive dark library and reader controls for desktop and mobile.

Library scanning recognizes PDF, EPUB, CBZ, CBR, CB7, CBT, MOBI, AZW, AZW3, FB2, DJVU, and TXT. **Only PDF and EPUB can currently be read**; other formats are cataloged and clearly marked as unavailable for reading. The library preserves the directory hierarchy with folder previews and breadcrumbs. Book cards extract real PDF first-page thumbnails, embedded ebook covers (EPUB, MOBI/AZW/AZW3, FB2), and the first image in comic archives (CBZ/CBR/CB7/CBT). Files without a readable cover show an explicit placeholder. Thumbnails load on demand with two concurrent jobs and a bounded IndexedDB cache; file size and modification time invalidate changed files. RAR/7z/TAR extraction runs one archive at a time and is limited to 64 MiB per archive, with a 30-second extraction timeout. Cover images are limited to 16 MiB. PDF and ZIP-based books use range reads instead of loading the entire book. Categories follow the nearest recognized folder name (Libros/Books, Comics/Historietas, Manga/Mangas, or Documentos/Documents), including independently selected root folders. Without a category folder, file extensions provide a fallback. Comics and Manga have separate filters. Folder previews show complete, upright covers in a mosaic and sample different child folders before taking more books from the same branch; folder and file counts describe mixed collections.

The local `src-tauri/plugins/library` plugin uses the desktop folder picker and Android's Storage Access Framework with persistent read access. Android sources live in the plugin, outside the generated Android project. Folder access still depends on the selected storage provider and system restrictions. A scan reports unreadable subfolders and stops at 25,000 matching files, 100,000 entries, or 64 subfolder levels. Desktop symlinks are skipped.

Completed validations:
- Windows 11 and Android application execution.
- Native document selection.
- Read-only file access.
- Partial file reading and random access.
- Basic PDF format identification.

## Planned Features

- Universal reader for PDF, EPUB, CBZ, and CBR.
- Automatic metadata retrieval and manual editing.
- Bookmarks and persistent reading progress.
- Customizable reading preferences.
- Offline-first operation.
- Optional remote storage and cross-device synchronization.

## Technology Stack

- **Desktop & Mobile:** Tauri 2
- **Frontend:** React, TypeScript, Vite
- **Native Integration:** Rust
- **Package Manager:** pnpm
- **Local Database:** SQLite (planned)

## Development

Install dependencies:

```bash
pnpm install
```

Run library hierarchy tests:

```bash
pnpm test:library
cargo test --manifest-path src-tauri/plugins/library/Cargo.toml
```

Run on desktop:

```bash
pnpm tauri dev
```

Run on Android using USB debugging:

```bash
pnpm tauri android init
pnpm tauri android dev --host 127.0.0.1
```

Android development requires the Android SDK, NDK, and the corresponding Rust targets.

## Project Status

This project is under active development. The public API, supported features, and architecture may evolve as technical validations are completed.
