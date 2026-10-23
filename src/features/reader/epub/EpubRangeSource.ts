import { SeekMode, type FileHandle } from "@tauri-apps/plugin-fs";

const MAX_RANGE_BYTES = 16 * 1024 * 1024;
const FINGERPRINT_SAMPLE_BYTES = 64 * 1024;

export class NativeRangeSource {
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

export async function createEpubProgressId(
  source: NativeRangeSource,
): Promise<string> {
  const prefixEnd = Math.min(source.size, FINGERPRINT_SAMPLE_BYTES);

  const suffixStart = Math.max(
    prefixEnd,
    source.size - FINGERPRINT_SAMPLE_BYTES,
  );

  const prefix = await source.read(0, prefixEnd);
  const suffix = await source.read(suffixStart, source.size);

  const sampledBytes = new Uint8Array(4 + prefix.length + suffix.length);

  new DataView(sampledBytes.buffer).setUint32(0, source.size, true);

  sampledBytes.set(prefix, 4);
  sampledBytes.set(suffix, 4 + prefix.length);

  const digest = await crypto.subtle.digest("SHA-256", sampledBytes.buffer);

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
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
export class NativeFileBlob extends Blob {
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
