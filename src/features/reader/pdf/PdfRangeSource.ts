
import type { FileHandle } from "@tauri-apps/plugin-fs";
import { SeekMode } from "@tauri-apps/plugin-fs";

import {
  PDFDataRangeTransport,
  type PDFDocumentLoadingTask,
} from "pdfjs-dist";

export type ActivePDF = {
  file: FileHandle;
  task: PDFDocumentLoadingTask;
};

export async function closePDF(
  active: ActivePDF,
): Promise<void> {
  try {
    await active.task.destroy();
  } finally {
    await active.file.close();
  }
}

export async function readRange(
  file: FileHandle,
  begin: number,
  end: number,
): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(begin) ||
    !Number.isSafeInteger(end) ||
    begin < 0 ||
    end <= begin
  ) {
    throw new Error("Intervalo de lectura inválido.");
  }

  await file.seek(begin, SeekMode.Start);

  const buffer = new Uint8Array(end - begin);
  let offset = 0;

  while (offset < buffer.length) {
    const bytesRead = await file.read(
      buffer.subarray(offset),
    );

    if (bytesRead === null || bytesRead <= 0) {
      throw new Error(
        `Lectura incompleta en el byte ${begin + offset}.`,
      );
    }

    offset += bytesRead;
  }

  return buffer;
}

export class LocalPDFTransport extends PDFDataRangeTransport {
  private queue: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(
    length: number,
    private readonly getRange: (
      begin: number,
      end: number,
    ) => Promise<Uint8Array>,
    private readonly onFailure: (
      error: unknown,
    ) => void,
  ) {
    super(length, null);
  }

  override requestDataRange(
    begin: number,
    end: number,
  ): void {
    this.queue = this.queue
      .then(async () => {
        if (this.stopped) return;

        const bytes = await this.getRange(begin, end);

        if (!this.stopped) {
          this.onDataRange(begin, bytes);
        }
      })
      .catch((error: unknown) => {
        if (!this.stopped) {
          this.stopped = true;
          this.onFailure(error);
        }
      });
  }

  override abort(): void {
    this.stopped = true;
  }
}
