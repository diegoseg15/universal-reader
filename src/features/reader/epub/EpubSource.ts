import { SeekMode, type FileHandle } from "@tauri-apps/plugin-fs";

import type { FoliateBook } from "foliate-js/view.js";

export type EpubSummary = {
  title: string;
  author: string;
  sectionCount: number;
  tocCount: number;
  fileName: string;
};

export type EpubTextBlock = {
  kind: "heading" | "paragraph";
  text: string;
};

export type EpubSectionContent = {
  blocks: EpubTextBlock[];
  recoveredFromHtml?: boolean;
  coverUrl?: string;
};

export type EpubSession = {
  summary: EpubSummary;
  readSection: (index: number) => Promise<EpubSectionContent>;
  close: () => Promise<void>;
};

const MAX_EPUB_BYTES = 128 * 1024 * 1024;
const MAX_RANGE_BYTES = 16 * 1024 * 1024;

class NativeRangeSource {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: FileHandle,
    readonly size: number,
  ) {}

  read(begin: number, end: number): Promise<Uint8Array> {
    if (
      !Number.isSafeInteger(begin) ||
      !Number.isSafeInteger(end) ||
      begin < 0 ||
      end < begin ||
      end > this.size ||
      end - begin > MAX_RANGE_BYTES
    ) {
      return Promise.reject(
        new Error("Rango de lectura EPUB inválido o demasiado grande."),
      );
    }

    const request = this.queue.then(async () => {
      const result = new Uint8Array(end - begin);

      if (result.length === 0) {
        return result;
      }

      await this.file.seek(begin, SeekMode.Start);

      let offset = 0;

      while (offset < result.length) {
        const count = await this.file.read(result.subarray(offset));

        if (count === null || count <= 0) {
          throw new Error(
            `Lectura EPUB incompleta en el byte ${begin + offset}.`,
          );
        }

        offset += count;
      }

      return result;
    });

    this.queue = request.then(
      () => undefined,
      () => undefined,
    );

    return request;
  }

  async waitForIdle(): Promise<void> {
    await this.queue;
  }
}

function clampSliceIndex(index: number, size: number): number {
  if (Number.isNaN(index)) return 0;

  if (index === Infinity) return size;
  if (index === -Infinity) return 0;

  const integer = Math.trunc(index);

  return integer < 0 ? Math.max(size + integer, 0) : Math.min(integer, size);
}

/**
 * Minimal virtual Blob backed by a native file handle.
 *
 * Foliate's ZIP BlobReader uses:
 * - blob.size
 * - blob.slice(start, end)
 * - blob.arrayBuffer()
 *
 * It does not require loading the entire book up front.
 */
class NativeFileBlob extends Blob {
  readonly name: string;

  constructor(
    private readonly source: NativeRangeSource,
    private readonly begin: number,
    private readonly end: number,
    name: string,
  ) {
    super([]);
    this.name = name;
  }

  override get size(): number {
    return this.end - this.begin;
  }

  override slice(start = 0, end = this.size, _contentType?: string): Blob {
    const relativeBegin = clampSliceIndex(start, this.size);
    const relativeEnd = Math.max(
      relativeBegin,
      clampSliceIndex(end, this.size),
    );

    return new NativeFileBlob(
      this.source,
      this.begin + relativeBegin,
      this.begin + relativeEnd,
      this.name,
    );
  }

  override async arrayBuffer(): Promise<ArrayBuffer> {
    const bytes = await this.source.read(this.begin, this.end);

    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);

    return buffer;
  }
}

function readableMetadata(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (Array.isArray(value)) {
    const values = value
      .map(readableMetadata)
      .filter((entry): entry is string => entry !== null);

    return values.join(", ") || null;
  }

  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;

    if ("name" in record) {
      return readableMetadata(record.name);
    }

    for (const key of ["es", "en", "und", ...Object.keys(record)]) {
      if (!(key in record)) continue;

      const text = readableMetadata(record[key]);

      if (text) return text;
    }
  }

  return null;
}

