
import { useEffect, useRef } from "react";

import type {
  PDFDocumentProxy,
  PDFPageProxy,
} from "pdfjs-dist";

type PdfCanvasPageProps = {
  document: PDFDocumentProxy;
  pageNumber: number;
  onError: (message: string) => void;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

export function PdfCanvasPage({
  document,
  pageNumber,
  onError,
}: PdfCanvasPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;

    let renderTask:
      | ReturnType<PDFPageProxy["render"]>
      | null = null;

    async function renderPage(): Promise<void> {
      const page = await document.getPage(pageNumber);

      if (cancelled) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const baseViewport = page.getViewport({
        scale: 1,
      });

      const availableWidth = Math.min(
        canvas.parentElement?.clientWidth ??
          window.innerWidth,
        960,
      );

      const scale = Math.max(
        0.1,
        Math.min(
          1.5,
          (availableWidth - 24) /
            baseViewport.width,
        ),
      );

      const viewport = page.getViewport({ scale });

      const requestedRatio = Math.min(
        window.devicePixelRatio || 1,
        2,
      );

      const maxPixels = 12_000_000;

      const ratio = Math.min(
        requestedRatio,
        Math.sqrt(
          maxPixels /
            (viewport.width * viewport.height),
        ),
      );

      canvas.width = Math.ceil(viewport.width * ratio);
      canvas.height = Math.ceil(viewport.height * ratio);

      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

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
    }

    void renderPage().catch((error: unknown) => {
      if (
        !cancelled &&
        !(error instanceof Error &&
          error.name === "RenderingCancelledException")
      ) {
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
