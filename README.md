# Universal Reader

A cross-platform, offline-first digital library and universal reader for books, comics, manga, and documents.

Built with **Tauri 2, React, TypeScript, and Rust**, with an emphasis on performance, privacy, maintainability, and a consistent reading experience.

## Current Status

**Early development — Technical validation**

Completed validations:
- Windows 11 and Android application execution.
- Native document selection.
- Read-only file access.
- Partial file reading and random access.
- Basic PDF format identification.

## Planned Features

- Universal reader for PDF, EPUB, CBZ, and CBR.
- Local digital library management.
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