const MAX_SECTION_CHARACTERS = 1_000_000;

const TEXT_BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre";

const IGNORED_ELEMENTS = new Set([
  "script",
  "style",
  "noscript",
  "iframe",
  "object",
  "form",
  "template",
  "svg",
  "head",
]);

function extractPlainText(element: Element): string {
  const parts: string[] = [];

  function visit(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? "");
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const current = node as Element;
    const name = current.localName.toLowerCase();

    if (IGNORED_ELEMENTS.has(name)) {
      return;
    }

    if (name === "br") {
      parts.push("\n");
      return;
    }

    for (const child of Array.from(node.childNodes)) {
      visit(child);
    }
  }

  visit(element);

  return parts
    .join("")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function extractSectionContent(parsed: Document): EpubSectionContent {
  if (
    parsed.contentType !== "text/html" &&
    parsed.querySelector("parsererror")
  ) {
    throw new Error("La sección EPUB contiene un documento XML inválido.");
  }

  const root = parsed.querySelector("body") ?? parsed.documentElement;

  if (!root) {
    return { blocks: [] };
  }

  const elements = Array.from(root.querySelectorAll(TEXT_BLOCK_SELECTOR));

  const blocks: EpubTextBlock[] = [];

  let characterCount = 0;

  for (const element of elements) {
    // Prefer the innermost meaningful block to avoid
    // duplicating text from nested paragraphs or lists.
    if (element.querySelector(TEXT_BLOCK_SELECTOR)) {
      continue;
    }

    const text = extractPlainText(element);

    if (!text) continue;

    characterCount += text.length;

    if (characterCount > MAX_SECTION_CHARACTERS) {
      throw new Error("La sección EPUB supera el límite de texto permitido.");
    }

    blocks.push({
      kind: /^h[1-6]$/i.test(element.localName) ? "heading" : "paragraph",
      text,
    });
  }

  if (blocks.length === 0) {
    const text = extractPlainText(root);

    if (text.length > MAX_SECTION_CHARACTERS) {
      throw new Error("La sección EPUB supera el límite de texto permitido.");
    }

    if (text) {
      blocks.push({
        kind: "paragraph",
        text,
      });
    }
  }

  return { blocks };
}

const MAX_FALLBACK_SOURCE_CHARACTERS = 4_000_000;

async function readBookSection(
  book: FoliateBook,
  index: number,
): Promise<EpubSectionContent> {
  const section = book.sections[index];

  const parsed = await section.createDocument();

  const xmlError =
    parsed.contentType !== "text/html" &&
    parsed.querySelector("parsererror") !== null;

  if (!xmlError) {
    return extractSectionContent(parsed);
  }

  if (!section.id) {
    throw new Error("No se pudo identificar la sección EPUB.");
  }

  const source = await book.loadText(section.id);

  if (
    typeof source !== "string" ||
    !source.trim() ||
    source.length > MAX_FALLBACK_SOURCE_CHARACTERS
  ) {
    throw new Error(
      "No se pudo recuperar el contenido textual de esta sección.",
    );
  }

  // Recovery is limited to text extraction.
  // The parsed HTML is never inserted into the app DOM.
  const recoveredDocument = new DOMParser().parseFromString(
    source,
    "text/html",
  );

  const content = extractSectionContent(recoveredDocument);

  if (content.blocks.length === 0) {
    throw new Error(
      "La sección contiene XHTML inválido y no fue posible recuperar texto.",
    );
  }

  console.warn(
    `EPUB: sección ${index + 1} con XHTML inválido; texto recuperado mediante HTML.`,
  );

  return {
    ...content,
    recoveredFromHtml: true,
  };
}

