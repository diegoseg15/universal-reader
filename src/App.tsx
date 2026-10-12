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
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from "pdfjs-dist";

import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { ReaderShell } from "./features/reader/ReaderShell";
import { PdfCanvasPage } from "./features/reader/pdf/PdfCanvasPage";

import {
  closePDF,
  LocalPDFTransport,
  readRange,
  type ActivePDF,
} from "./features/reader/pdf/PdfRangeSource";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

type PendingPDF = {
  cancelled: boolean;
  file: FileHandle | null;
  task: PDFDocumentLoadingTask | null;
  transport: LocalPDFTransport | null;
  destroyPromise: Promise<void> | null;
  failure: unknown;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function destroyPendingTask(pending: PendingPDF): Promise<void> {
  if (!pending.task) {
    return Promise.resolve();
  }

  // Share the same destruction promise across callers.
  pending.destroyPromise ??= pending.task.destroy();

  return pending.destroyPromise;
}

function App() {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);

  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(false);
  const activeRef = useRef<ActivePDF | null>(null);
  const openingRef = useRef<PendingPDF | null>(null);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      const pending = openingRef.current;

      if (pending) {
        pending.cancelled = true;
        pending.transport?.abort();

        if (pending.task) {
          void destroyPendingTask(pending).catch(console.error);
        }
      }

      const active = activeRef.current;
      activeRef.current = null;

      if (active) {
        void closePDF(active).catch(console.error);
      }
    };
  }, []);

  async function selectPDF(): Promise<void> {
    // The ref blocks re-entry before React updates state.
    if (openingRef.current || !mountedRef.current) {
      return;
    }

    const pending: PendingPDF = {
      cancelled: false,
      file: null,
      task: null,
      transport: null,
      destroyPromise: null,
      failure: undefined,
    };

    openingRef.current = pending;

    try {
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

      // Cancelling the dialog preserves the current PDF.
      if (!selected || pending.cancelled) return;

      setLoading(true);
      setError(null);
      setDocument(null);

      const previous = activeRef.current;
      activeRef.current = null;

      if (previous) {
        await closePDF(previous);
      }

      if (pending.cancelled) return;

      const file = await openFile(selected, {
        read: true,
      });

      pending.file = file;

      if (pending.cancelled) return;

      const size = await file.seek(0, SeekMode.End);

      if (!Number.isSafeInteger(size) || size < 5) {
        throw new Error("Tamaño de PDF inválido.");
      }

      const signature = await readRange(file, 0, 5);

      if (pending.cancelled) return;

      const validPDF = [0x25, 0x50, 0x44, 0x46, 0x2d].every(
        (value, index) => signature[index] === value,
      );

      if (!validPDF) {
        throw new Error("El archivo no tiene una cabecera PDF válida.");
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
          // Ignore failures from a cancelled/closed PDF.
          if (pending.cancelled || !mountedRef.current) {
            return;
          }

          const active = activeRef.current;

          // The transport must still belong to the
          // pending task or the currently active PDF.
          if (!pending.task && active?.transport !== transport) {
            return;
          }

          pending.failure = cause;

          setError(`Error de lectura parcial: ${getErrorMessage(cause)}`);

          if (active?.transport === transport) {
            activeRef.current = null;
            setDocument(null);

            void closePDF(active).catch(console.error);
          } else {
            void destroyPendingTask(pending).catch(console.error);
          }
        },
      );

      pending.transport = transport;

      const task = getDocument({
        range: transport,
        disableStream: true,
        disableAutoFetch: true,
        rangeChunkSize: 64 * 1024,
        wasmUrl: new URL(
          "pdfjs-wasm/",
          new URL(import.meta.env.BASE_URL, window.location.origin),
        ).href,
      });

      pending.task = task;

      const loadedDocument = await task.promise;

      if (
        pending.cancelled ||
        task.destroyed ||
        pending.failure !== undefined
      ) {
        return;
      }

      activeRef.current = {
        file,
        task,
        transport,
      };

      // Ownership has moved to activeRef.
      pending.file = null;
      pending.task = null;
      pending.transport = null;

      setPageNumber(1);
      setZoom(null);
      setDocument(loadedDocument);
    } catch (cause) {
      if (!pending.cancelled && mountedRef.current) {
        setError(
          `No se pudo abrir el PDF: ${getErrorMessage(
            pending.failure ?? cause,
          )}`,
        );
      }
    } finally {
      // Cleanup owns any resources not promoted
      // to activeRef.
      pending.transport?.abort();

      if (pending.task) {
        try {
          await destroyPendingTask(pending);
        } catch (cause) {
          console.error("Error al destruir PDF pendiente:", cause);
        }
      }

      if (pending.transport) {
        try {
          await pending.transport.waitForIdle();
        } catch (cause) {
          console.error("Error al esperar lecturas PDF:", cause);
        }
      }

      if (pending.file) {
        try {
          await pending.file.close();
        } catch (cause) {
          console.error("Error al cerrar archivo PDF:", cause);
        }
      }

      if (openingRef.current === pending) {
        openingRef.current = null;

        if (mountedRef.current) {
          setLoading(false);
        }
      }
    }
  }

  return (
    <ReaderShell
      title="Universal Reader"
      loading={loading}
      error={error}
      documentKey={document?.fingerprints[0] ?? null}
      pageNumber={document ? pageNumber : null}
      pageCount={document?.numPages ?? null}
      onSelectFile={() => void selectPDF()}
      onPrevious={() => setPageNumber((current) => Math.max(1, current - 1))}
      onNext={() =>
        setPageNumber((current) =>
          Math.min(document?.numPages ?? current, current + 1),
        )
      }
      zoom={{
        value: zoom,
        min: MIN_ZOOM,
        max: MAX_ZOOM,
        onIncrease: () =>
          setZoom((current) => Math.min(MAX_ZOOM, (current ?? 1) + ZOOM_STEP)),
        onDecrease: () =>
          setZoom((current) => Math.max(MIN_ZOOM, (current ?? 1) - ZOOM_STEP)),
        onFit: () => setZoom(null),
      }}
    >
      {document && (
        <PdfCanvasPage
          key={`${document.fingerprints[0]}-${pageNumber}`}
          document={document}
          pageNumber={pageNumber}
          zoom={zoom}
          onError={setError}
        />
      )}
    </ReaderShell>
  );
}

export default App;
