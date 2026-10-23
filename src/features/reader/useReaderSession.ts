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

import {
  openEpub,
  type EpubSession,
  type EpubSummary,
} from "./epub/EpubSource";
import { getEpubProgress } from "./epub/EpubProgress";
import {
  DEFAULT_EPUB_APPEARANCE,
  readEpubAppearance,
  saveEpubAppearance,
  type EpubAppearance,
} from "./epub/EpubAppearance";
import {
  closePDF,
  LocalPDFTransport,
  readRange,
  type ActivePDF,
} from "./pdf/PdfRangeSource";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

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

  pending.destroyPromise ??= pending.task.destroy();

  return pending.destroyPromise;
}

type UseReaderSessionCallbacks = {
  onBeforeSwitch: () => void;
};

export function useReaderSession({ onBeforeSwitch }: UseReaderSessionCallbacks) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [epub, setEpub] = useState<EpubSummary | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [epubSectionIndex, setEpubSectionIndex] = useState(0);
  const [epubAppearance, setEpubAppearance] =
    useState<EpubAppearance>(readEpubAppearance);

  useEffect(() => {
    saveEpubAppearance(epubAppearance);
  }, [epubAppearance]);

  const [pageNumber, setPageNumber] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(false);
  const activeRef = useRef<ActivePDF | null>(null);
  const openingRef = useRef<PendingPDF | null>(null);
  const closingRef = useRef(false);
  const activeEpubRef = useRef<EpubSession | null>(null);

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

      const activeEpub = activeEpubRef.current;
      activeEpubRef.current = null;

      if (activeEpub) {
        void activeEpub.close().catch(console.error);
      }
    };
  }, []);

  async function selectDocument(path?: string, name?: string): Promise<void> {
    if (openingRef.current || closingRef.current || !mountedRef.current) {
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
      const selected =
        path ??
        (await open({
          multiple: false,
          directory: false,
          filters: [
            {
              name: "Documentos PDF y EPUB",
              extensions: ["pdf", "epub"],
            },
          ],
        }));

      // Cancelling the dialog preserves the current document.
      if (!selected || pending.cancelled) return;

      setLoading(true);
      setError(null);
      setEpub(null);
      setPdfFileName(null);

      onBeforeSwitch();

      setDocument(null);

      const previous = activeRef.current;
      activeRef.current = null;

      if (previous) {
        await closePDF(previous);
      }

      const previousEpub = activeEpubRef.current;
      activeEpubRef.current = null;

      if (previousEpub) {
        await previousEpub.close();
      }

      if (pending.cancelled) return;

      const file = await openFile(selected, {
        read: true,
      });

      pending.file = file;

      if (pending.cancelled) return;

      const size = await file.seek(0, SeekMode.End);

      if (!Number.isSafeInteger(size) || size < 5) {
        throw new Error("Tamaño de documento inválido.");
      }

      const signature = await readRange(file, 0, 5);

      if (pending.cancelled) return;

      const validPDF = [0x25, 0x50, 0x44, 0x46, 0x2d].every(
        (value, index) => signature[index] === value,
      );

      // ZIP local-file header: PK\x03\x04.
      const validZIP =
        signature[0] === 0x50 &&
        signature[1] === 0x4b &&
        signature[2] === 0x03 &&
        signature[3] === 0x04;

      if (validZIP) {
        const fileName = name || selected.split(/[\\/]/).pop() || "book.epub";

        const session = await openEpub(file, size, fileName);

        // Ownership of the handle moves to EpubSession.
        pending.file = null;

        if (pending.cancelled) {
          await session.close();
          return;
        }

        activeEpubRef.current = session;

        const savedProgress = getEpubProgress(session);

        setEpubSectionIndex(savedProgress.lastSection);
        setPageNumber(1);
        setEpub(session.summary);

        return;
      }

      if (!validPDF) {
        throw new Error(
          "El archivo no tiene una cabecera PDF o EPUB compatible.",
        );
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
          if (pending.cancelled || !mountedRef.current) {
            return;
          }

          const active = activeRef.current;

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

      // Ownership moves to activeRef.
      pending.file = null;
      pending.task = null;
      pending.transport = null;

      setPageNumber(1);
      setPdfFileName(name || selected.split(/[\\/]/).pop() || "Documento PDF");
      setDocument(loadedDocument);
    } catch (cause) {
      if (!pending.cancelled && mountedRef.current) {
        setError(
          `No se pudo abrir el documento: ${getErrorMessage(
            pending.failure ?? cause,
          )}`,
        );
      }
    } finally {
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
          console.error("Error al cerrar archivo pendiente:", cause);
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

  async function returnHome(): Promise<void> {
    if (openingRef.current || closingRef.current || !mountedRef.current) {
      return;
    }

    closingRef.current = true;
    setLoading(true);

    const previousPdf = activeRef.current;
    const previousEpub = activeEpubRef.current;

    activeRef.current = null;
    activeEpubRef.current = null;

    setDocument(null);
    setEpub(null);
    setPdfFileName(null);
    setError(null);

    onBeforeSwitch();

    setPageNumber(1);
    setEpubSectionIndex(0);

    try {
      const closures: Promise<void>[] = [];

      if (previousPdf) {
        closures.push(closePDF(previousPdf));
      }

      if (previousEpub) {
        closures.push(previousEpub.close());
      }

      const results = await Promise.allSettled(closures);

      const failure = results.find((result) => result.status === "rejected");

      if (failure?.status === "rejected") {
        console.error("Error al cerrar el documento:", failure.reason);

        if (mountedRef.current) {
          setError(
            `No se pudo cerrar el documento correctamente: ${getErrorMessage(
              failure.reason,
            )}`,
          );
        }
      }
    } finally {
      closingRef.current = false;

      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }

  const epubSession = activeEpubRef.current;

  const currentChapterTitle = epub
    ? (epubSession?.toc.find(
        (entry) => entry.sectionIndex === epubSectionIndex,
      )?.title ??
      (epubSectionIndex === 0 ? "Portada" : `Sección ${epubSectionIndex + 1}`))
    : null;

  const epubZoomControls = epub
    ? {
        value:
          epubAppearance.fontSize === DEFAULT_EPUB_APPEARANCE.fontSize
            ? null
            : epubAppearance.fontSize / DEFAULT_EPUB_APPEARANCE.fontSize,
        min: 16 / DEFAULT_EPUB_APPEARANCE.fontSize,
        max: 28 / DEFAULT_EPUB_APPEARANCE.fontSize,
        onIncrease: () => {
          setEpubAppearance((current) => ({
            ...current,
            fontSize: Math.min(28, current.fontSize + 1),
          }));
        },
        onDecrease: () => {
          setEpubAppearance((current) => ({
            ...current,
            fontSize: Math.max(16, current.fontSize - 1),
          }));
        },
        onFit: () => {
          setEpubAppearance((current) => ({
            ...current,
            fontSize: DEFAULT_EPUB_APPEARANCE.fontSize,
          }));
        },
      }
    : undefined;

  return {
    document,
    epub,
    epubSession,
    pdfFileName,
    pageNumber,
    setPageNumber,
    epubSectionIndex,
    setEpubSectionIndex,
    epubAppearance,
    setEpubAppearance,
    epubZoomControls,
    currentChapterTitle,
    loading,
    error,
    setError,
    selectDocument,
    returnHome,
  };
}
