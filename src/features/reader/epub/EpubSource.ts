import type { FileHandle } from "@tauri-apps/plugin-fs";
import type { FoliateBook, FoliateTocItem } from "foliate-js/view.js";

import {
  readBookSection,
  type EpubInlineNode,
  type EpubSectionContent,
  type EpubTextBlock,
} from "./EpubContentExtractor";
import {
  createEpubProgressId,
  NativeFileBlob,
  NativeRangeSource,
} from "./EpubRangeSource";

export { NativeFileBlob, NativeRangeSource };
export type { EpubInlineNode, EpubSectionContent, EpubTextBlock };

export type EpubSummary = {
  title: string;
  author: string;
  sectionCount: number;
  tocCount: number;
  fileName: string;
};

export type EpubTocEntry = {
  id: string;
  title: string;
  sectionIndex: number | null;
  depth: number;
};

export type EpubSession = {
  summary: EpubSummary;
  toc: EpubTocEntry[];
  progressId: string;
  readSection: (index: number) => Promise<EpubSectionContent>;
  close: () => Promise<void>;
};

const MAX_EPUB_BYTES = 128 * 1024 * 1024;
const MAX_TOC_ENTRIES = 1000;
const MAX_TOC_DEPTH = 8;

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

function buildEpubToc(
  book: FoliateBook,
  readingSectionIndexes: number[],
): EpubTocEntry[] {
  const visibleIndexBySource = new Map<number, number>(
    readingSectionIndexes.map((sourceIndex, visibleIndex) => [
      sourceIndex,
      visibleIndex,
    ]),
  );

  const entries: EpubTocEntry[] = [];

  function visit(items: FoliateTocItem[], depth: number): void {
    if (depth > MAX_TOC_DEPTH) return;

    for (const item of items) {
      if (entries.length >= MAX_TOC_ENTRIES) return;

      if (!item || typeof item !== "object") {
        continue;
      }

      const title =
        typeof item.label === "string" ? item.label.trim().slice(0, 200) : "";

      let sectionIndex: number | null = null;

      if (typeof item.href === "string" && item.href.length > 0) {
        try {
          if (!book.isExternal?.(item.href)) {
            const destination = book.resolveHref?.(item.href);

            if (destination && Number.isInteger(destination.index)) {
              sectionIndex =
                visibleIndexBySource.get(destination.index) ?? null;
            }
          }
        } catch (cause) {
          console.warn(
            "No se pudo resolver una entrada del índice EPUB:",
            cause,
          );
        }
      }

      if (title) {
        entries.push({
          id: `toc-${entries.length}`,
          title,
          sectionIndex,
          depth,
        });
      }

      if (Array.isArray(item.subitems)) {
        visit(item.subitems, depth + 1);
      }
    }
  }

  if (Array.isArray(book.toc)) {
    visit(book.toc, 0);
  }

  return entries;
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

  const progressId = await createEpubProgressId(source);

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

  const toc = buildEpubToc(book, readingSectionIndexes);

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
    toc,
    progressId,
    readSection,
    close,
  };
}
