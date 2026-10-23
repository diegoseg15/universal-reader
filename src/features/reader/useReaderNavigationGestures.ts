import { useEffect, useRef, type TouchEvent } from "react";

type UseReaderNavigationGesturesParams = {
  enabled: boolean;
  pageNumber: number | null;
  pageCount: number | null;
  onPrevious: () => void;
  onNext: () => void;
};

const MIN_SWIPE_DISTANCE_PX = 56;
const MAX_VERTICAL_DRIFT_PX = 72;
const HORIZONTAL_DOMINANCE_RATIO = 1.5;

type TouchStartSnapshot = {
  x: number;
  y: number;
  scrollLeft: number;
  atLeftEdge: boolean;
  atRightEdge: boolean;
  multiTouch: boolean;
};

function isInteractiveElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    Boolean(
      target.closest("input, select, textarea, button, a, [role='slider']"),
    )
  );
}

export function useReaderNavigationGestures({
  enabled,
  pageNumber,
  pageCount,
  onPrevious,
  onNext,
}: UseReaderNavigationGesturesParams) {
  const touchStartRef = useRef<TouchStartSnapshot | null>(null);

  const canGoPrevious =
    enabled && pageNumber !== null && pageCount !== null && pageNumber > 1;
  const canGoNext =
    enabled &&
    pageNumber !== null &&
    pageCount !== null &&
    pageNumber < pageCount;

  useEffect(() => {
    if (!enabled || pageNumber === null || pageCount === null) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
      ) {
        return;
      }

      if (isInteractiveElement(event.target)) {
        return;
      }

      if (event.key === "ArrowLeft" && canGoPrevious) {
        event.preventDefault();
        onPrevious();
      } else if (event.key === "ArrowRight" && canGoNext) {
        event.preventDefault();
        onNext();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled, pageNumber, pageCount, canGoPrevious, canGoNext, onPrevious, onNext]);

  function onTouchStart(event: TouchEvent<HTMLElement>): void {
    if (
      !enabled ||
      event.touches.length !== 1 ||
      isInteractiveElement(event.target)
    ) {
      touchStartRef.current = null;
      return;
    }

    const viewport = event.currentTarget;
    const touch = event.touches[0];
    const maxScrollLeft = Math.max(
      0,
      viewport.scrollWidth - viewport.clientWidth,
    );

    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      scrollLeft: viewport.scrollLeft,
      atLeftEdge: viewport.scrollLeft <= 2,
      atRightEdge: viewport.scrollLeft >= maxScrollLeft - 2,
      multiTouch: false,
    };
  }

  function onTouchMove(event: TouchEvent<HTMLElement>): void {
    if (touchStartRef.current && event.touches.length > 1) {
      touchStartRef.current.multiTouch = true;
    }
  }

  function onTouchEnd(event: TouchEvent<HTMLElement>): void {
    const snapshot = touchStartRef.current;
    touchStartRef.current = null;

    if (
      !enabled ||
      !snapshot ||
      snapshot.multiTouch ||
      event.changedTouches.length !== 1
    ) {
      return;
    }

    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0) {
      return;
    }

    const viewport = event.currentTarget;
    if (Math.abs(viewport.scrollLeft - snapshot.scrollLeft) > 8) {
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - snapshot.x;
    const deltaY = touch.clientY - snapshot.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (
      absX < MIN_SWIPE_DISTANCE_PX ||
      absY > MAX_VERTICAL_DRIFT_PX ||
      absX < absY * HORIZONTAL_DOMINANCE_RATIO
    ) {
      return;
    }

    // Swipe left-to-right (deltaX > 0): go to previous page/section.
    if (deltaX > 0 && snapshot.atLeftEdge && canGoPrevious) {
      onPrevious();
      return;
    }

    // Swipe right-to-left (deltaX < 0): go to next page/section.
    if (deltaX < 0 && snapshot.atRightEdge && canGoNext) {
      onNext();
    }
  }

  function onTouchCancel(): void {
    touchStartRef.current = null;
  }

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
  };
}
