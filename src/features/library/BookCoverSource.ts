import { open, SeekMode, type FileHandle } from "@tauri-apps/plugin-fs";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { NativeFileBlob, NativeRangeSource } from "../reader/epub/EpubSource";
import { LocalPDFTransport, readRange } from "../reader/pdf/PdfRangeSource";
import type { LibraryBook } from "./LibrarySource";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export const COVER_FORMATS = new Set(["pdf", "epub", "cbz", "cbr", "cb7", "cbt", "mobi", "azw", "azw3", "fb2"]);
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

function checkSignal(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Solicitud cancelada", "AbortError");
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("No se pudo generar la miniatura.")),
    "image/webp", 0.82,
  ));
}

async function thumbnail(blob: Blob): Promise<Blob | null> {
  if (!blob.size || blob.size > MAX_IMAGE_BYTES) return null;
  // Decode only raster cover images. No document markup is rendered in the library.
  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const raster = (header[0] === 0xff && header[1] === 0xd8)
    || (header[0] === 0x89 && header[1] === 0x50)
    || (header[0] === 0x47 && header[1] === 0x49)
    || (header[0] === 0x52 && header[8] === 0x57);
  if (!raster) return null;
  const image = await createImageBitmap(blob);
  try {
    const scale = Math.min(256 / image.width, 384 / image.height, 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await canvasBlob(canvas);
  } finally { image.close(); }
}

async function pdfCover(file: FileHandle, size: number, signal: AbortSignal): Promise<Blob> {
  let failure: unknown;
  const transport = new LocalPDFTransport(size, (begin, end) => readRange(file, begin, end), (error) => {
    failure = error;
    void task.destroy().catch(() => {});
  });
  const task = getDocument({
    range: transport, disableStream: true, disableAutoFetch: true,
    rangeChunkSize: 64 * 1024,
    maxImageSize: 16 * 1024 * 1024,
    wasmUrl: new URL("pdfjs-wasm/", new URL(import.meta.env.BASE_URL, location.origin)).href,
  });
  // A password-protected book must not stall the thumbnail queue.
  task.onPassword = () => { void task.destroy().catch(() => {}); };
  const abort = () => { transport.abort(); void task.destroy().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    checkSignal(signal);
    const pdf = await task.promise;
    if (failure) throw failure;
    const page = await pdf.getPage(1);
    const original = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(256 / original.width, 384 / original.height) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    checkSignal(signal);
    return await canvasBlob(canvas);
  } finally {
    signal.removeEventListener("abort", abort);
    transport.abort();
    try { await task.destroy(); } finally { await transport.waitForIdle(); }
  }
}

// RAR/7z/TAR need a real Blob transferable to their worker. Serialize these jobs
// and cap their input size so several large archives cannot fill mobile memory.
let archiveQueue: Promise<unknown> = Promise.resolve();
async function archiveCover(source: Blob, name: string, signal: AbortSignal): Promise<Blob | null> {
  const job = archiveQueue.then(async () => {
    checkSignal(signal);
    if (source.size > MAX_ARCHIVE_BYTES) return null;
    const { Archive } = await import("libarchive.js");
    const chunks: ArrayBuffer[] = [];
    for (let offset = 0; offset < source.size; offset += 4 * 1024 * 1024) {
      checkSignal(signal);
      chunks.push(await source.slice(offset, offset + 4 * 1024 * 1024).arrayBuffer());
    }
    const worker = new Worker(new URL("libarchive/worker-bundle.js", new URL(import.meta.env.BASE_URL, location.origin)), { type: "module" });
    Archive.init({ getWorker: () => worker });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectJob: (reason: unknown) => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      rejectJob = reject;
      timer = setTimeout(() => reject(new Error("La extracción de portada tardó demasiado.")), 30_000);
    });
    const abort = () => rejectJob(new DOMException("Solicitud cancelada", "AbortError"));
    const workerError = (event: ErrorEvent) => rejectJob(new Error(event.message || "No se pudo iniciar el extractor de portadas."));
    worker.addEventListener("error", workerError);
    signal.addEventListener("abort", abort, { once: true });
    try {
      const extract = async () => {
        const archive = await Archive.open(new File(chunks, name));
        const entries = await archive.getFilesArray() as { path: string; file: { name: string; size: number; extract: () => Promise<File> } }[];
        const images = entries.filter(({ path, file }) => file && typeof file.name === "string"
          && !`${path}${file.name}`.includes("__MACOSX/")
          && /\.(jpe?g|png|webp|gif)$/i.test(file.name)
          && file.size > 0 && file.size <= MAX_IMAGE_BYTES)
          .sort((a, b) => `${a.path}${a.file.name}`.localeCompare(`${b.path}${b.file.name}`, "en", { numeric: true }));
        checkSignal(signal);
        return images[0] ? thumbnail(await images[0].file.extract()) : null;
      };
      return await Promise.race([extract(), cancelled]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.removeEventListener("error", workerError);
      worker.terminate();
    }
  });
  archiveQueue = job.catch(() => {});
  return job;
}