export async function openEpub(
  file: FileHandle,
  size: number,
  fileName: string,
): Promise<EpubSession> {
  if (!Number.isSafeInteger(size) || size < 4 || size > MAX_EPUB_BYTES) {
    throw new Error(
      "El EPUB tiene un tamaño inválido o supera el límite de 128 MiB.",
    );
  }

  const source = new NativeRangeSource(file, size);

  const blob = new NativeFileBlob(source, 0, size, fileName);

  const { makeBook } = await import("foliate-js/view.js");

  let book: Awaited<ReturnType<typeof makeBook>>;
  let readingSectionIndexes: number[] = [];

  try {
    book = await makeBook(blob);

    if (!Array.isArray(book.sections) || book.sections.length === 0) {
      throw new Error("El EPUB no contiene secciones de lectura válidas.");
    }

    const navigationPath = book.resources?.navPath;

    // Preserve original spine positions, excluding only
    // the identified EPUB navigation document.
    readingSectionIndexes = book.sections.flatMap((section, index) =>
      navigationPath && section.id === navigationPath ? [] : [index],
    );

    if (readingSectionIndexes.length === 0) {
      throw new Error("El EPUB no contiene secciones navegables.");
    }
  } catch (cause) {
    await source.waitForIdle();
    throw cause;
  }

  const summary: EpubSummary = {
    title: readableMetadata(book.metadata?.title) ?? "Libro sin título",
    author: readableMetadata(book.metadata?.author) ?? "Autor desconocido",
    sectionCount: readingSectionIndexes.length,
    tocCount: Array.isArray(book.toc) ? book.toc.length : 0,
    fileName,
  };

  const readingTasks = new Set<Promise<EpubSectionContent>>();

  let closePromise: Promise<void> | null = null;

  const MAX_COVER_BYTES = 8 * 1024 * 1024;

  const ALLOWED_COVER_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
  ]);

  let coverUrl: string | null = null;
  let coverRequest: Promise<string | null> | null = null;

  function getCoverUrl(): Promise<string | null> {
    if (!coverRequest) {
      coverRequest = (async () => {
        const cover = await book.getCover?.();

        if (!cover) return null;

        if (
          !ALLOWED_COVER_TYPES.has(cover.type.toLowerCase()) ||
          cover.size <= 0 ||
          cover.size > MAX_COVER_BYTES
        ) {
          throw new Error(
            "La portada EPUB tiene un formato o tamaño no admitido.",
          );
        }

        coverUrl = URL.createObjectURL(cover);

        return coverUrl;
      })();
    }

    return coverRequest;
  }

  function readSection(index: number): Promise<EpubSectionContent> {
    if (closePromise) {
      return Promise.reject(new Error("La sesión EPUB ya está cerrándose."));
    }

    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= readingSectionIndexes.length
    ) {
      return Promise.reject(new Error("Sección EPUB fuera de rango."));
    }

    const task = Promise.resolve().then(async () => {
      const sourceIndex = readingSectionIndexes[index];

      const content = await readBookSection(book, sourceIndex);

      // A textless opening section commonly contains
      // the book cover.
      if (index === 0 && content.blocks.length === 0) {
        const url = await getCoverUrl();

        if (url) {
          return {
            ...content,
            coverUrl: url,
          };
        }
      }

      return content;
    });

    readingTasks.add(task);

    void task.then(
      () => readingTasks.delete(task),
      () => readingTasks.delete(task),
    );

    return task;
  }

  function close(): Promise<void> {
    if (closePromise) {
      return closePromise;
    }

    closePromise = (async () => {
      // Do not release the file while a chapter is
      // still requesting ZIP ranges.
      await Promise.allSettled([...readingTasks]);

      try {
        book.destroy?.();
      } finally {
        try {
          await source.waitForIdle();
        } finally {
          try {
            await file.close();
          } finally {
            if (coverUrl) {
              URL.revokeObjectURL(coverUrl);
              coverUrl = null;
            }
          }
        }
      }
    })();

    return closePromise;
  }

  return {
    summary,
    readSection,
    close,
  };
}
