import { useEffect, useRef, useState } from "react";

type ReaderBottomNavigationProps = {
  pageNumber: number;
  pageCount: number;
  unit: "página" | "sección";
  loading: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onGoToPage: (page: number) => void;
};

const SLIDER_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

export function ReaderBottomNavigation({
  pageNumber,
  pageCount,
  unit,
  loading,
  onPrevious,
  onNext,
  onGoToPage,
}: ReaderBottomNavigationProps) {
  const [previewPage, setPreviewPage] = useState<number | null>(null);

  const pendingPageRef = useRef<number | null>(null);

  useEffect(() => {
    pendingPageRef.current = null;
    setPreviewPage(null);
  }, [pageNumber, pageCount]);

  const displayedPage = previewPage ?? pageNumber;

  function previewSelection(value: number): void {
    pendingPageRef.current = value;
    setPreviewPage(value);
  }

  function cancelSelection(): void {
    pendingPageRef.current = null;
    setPreviewPage(null);
  }

  function commitSelection(): void {
    const selected = pendingPageRef.current;

    cancelSelection();

    if (selected === null || loading) return;

    const target = Math.max(1, Math.min(pageCount, Math.round(selected)));

    if (target !== pageNumber) {
      onGoToPage(target);
    }
  }

  return (
    <nav
      className="reader-bottom-navigation"
      aria-label="Navegación del documento"
    >
      <button
        type="button"
        className="reader-bottom-navigation__button"
        aria-label={`${unit} anterior`}
        title={`${unit} anterior`}
        onClick={onPrevious}
        disabled={loading || pageNumber <= 1}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>

      <output className="reader-bottom-navigation__number" aria-live="off">
        {displayedPage}
      </output>

      <input
        type="range"
        className="reader-bottom-navigation__slider"
        min={1}
        max={Math.max(1, pageCount)}
        step={1}
        value={displayedPage}
        disabled={loading || pageCount <= 1}
        aria-label={`Ir a ${unit}`}
        aria-valuetext={`${displayedPage} de ${pageCount}`}
        onChange={(event) => {
          previewSelection(Number(event.currentTarget.value));
        }}
        onPointerUp={commitSelection}
        onPointerCancel={cancelSelection}
        onKeyUp={(event) => {
          if (SLIDER_KEYS.has(event.key)) {
            commitSelection();
          }
        }}
        onBlur={commitSelection}
      />

      <output
        className="reader-bottom-navigation__number"
        aria-label={`Total de ${unit}s`}
        aria-live="off"
      >
        {pageCount}
      </output>

      <button
        type="button"
        className="reader-bottom-navigation__button"
        aria-label={`${unit} siguiente`}
        title={`${unit} siguiente`}
        onClick={onNext}
        disabled={loading || pageNumber >= pageCount}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </nav>
  );
}
