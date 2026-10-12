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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function App() {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);

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

    let pendingFile: FileHandle | null = null;
    let pendingTask: PDFDocumentLoadingTask | null = null;
    let taskForError: PDFDocumentLoadingTask | null = null;

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

      if (!selected) return;

      setLoading(true);
      setError(null);
      setDocument(null);

      const previous = activeRef.current;
      activeRef.current = null;

      if (previous) {
        await closePDF(previous);
      }

      const file = await openFile(selected, {
        read: true,
      });

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
          setError(`Error de lectura parcial: ${getErrorMessage(cause)}`);

          void taskForError?.destroy().catch(console.error);
        },
      );

      pendingTask = getDocument({
        range: transport,
        disableStream: true,
        disableAutoFetch: true,
        rangeChunkSize: 64 * 1024,
        wasmUrl: new URL(
          "pdfjs-wasm/",
          new URL(import.meta.env.BASE_URL, window.location.origin),
        ).href,
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
    >
      {document && (
        <PdfCanvasPage
          key={`${document.fingerprints[0]}-${pageNumber}`}
          document={document}
          pageNumber={pageNumber}
          onError={setError}
        />
      )}
    </ReaderShell>
  );
}

export default App;
