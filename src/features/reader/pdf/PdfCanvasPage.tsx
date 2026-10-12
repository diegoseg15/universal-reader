import { useEffect, useRef, useState } from "react";

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

type PdfCanvasPageProps = {
  document: PDFDocumentProxy;
  pageNumber: number;
  zoom: number | null;
  onError: (message: string) => void;
};

type CanvasRendererProps = PdfCanvasPageProps & {
  availableWidth: number;
};

const MAX_PAGE_WIDTH = 960;
const MAX_CANVAS_PIXELS = 12_000_000;
const MAX_PIXEL_RATIO = 2;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function CanvasRenderer({
  document,
  pageNumber,
  zoom,
  availableWidth,
  onError,
}: CanvasRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;

    let renderTask: ReturnType<PDFPageProxy["render"]> | null = null;

    async function renderPage(): Promise<void> {
      const page = await document.getPage(pageNumber);

      if (cancelled) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const baseViewport = page.getViewport({
        scale: 1,
      });

      if (!Number.isFinite(baseViewport.width) || baseViewport.width <= 0) {
        throw new Error("El PDF contiene dimensiones de página inválidas.");
      }

      // Fit the document to the available viewport width.
      const targetWidth = Math.min(
        Math.max(1, availableWidth - 24),
        MAX_PAGE_WIDTH,
      );

      const fitScale = Math.min(1.5, targetWidth / baseViewport.width);

      const scale = fitScale * (zoom ?? 1);

      const viewport = page.getViewport({
        scale,
      });

      const requestedRatio = Math.min(
        window.devicePixelRatio || 1,
        MAX_PIXEL_RATIO,
      );

      // Limit the number of allocated canvas pixels.
      const memoryRatio = Math.sqrt(
        MAX_CANVAS_PIXELS / (viewport.width * viewport.height),
      );

      const ratio = Math.min(requestedRatio, memoryRatio);

      if (!Number.isFinite(ratio) || ratio <= 0) {
        throw new Error("No se pudo calcular la resolución de la página.");
      }

      canvas.width = Math.max(1, Math.floor(viewport.width * ratio));

      canvas.height = Math.max(1, Math.floor(viewport.height * ratio));

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
      if (
        cancelled ||
        (error instanceof Error && error.name === "RenderingCancelledException")
      ) {
        return;
      }

      onError(getErrorMessage(error));
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber, availableWidth, zoom, onError]);

  return (
    <canvas
      ref={canvasRef}
      aria-label={`Página ${pageNumber} del PDF`}
      role="img"
      style={{
        display: "block",
        marginInline: "auto",
        background: "#FFFFFF",
      }}
    />
  );
}

export function PdfCanvasPage({
  document,
  pageNumber,
  zoom,
  onError,
}: PdfCanvasPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let animationFrame = 0;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const nextWidth = Math.floor(entry.contentRect.width);

      cancelAnimationFrame(animationFrame);

      animationFrame = requestAnimationFrame(() => {
        setAvailableWidth((currentWidth) =>
          currentWidth === nextWidth ? currentWidth : nextWidth,
        );
      });
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(animationFrame);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        minWidth: 0,
      }}
    >
      {availableWidth > 0 && (
        <CanvasRenderer
          key={`${document.fingerprints[0]}-${pageNumber}-${availableWidth}-${zoom ?? "fit"}`}
          document={document}
          pageNumber={pageNumber}
          zoom={zoom}
          availableWidth={availableWidth}
          onError={onError}
        />
      )}
    </div>
  );
}
