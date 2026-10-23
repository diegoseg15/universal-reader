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
  highlightQuery?: string | null;
  activeMatchIndex?: number | null;
  onActiveMatchReady?: (range: Range) => void;
  onError: (message: string) => void;
  onCanvasLayout?: () => void;
};

type CanvasRendererProps = PdfCanvasPageProps & {
  availableWidth: number;
};

const MAX_PAGE_WIDTH = 960;
const MAX_CANVAS_PIXELS = 12_000_000;
const MAX_PIXEL_RATIO = 2;

const SEARCH_HIGHLIGHT_NAME = "universal-reader-pdf-search";
const ACTIVE_HIGHLIGHT_NAME = "universal-reader-pdf-search-active";
const MAX_VISIBLE_HIGHLIGHTS = 500;

type TextPoint = {
  node: Text;
  offset: number;
};

function clearSearchHighlights(): void {
  if ("highlights" in CSS) {
    CSS.highlights.delete(SEARCH_HIGHLIGHT_NAME);
    CSS.highlights.delete(ACTIVE_HIGHLIGHT_NAME);
  }
}

function highlightPageText(
  container: HTMLElement,
  rawQuery: string | null | undefined,
  activeMatchIndex: number | null = null,
  onActiveMatchReady?: (range: Range) => void,
): void {
  clearSearchHighlights();

  if (!rawQuery) return;

  if (!("highlights" in CSS) || typeof Highlight === "undefined") {
    console.warn("La API de resaltado de texto no está disponible.");
    return;
  }

  const query = rawQuery
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  if (!query) return;

  const characters: string[] = [];
  const starts: TextPoint[] = [];
  const ends: TextPoint[] = [];

  let lastPosition: TextPoint | null = null;

  function appendCharacter(
    character: string,
    start: TextPoint,
    end: TextPoint,
  ): void {
    const normalized = character.normalize("NFC").toLowerCase();

    for (let i = 0; i < normalized.length; i++) {
      const part = normalized[i];

      if (/\s/.test(part)) {
        if (
          characters.length === 0 ||
          characters[characters.length - 1] === " "
        ) {
          continue;
        }

        characters.push(" ");
      } else {
        characters.push(part);
      }

      starts.push(start);
      ends.push(end);
    }
  }

  // Read text in the actual order of the PDF.js
  // text layer. No DOM elements are modified.
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );

  let node = walker.nextNode();

  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      const value = textNode.data;

      for (let offset = 0; offset < value.length; ) {
        const codePoint = value.codePointAt(offset);

        if (codePoint === undefined) break;

        const character = String.fromCodePoint(codePoint);
        const endOffset = offset + character.length;

        const start: TextPoint = {
          node: textNode,
          offset,
        };

        const end: TextPoint = {
          node: textNode,
          offset,
        };

        appendCharacter(character, start, end);

        lastPosition = end;
        offset = endOffset;
      }
    } else if (node.nodeName === "BR" && lastPosition) {
      // PDF.js may represent line endings with <br>.
      appendCharacter(" ", lastPosition, lastPosition);
    }

    node = walker.nextNode();
  }

  const content = characters.join("");
  const ranges: Range[] = [];

  let activeRange: Range | null = null;
  let offset = 0;
  let matchIndex = 0;

  while (offset < content.length) {
    const index = content.indexOf(query, offset);

    if (index === -1) break;

    const start = starts[index];
    const end = ends[index + query.length - 1];

    if (!start || !end) break;

    const isActive = matchIndex === activeMatchIndex;

    const canAddGeneralHighlight = ranges.length < MAX_VISIBLE_HIGHLIGHTS;

    if (canAddGeneralHighlight || isActive) {
      const range = document.createRange();

      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);

      if (canAddGeneralHighlight) {
        ranges.push(range);
      }

      if (isActive) {
        activeRange = range;
      }
    }

    matchIndex++;
    offset = index + query.length;
  }

  if (ranges.length > 0) {
    CSS.highlights.set(SEARCH_HIGHLIGHT_NAME, new Highlight(...ranges));
  }

  if (activeRange) {
    const activeHighlight = new Highlight(activeRange);

    // The selected match wins when highlights overlap.
    activeHighlight.priority = 1;

    CSS.highlights.set(ACTIVE_HIGHLIGHT_NAME, activeHighlight);

    onActiveMatchReady?.(activeRange);
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function CanvasRenderer({
  document,
  pageNumber,
  zoom,
  highlightQuery,
  activeMatchIndex,
  onActiveMatchReady,
  availableWidth,
  onError,
  onCanvasLayout,
}: CanvasRendererProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);

  const highlightedContainerRef = useRef<HTMLDivElement | null>(null);
  const currentQueryRef = useRef(highlightQuery);

  const currentActiveMatchIndexRef = useRef(activeMatchIndex);
  const currentActiveMatchReadyRef = useRef(onActiveMatchReady);

  useEffect(() => {
    let cancelled = false;

    let renderTask: ReturnType<PDFPageProxy["render"]> | null = null;

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
        throw new Error("El PDF contiene dimensiones de página inválidas.");
      }

      const targetWidth = Math.min(
        Math.max(1, availableWidth),
        MAX_PAGE_WIDTH,
      );

      const fitScale = Math.min(1.5, targetWidth / baseViewport.width);

      const scale = fitScale * (zoom ?? 1);

      const viewport = page.getViewport({ scale });

      const requestedRatio = Math.min(
        window.devicePixelRatio || 1,
        MAX_PIXEL_RATIO,
      );

      const memoryRatio = Math.sqrt(
        MAX_CANVAS_PIXELS / (viewport.width * viewport.height),
      );

      const ratio = Math.min(requestedRatio, memoryRatio);

      if (!Number.isFinite(ratio) || ratio <= 0) {
        throw new Error("No se pudo calcular la resolución de la página.");
      }

      canvas.width = Math.max(1, Math.floor(viewport.width * ratio));

      canvas.height = Math.max(1, Math.floor(viewport.height * ratio));

      // Canvas and text layer share one coordinate system.
      frame.style.width = `${viewport.width}px`;
      frame.style.height = `${viewport.height}px`;

      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      textContainer.style.setProperty(
        "--total-scale-factor",
        String(viewport.scale),
      );

      textContainer.style.setProperty("--scale-round-x", "1px");

      textContainer.style.setProperty("--scale-round-y", "1px");

      // Preserve the visible point when zoom changes.
      onCanvasLayout?.();

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

      if (cancelled) return;

      // Text selection is added after the visual page
      // has finished rendering.
      textLayer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: textContainer,
        viewport,
      });

      await textLayer.render();

      if (cancelled) return;

      highlightedContainerRef.current = textContainer;

      highlightPageText(
        textContainer,
        currentQueryRef.current,
        currentActiveMatchIndexRef.current,
        currentActiveMatchReadyRef.current,
      );
    }

    void renderPage().catch((error: unknown) => {
      if (
        cancelled ||
        (error instanceof Error &&
          (error.name === "RenderingCancelledException" ||
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

      highlightedContainerRef.current = null;
      clearSearchHighlights();
    };
  }, [document, pageNumber, zoom, availableWidth, onError, onCanvasLayout]);

  useEffect(() => {
    currentQueryRef.current = highlightQuery;
    currentActiveMatchIndexRef.current = activeMatchIndex;
    currentActiveMatchReadyRef.current = onActiveMatchReady;

    const container = highlightedContainerRef.current;

    if (container) {
      highlightPageText(
        container,
        highlightQuery,
        activeMatchIndex,
        onActiveMatchReady,
      );
    } else {
      clearSearchHighlights();
    }

    return () => {
      clearSearchHighlights();
    };
  }, [highlightQuery, activeMatchIndex, onActiveMatchReady]);

  return (
    <div ref={frameRef} className="pdf-page-frame">
      <canvas
        ref={canvasRef}
        aria-label={`Página ${pageNumber} del PDF`}
        role="img"
        className="pdf-page-canvas"
      />

      <div ref={textLayerRef} className="pdf-text-layer textLayer" />
    </div>
  );
}

export function PdfCanvasPage({
  document,
  pageNumber,
  zoom,
  highlightQuery,
  activeMatchIndex,
  onActiveMatchReady,
  onError,
  onCanvasLayout,
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
          key={[
            document.fingerprints[0],
            pageNumber,
            availableWidth,
            zoom ?? "fit",
          ].join("-")}
          document={document}
          pageNumber={pageNumber}
          zoom={zoom}
          highlightQuery={highlightQuery}
          availableWidth={availableWidth}
          onError={onError}
          activeMatchIndex={activeMatchIndex}
          onActiveMatchReady={onActiveMatchReady}
          onCanvasLayout={onCanvasLayout}
        />
      )}
    </div>
  );
}
