import { useCallback, useEffect, useRef, useState } from "react";

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

import { usePdfSearch } from "./features/reader/pdf/usePdfSearch";

import {
  openEpub,
  type EpubSession,
  type EpubSummary,
} from "./features/reader/epub/EpubSource";

import { EpubChapter } from "./features/reader/epub/EpubChapter";

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

type ZoomAnchor = {
  x: number;
  y: number;
};

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
  const [epub, setEpub] = useState<EpubSummary | null>(null);

  const [epubSectionIndex, setEpubSectionIndex] = useState(0);

  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const viewportRef = useRef<HTMLElement | null>(null);
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null);
  const lastCenteredMatchRef = useRef<string | null>(null);

  const pdfSearch = usePdfSearch(document, (page) => {
    zoomAnchorRef.current = null;
    setPageNumber(page);
  });

  const activeMatchIndex =
    pdfSearch.status === "done" &&
    pdfSearch.activeMatch?.pageNumber === pageNumber
      ? pdfSearch.activeMatch.indexOnPage
      : null;

  const activeMatchKey =
    activeMatchIndex !== null
      ? [
          document?.fingerprints[0],
          pdfSearch.query,
          pdfSearch.selectedIndex,
        ].join(":")
      : null;

  useEffect(() => {
    if (pdfSearch.status !== "done") {
      lastCenteredMatchRef.current = null;
    }
  }, [pdfSearch.status]);

  const centerActiveMatch = useCallback(
    (range: Range): void => {
      if (!activeMatchKey || lastCenteredMatchRef.current === activeMatchKey) {
        return;
      }

      const viewport = viewportRef.current;

      if (!viewport) return;

      const matchRect = Array.from(range.getClientRects()).find(
        (rect) => rect.width > 0 && rect.height > 0,
      );

      if (!matchRect) return;

      const viewportRect = viewport.getBoundingClientRect();

      const viewportCenterX = viewportRect.left + viewportRect.width / 2;

      const viewportCenterY = viewportRect.top + viewportRect.height / 2;

      const matchCenterX = matchRect.left + matchRect.width / 2;

      const matchCenterY = matchRect.top + matchRect.height / 2;

      const deltaX = matchCenterX - viewportCenterX;
      const deltaY = matchCenterY - viewportCenterY;

      viewport.scrollLeft += deltaX;
      viewport.scrollTop += deltaY;

      lastCenteredMatchRef.current = activeMatchKey;
    },
    [activeMatchKey],
  );

  const mountedRef = useRef(false);
  const activeRef = useRef<ActivePDF | null>(null);
  const openingRef = useRef<PendingPDF | null>(null);
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

  function changeZoom(nextZoom: number | null): void {
    if (nextZoom === zoom) return;

    const viewport = viewportRef.current;
    const canvas = viewport?.querySelector("canvas");

    zoomAnchorRef.current = null;

    if (viewport && canvas) {
      const viewportRect = viewport.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();

      if (canvasRect.width > 0 && canvasRect.height > 0) {
        const centerX = viewportRect.left + viewportRect.width / 2;

        const centerY = viewportRect.top + viewportRect.height / 2;

        zoomAnchorRef.current = {
          x: Math.max(
            0,
            Math.min(1, (centerX - canvasRect.left) / canvasRect.width),
          ),
          y: Math.max(
            0,
            Math.min(1, (centerY - canvasRect.top) / canvasRect.height),
          ),
        };
      }
    }

    setZoom(nextZoom);
  }

  const restoreZoomPosition = useCallback((): void => {
    const anchor = zoomAnchorRef.current;

    if (!anchor) return;

    zoomAnchorRef.current = null;

    const viewport = viewportRef.current;
    const canvas = viewport?.querySelector("canvas");

    if (!viewport || !canvas) return;

    const viewportRect = viewport.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();

    if (canvasRect.width <= 0 || canvasRect.height <= 0) {
      return;
    }

    const centerX = viewportRect.left + viewportRect.width / 2;

    const centerY = viewportRect.top + viewportRect.height / 2;

    const targetX = canvasRect.left + anchor.x * canvasRect.width;

    const targetY = canvasRect.top + anchor.y * canvasRect.height;

    viewport.scrollLeft += targetX - centerX;
    viewport.scrollTop += targetY - centerY;
  }, []);

  async function selectDocument(): Promise<void> {
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
            name: "Documentos PDF y EPUB",
            extensions: ["pdf", "epub"],
          },
        ],
      });

      // Cancelling the dialog preserves the current PDF.
      if (!selected || pending.cancelled) return;

      setLoading(true);
      setError(null);

      setEpub(null);

      pdfSearch.clearSearch();

      zoomAnchorRef.current = null;

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
        const fileName = selected.split(/[\\/]/).pop() || "book.epub";

        const session = await openEpub(file, size, fileName);

        // The session now owns the native FileHandle.
        pending.file = null;

        if (pending.cancelled) {
          await session.close();
          return;
        }

        activeEpubRef.current = session;

        setEpubSectionIndex(0);
        setPageNumber(1);
        setZoom(null);
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
          `No se pudo abrir el documento: ${getErrorMessage(
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
      documentKey={document?.fingerprints[0] ?? epub?.fileName ?? null}
      pageNumber={document ? pageNumber : epub ? epubSectionIndex + 1 : null}
      pageCount={document?.numPages ?? epub?.sectionCount ?? null}
      onSelectFile={() => void selectDocument()}
      viewportRef={viewportRef}
      onPrevious={() => {
        if (epub) {
          setEpubSectionIndex((current) => Math.max(0, current - 1));
          return;
        }

        zoomAnchorRef.current = null;

        setPageNumber((current) => Math.max(1, current - 1));
      }}
      onNext={() => {
        if (epub) {
          setEpubSectionIndex((current) =>
            Math.min(epub.sectionCount - 1, current + 1),
          );
          return;
        }

        zoomAnchorRef.current = null;

        setPageNumber((current) =>
          Math.min(document?.numPages ?? current, current + 1),
        );
      }}
      zoom={
        document
          ? {
              value: zoom,
              min: MIN_ZOOM,
              max: MAX_ZOOM,
              onIncrease: () =>
                changeZoom(Math.min(MAX_ZOOM, (zoom ?? 1) + ZOOM_STEP)),
              onDecrease: () =>
                changeZoom(Math.max(MIN_ZOOM, (zoom ?? 1) - ZOOM_STEP)),
              onFit: () => changeZoom(null),
            }
          : undefined
      }
      search={
        document
          ? {
              query: pdfSearch.query,
              status: pdfSearch.status,
              scannedPages: pdfSearch.scannedPages,
              totalPages: document?.numPages ?? 0,
              pagesWithMatches: pdfSearch.pages.length,
              totalMatches: pdfSearch.totalMatches,
              selectedIndex: pdfSearch.selectedIndex,
              error: pdfSearch.error,

              onQueryChange: pdfSearch.changeQuery,
              onSearch: pdfSearch.search,
              onPrevious: pdfSearch.previousResult,
              onNext: pdfSearch.nextResult,
            }
          : undefined
      }
    >
      {document ? (
        <PdfCanvasPage
          key={`${document.fingerprints[0]}-${pageNumber}`}
          document={document}
          pageNumber={pageNumber}
          zoom={zoom}
          highlightQuery={pdfSearch.status === "done" ? pdfSearch.query : null}
          activeMatchIndex={activeMatchIndex}
          onActiveMatchReady={centerActiveMatch}
          onError={setError}
          onCanvasLayout={restoreZoomPosition}
        />
      ) : epub && activeEpubRef.current ? (
        <EpubChapter
          session={activeEpubRef.current}
          sectionIndex={epubSectionIndex}
          onNavigateSection={setEpubSectionIndex}
        />
      ) : null}
    </ReaderShell>
  );
}

export default App;
