
import { useEffect, useRef, useState } from "react";

import {
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist";

import "./PdfCanvasPage.css";

type PdfCanvasPageProps = {
  document: PDFDocumentProxy;
  pageNumber: number;
  zoom: number | null;
  onError: (message: string) => void;
  onCanvasLayout?: () => void;
};

type CanvasRendererProps = PdfCanvasPageProps & {
  availableWidth: number;
};

const MAX_PAGE_WIDTH = 960;
const MAX_CANVAS_PIXELS = 12_000_000;
const MAX_PIXEL_RATIO = 2;

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

function CanvasRenderer({
  document,
  pageNumber,
  zoom,
  availableWidth,
  onError,
  onCanvasLayout,
}: CanvasRendererProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    let renderTask:
      | ReturnType<PDFPageProxy["render"]>
      | null = null;

    let textLayer: TextLayer | null = null;

    async function renderPage(): Promise<void> {
      const page = await document.getPage(pageNumber);

      if (cancelled) return;

      const frame = frameRef.current;
      const canvas = canvasRef.current;
      const textContainer = textLayerRef.current;

      if (!frame || !canvas || !textContainer) {
        return;
      }

      const baseViewport = page.getViewport({
        scale: 1,
      });

      if (
        !Number.isFinite(baseViewport.width) ||
        !Number.isFinite(baseViewport.height) ||
        baseViewport.width <= 0 ||
        baseViewport.height <= 0
      ) {
        throw new Error(
          "El PDF contiene dimensiones de página inválidas.",
        );
      }

      const targetWidth = Math.min(
        Math.max(1, availableWidth - 24),
        MAX_PAGE_WIDTH,
      );

      const fitScale = Math.min(
        1.5,
        targetWidth / baseViewport.width,
      );

      const scale = fitScale * (zoom ?? 1);

      const viewport = page.getViewport({ scale });

      const requestedRatio = Math.min(
        window.devicePixelRatio || 1,
        MAX_PIXEL_RATIO,
      );

      const memoryRatio = Math.sqrt(
        MAX_CANVAS_PIXELS /
          (viewport.width * viewport.height),
      );

      const ratio = Math.min(
        requestedRatio,
        memoryRatio,
      );

      if (!Number.isFinite(ratio) || ratio <= 0) {
        throw new Error(
          "No se pudo calcular la resolución de la página.",
        );
      }

      canvas.width = Math.max(
        1,
        Math.floor(viewport.width * ratio),
      );

      canvas.height = Math.max(
        1,
        Math.floor(viewport.height * ratio),
      );

      // Canvas and text layer share one coordinate system.
      frame.style.width = `${viewport.width}px`;
      frame.style.height = `${viewport.height}px`;

      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      textContainer.style.setProperty(
        "--total-scale-factor",
        String(viewport.scale),
      );

      textContainer.style.setProperty(
        "--scale-round-x",
        "1px",
      );

      textContainer.style.setProperty(
        "--scale-round-y",
        "1px",
      );

      // Preserve the visible point when zoom changes.
      onCanvasLayout?.();

      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error(
          "No se pudo inicializar Canvas 2D.",
        );
      }

      renderTask = page.render({
        canvas,
        viewport,
        transform: [ratio, 0, 0, ratio, 0, 0],
      });

      await renderTask.promise;

      if (cancelled) return;

      // Text selection is added after the visual page
      // has finished rendering.
      textLayer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: textContainer,
        viewport,
      });

      await textLayer.render();
    }

    void renderPage().catch((error: unknown) => {
      if (
        cancelled ||
        (error instanceof Error &&
          (error.name ===
            "RenderingCancelledException" ||
            error.name === "AbortException"))
      ) {
        return;
      }

      onError(getErrorMessage(error));
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [
    document,
    pageNumber,
    zoom,
    availableWidth,
    onError,
    onCanvasLayout,
  ]);

  return (
    <div
      ref={frameRef}
      className="pdf-page-frame"
    >
      <canvas
        ref={canvasRef}
        aria-label={`Página ${pageNumber} del PDF`}
        role="img"
        className="pdf-page-canvas"
      />

      <div
        ref={textLayerRef}
        className="pdf-text-layer textLayer"
      />
    </div>
  );
}

export function PdfCanvasPage({
  document,
  pageNumber,
  zoom,
  onError,
  onCanvasLayout,
}: PdfCanvasPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const [availableWidth, setAvailableWidth] =
    useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let animationFrame = 0;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const nextWidth = Math.floor(
        entry.contentRect.width,
      );

      cancelAnimationFrame(animationFrame);

      animationFrame = requestAnimationFrame(() => {
        setAvailableWidth((currentWidth) =>
          currentWidth === nextWidth
            ? currentWidth
            : nextWidth,
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
          key={[
            document.fingerprints[0],
            pageNumber,
            availableWidth,
            zoom ?? "fit",
          ].join("-")}
          document={document}
          pageNumber={pageNumber}
          zoom={zoom}
          availableWidth={availableWidth}
          onError={onError}
          onCanvasLayout={onCanvasLayout}
        />
      )}
    </div>
  );
}
