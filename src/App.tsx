
import { useEffect, useRef, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";
import {
  open as openFile,
  SeekMode,
  type FileHandle,
} from "@tauri-apps/plugin-fs";

import {
  getDocument,
  GlobalWorkerOptions,
  PDFDataRangeTransport,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist";

import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type ActivePDF = {
  file: FileHandle;
  task: PDFDocumentLoadingTask;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function closePDF(active: ActivePDF): Promise<void> {
  try {
    await active.task.destroy();
  } finally {
    await active.file.close();
  }
}

// Read a byte range, with an exclusive cursor lock
// supplied by the PDF transport.
async function readRange(
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
    const bytesRead = await file.read(buffer.subarray(offset));

    if (bytesRead === null || bytesRead <= 0) {
      throw new Error(
        `Lectura incompleta en el byte ${begin + offset}.`,
      );
    }

    offset += bytesRead;
  }

  return buffer;
}

class LocalPDFTransport extends PDFDataRangeTransport {
  private queue: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(
    length: number,
    private readonly getRange: (
      begin: number,
      end: number,
    ) => Promise<Uint8Array>,
    private readonly onFailure: (error: unknown) => void,
  ) {
    super(length, null);
  }

  override requestDataRange(
    begin: number,
    end: number,
  ): void {
    // Requests share a FileHandle, so seek/read
    // operations must never interleave.
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

type PDFPageProps = {
  document: PDFDocumentProxy;
  pageNumber: number;
  onError: (message: string) => void;
};

function PDFPage({
  document,
  pageNumber,
  onError,
}: PDFPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: ReturnType<PDFPageProxy["render"]> | null =
      null;

    async function renderPage(): Promise<void> {
      const page = await document.getPage(pageNumber);

      if (cancelled) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const baseViewport = page.getViewport({ scale: 1 });

      const availableWidth = Math.min(
        canvas.parentElement?.clientWidth ?? window.innerWidth,
        960,
      );

      const scale = Math.max(
        0.1,
        Math.min(1.5, (availableWidth - 24) / baseViewport.width),
      );

      const viewport = page.getViewport({ scale });

      const requestedRatio = Math.min(
        window.devicePixelRatio || 1,
        2,
      );

      // Avoid excessive canvas allocations for unusual pages.
      const maxPixels = 12_000_000;
      const ratio = Math.min(
        requestedRatio,
        Math.sqrt(
          maxPixels / (viewport.width * viewport.height),
        ),
      );

      canvas.width = Math.ceil(viewport.width * ratio);
      canvas.height = Math.ceil(viewport.height * ratio);

      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("No se pudo inicializar Canvas 2D.");
      }

      renderTask = page.render({
        canvas,
        viewport,
        transform: [ratio, 0, 0, ratio, 0, 0],
      });

      await renderTask.promise;
    }

    void renderPage().catch((error: unknown) => {
      if (!cancelled) {
        onError(getErrorMessage(error));
      }
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber, onError]);

  return (
    <div
      style={{
        width: "100%",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          maxWidth: "100%",
          background: "#FFFFFF",
        }}
      />
    </div>
  );
}

function App() {
  const [document, setDocument] =
    useState<PDFDocumentProxy | null>(null);

  const [pageNumber, setPageNumber] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeRef = useRef<ActivePDF | null>(null);

  useEffect(() => {
    return () => {
      const active = activeRef.current;
      activeRef.current = null;

      if (active) {
        void closePDF(active).catch(console.error);
      }
    };
  }, []);

  async function selectPDF(): Promise<void> {
    if (loading) return;

    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: "Documentos PDF",
          extensions: ["pdf"],
        },
      ],
    });

    if (!selected) return;

    setLoading(true);
    setError(null);
    setDocument(null);

    let pendingFile: FileHandle | null = null;
    let pendingTask: PDFDocumentLoadingTask | null = null;
    let taskForError: PDFDocumentLoadingTask | null = null;

    try {
      const previous = activeRef.current;
      activeRef.current = null;

      if (previous) {
        await closePDF(previous);
      }

      const file = await openFile(selected, { read: true });
      pendingFile = file;

      const size = await file.seek(0, SeekMode.End);

      if (!Number.isSafeInteger(size) || size < 5) {
        throw new Error("Tamaño de PDF inválido.");
      }

      const signature = await readRange(file, 0, 5);

      const validPDF = [0x25, 0x50, 0x44, 0x46, 0x2d].every(
        (value, index) => signature[index] === value,
      );

      if (!validPDF) {
        throw new Error("El archivo no tiene cabecera PDF.");
      }

      const transport = new LocalPDFTransport(
        size,
        (begin, end) => {
          if (end > size) {
            throw new Error("Rango fuera del documento.");
          }

          return readRange(file, begin, end);
        },
        (cause) => {
          setError(
            `Error de lectura parcial: ${getErrorMessage(cause)}`,
          );

          void taskForError?.destroy().catch(console.error);
        },
      );

      pendingTask = getDocument({
        range: transport,
        disableStream: true,
        disableAutoFetch: true,
        rangeChunkSize: 64 * 1024,
      });

      taskForError = pendingTask;

      const loadedDocument = await pendingTask.promise;

      activeRef.current = {
        file,
        task: pendingTask,
      };

      pendingFile = null;
      pendingTask = null;

      setPageNumber(1);
      setDocument(loadedDocument);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      if (pendingTask) {
        await pendingTask.destroy().catch(console.error);
      }

      if (pendingFile) {
        await pendingFile.close().catch(console.error);
      }

      setLoading(false);
    }
  }

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        overflow: "auto",
        boxSizing: "border-box",
        background: "#EEE9DF",
        color: "#1B2632",
        fontFamily: "Arial, sans-serif",
        padding: "20px",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
          flexWrap: "wrap",
          marginBottom: "20px",
        }}
      >
        <strong>Universal Reader</strong>

        <button
          type="button"
          onClick={() => void selectPDF()}
          disabled={loading}
        >
          {loading ? "Abriendo..." : "Seleccionar PDF"}
        </button>
      </header>

      {error && (
        <p role="alert" style={{ color: "#A35139" }}>
          {error}
        </p>
      )}

      {document ? (
        <>
          <nav
            aria-label="Navegación del documento"
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: "16px",
              marginBottom: "20px",
            }}
          >
            <button
              type="button"
              disabled={pageNumber <= 1}
              onClick={() => setPageNumber((p) => p - 1)}
            >
              Anterior
            </button>

            <span>
              Página {pageNumber} de {document.numPages}
            </span>

            <button
              type="button"
              disabled={pageNumber >= document.numPages}
              onClick={() => setPageNumber((p) => p + 1)}
            >
              Siguiente
            </button>
          </nav>

          <PDFPage
            key={`${document.fingerprints[0]}-${pageNumber}`}
            document={document}
            pageNumber={pageNumber}
            onError={setError}
          />
        </>
      ) : (
        !loading && (
          <p style={{ textAlign: "center" }}>
            Selecciona un documento PDF para comenzar.
          </p>
        )
      )}
    </main>
  );
}

export default App;
