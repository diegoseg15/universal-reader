import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

type ZoomAnchor = {
  x: number;
  y: number;
};

type SearchMatchState = {
  status: "idle" | "searching" | "done" | "error";
  query: string;
  selectedIndex: number;
  activeMatch: { pageNumber: number; indexOnPage: number } | null;
};

export function usePdfViewport(
  document: PDFDocumentProxy | null,
  pageNumber: number,
  viewportRef: RefObject<HTMLElement | null>,
  search: SearchMatchState,
) {
  const [zoom, setZoom] = useState<number | null>(null);
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null);
  const lastCenteredMatchRef = useRef<string | null>(null);

  const activeMatchIndex =
    search.status === "done" && search.activeMatch?.pageNumber === pageNumber
      ? search.activeMatch.indexOnPage
      : null;

  const activeMatchKey =
    activeMatchIndex !== null
      ? [document?.fingerprints[0], search.query, search.selectedIndex].join(":")
      : null;

  useEffect(() => {
    if (search.status !== "done") {
      lastCenteredMatchRef.current = null;
    }
  }, [search.status]);

  const clearZoomAnchor = useCallback((): void => {
    zoomAnchorRef.current = null;
  }, []);

  const resetViewportState = useCallback((): void => {
    zoomAnchorRef.current = null;
    lastCenteredMatchRef.current = null;
    setZoom(null);
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
  }, [viewportRef]);

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

      viewport.scrollLeft += matchCenterX - viewportCenterX;
      viewport.scrollTop += matchCenterY - viewportCenterY;

      lastCenteredMatchRef.current = activeMatchKey;
    },
    [activeMatchKey, viewportRef],
  );

  const zoomControls = document
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
    : undefined;

  return {
    zoom,
    zoomControls,
    activeMatchIndex,
    clearZoomAnchor,
    resetViewportState,
    restoreZoomPosition,
    centerActiveMatch,
  };
}