/** Also used by browser verification with real fixture files. */
export async function extractBookCover(source: Blob, book: LibraryBook, signal: AbortSignal): Promise<Blob | null> {
  checkSignal(signal);
  if (["cbr", "cb7", "cbt"].includes(book.format)) return archiveCover(source, book.name, signal);
  const { makeBook } = await import("foliate-js/view.js");
  const parsed = await makeBook(source);
  try {
    const cover = await parsed.getCover?.();
    checkSignal(signal);
    return cover ? await thumbnail(cover) : null;
  } finally { parsed.destroy?.(); }
}

let database: Promise<IDBDatabase | null> | undefined;
function coverDatabase(): Promise<IDBDatabase | null> {
  database ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open("universal-reader-covers", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("covers", { keyPath: "key" }).createIndex("created", "created");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return database;
}

async function cachedCover(key: string): Promise<Blob | null> {
  try {
    const db = await coverDatabase();
    if (!db) return null;
    return await new Promise((resolve) => {
      const request = db.transaction("covers").objectStore("covers").get(key);
      request.onsuccess = () => resolve(request.result?.blob ?? null);
      request.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function saveCover(key: string, blob: Blob): Promise<void> {
  try {
    const db = await coverDatabase();
    if (!db) return;
    const store = db.transaction("covers", "readwrite").objectStore("covers");
    store.put({ key, blob, created: Date.now() });
    const count = store.count();
    count.onsuccess = () => {
      let excess = count.result - 300;
      if (excess <= 0) return;
      const cursor = store.index("created").openCursor();
      cursor.onsuccess = () => {
        if (cursor.result && excess-- > 0) { cursor.result.delete(); cursor.result.continue(); }
      };
    };
  } catch { /* A full/unavailable cache must not prevent reading. */ }
}

export async function loadNativeCover(book: LibraryBook, signal: AbortSignal, openFile: typeof open = open): Promise<Blob | null> {
  if (!COVER_FORMATS.has(book.format)) return null;
  const key = JSON.stringify(["v1", book.path, book.size, book.modified]);
  const cached = await cachedCover(key);
  checkSignal(signal);
  if (cached) return cached;
  const file = await openFile(book.path, { read: true });
  let source: NativeRangeSource | undefined;
  try {
    const size = await file.seek(0, SeekMode.End);
    checkSignal(signal);
    if (!Number.isSafeInteger(size) || size <= 0) return null;
    let cover: Blob | null;
    if (book.format === "pdf") cover = await pdfCover(file, size, signal);
    else {
      source = new NativeRangeSource(file, size);
      const blob = new NativeFileBlob(source, 0, size, book.name.toLowerCase());
      cover = await extractBookCover(blob, book, signal);
    }
    checkSignal(signal);
    if (cover) void saveCover(key, cover);
    return cover;
  } finally {
    try { await source?.waitForIdle(); } finally { await file.close(); }
  }
}
