
import type { ReactNode } from "react";
import "./ReaderShell.css";

type ReaderZoomControls = {
  value: number | null;
  min: number;
  max: number;
  onIncrease: () => void;
  onDecrease: () => void;
  onFit: () => void;
};

type ReaderShellProps = {
  title: string;
  loading: boolean;
  error: string | null;

  documentKey: string | null;
  pageNumber: number | null;
  pageCount: number | null;

  zoom?: ReaderZoomControls;

  onSelectFile: () => void;
  onPrevious: () => void;
  onNext: () => void;

  children: ReactNode;
};

export function ReaderShell({
  title,
  loading,
  error,
  documentKey,
  pageNumber,
  pageCount,
  zoom,
  onSelectFile,
  onPrevious,
  onNext,
  children,
}: ReaderShellProps) {
  const hasDocument =
    pageNumber !== null && pageCount !== null;

  return (
    <main className="reader-shell">
      <header className="reader-header">
        <div className="reader-brand">
          <span className="reader-brand__name">
            {title}
          </span>
          <span className="reader-brand__subtitle">
            Lector digital
          </span>
        </div>

        <button
          type="button"
          className="reader-button reader-button--primary"
          onClick={onSelectFile}
          disabled={loading}
        >
          {loading ? "Abriendo..." : "Abrir PDF"}
        </button>
      </header>

      {hasDocument && (
        <div className="reader-toolbar">
          <nav
            className="reader-navigation"
            aria-label="Navegación de lectura"
          >
            <button
              type="button"
              className="reader-button"
              onClick={onPrevious}
              disabled={pageNumber <= 1 || loading}
            >
              Anterior
            </button>

            <span
              className="reader-navigation__progress"
              aria-live="polite"
            >
              {pageNumber} / {pageCount}
            </span>

            <button
              type="button"
              className="reader-button"
              onClick={onNext}
              disabled={pageNumber >= pageCount || loading}
            >
              Siguiente
            </button>
          </nav>

          {zoom && (
            <div
              className="reader-zoom"
              role="group"
              aria-label="Zoom del documento"
            >
              <button
                type="button"
                className="reader-button reader-button--icon"
                aria-label="Reducir zoom"
                onClick={zoom.onDecrease}
                disabled={
                  loading ||
                  (zoom.value !== null &&
                    zoom.value <= zoom.min)
                }
              >
                −
              </button>

              <output
                className="reader-zoom__value"
                aria-live="polite"
              >
                {zoom.value === null
                  ? "Ajustado"
                  : `${Math.round(zoom.value * 100)}%`}
              </output>

              <button
                type="button"
                className="reader-button reader-button--icon"
                aria-label="Ampliar zoom"
                onClick={zoom.onIncrease}
                disabled={
                  loading ||
                  (zoom.value !== null &&
                    zoom.value >= zoom.max)
                }
              >
                +
              </button>

              <button
                type="button"
                className="reader-button"
                onClick={zoom.onFit}
                aria-pressed={zoom.value === null}
                disabled={loading}
              >
                Ajustar
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="reader-error" role="alert">
          {error}
        </p>
      )}

      <section
        key={`${documentKey ?? "empty"}-${pageNumber ?? 0}`}
        className="reader-viewport"
        aria-label="Contenido del documento"
      >
        {loading ? (
          <p className="reader-message">
            Preparando documento...
          </p>
        ) : children ? (
          children
        ) : (
          <div className="reader-empty">
            <h1>Tu próxima lectura comienza aquí</h1>
            <p>Selecciona un PDF para comenzar a leer.</p>
          </div>
        )}
      </section>
    </main>
  );
}
