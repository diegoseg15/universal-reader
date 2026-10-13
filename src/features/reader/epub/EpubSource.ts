
import {
  SeekMode,
  type FileHandle,
} from "@tauri-apps/plugin-fs";

export type EpubSummary = {
  title: string;
  author: string;
  sectionCount: number;
  tocCount: number;
  fileName: string;
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
        const count = await this.file.read(
          result.subarray(offset),
        );

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
}

function clampSliceIndex(index: number, size: number): number {
  if (Number.isNaN(index)) return 0;

  if (index === Infinity) return size;
  if (index === -Infinity) return 0;

  const integer = Math.trunc(index);

  return integer < 0
    ? Math.max(size + integer, 0)
    : Math.min(integer, size);
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

  override slice(
    start = 0,
    end = this.size,
    _contentType?: string,
  ): Blob {
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
    const bytes = await this.source.read(
      this.begin,
      this.end,
    );

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

    for (const key of [
      "es",
      "en",
      "und",
      ...Object.keys(record),
    ]) {
      if (!(key in record)) continue;

      const text = readableMetadata(record[key]);

      if (text) return text;
    }
  }

  return null;
}

export async function inspectEpub(
  file: FileHandle,
  size: number,
  fileName: string,
): Promise<EpubSummary> {
  if (
    !Number.isSafeInteger(size) ||
    size < 4 ||
    size > MAX_EPUB_BYTES
  ) {
    throw new Error(
      "El EPUB tiene un tamaño inválido o supera el límite de 128 MiB.",
    );
  }

  const source = new NativeRangeSource(file, size);

  const blob = new NativeFileBlob(
    source,
    0,
    size,
    fileName,
  );

  // Dynamically loaded: PDF users do not need the EPUB engine.
  const { makeBook } = await import("foliate-js/view.js");

  const book = await makeBook(blob);

  if (
    !Array.isArray(book.sections) ||
    book.sections.length === 0
  ) {
    throw new Error(
      "El EPUB no contiene secciones de lectura válidas.",
    );
  }

  return {
    title:
      readableMetadata(book.metadata?.title) ??
      "Libro sin título",
    author:
      readableMetadata(book.metadata?.author) ??
      "Autor desconocido",
    sectionCount: book.sections.length,
    tocCount: Array.isArray(book.toc)
      ? book.toc.length
      : 0,
    fileName,
  };
}
