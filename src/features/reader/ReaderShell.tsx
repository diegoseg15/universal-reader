import { useEffect, useRef, type ReactNode, type Ref } from "react";
import "./ReaderShell.css";

type ReaderZoomControls = {
  value: number | null;
  min: number;
  max: number;
  onIncrease: () => void;
  onDecrease: () => void;
  onFit: () => void;
};

type ReaderSearchControls = {
  query: string;
  status: "idle" | "searching" | "done" | "error";

  scannedPages: number;
  totalPages: number;
  pagesWithMatches: number;
  totalMatches: number;
  selectedIndex: number;

  error: string | null;

  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onPrevious: () => void;
  onNext: () => void;
};

type ReaderShellProps = {
  title: string;
  loading: boolean;
  error: string | null;

  documentKey: string | null;
  pageNumber: number | null;
  pageCount: number | null;

  zoom?: ReaderZoomControls;

  search?: ReaderSearchControls;

  viewportRef?: Ref<HTMLElement>;

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
  search,
  viewportRef,
  onSelectFile,
  onPrevious,
  onNext,
  children,
}: ReaderShellProps) {
  const hasDocument = pageNumber !== null && pageCount !== null;

  const searchInputRef = useRef<HTMLInputElement>(null);

  const searchAvailable = hasDocument && search !== undefined && !loading;

  useEffect(() => {
    if (!searchAvailable) return;

    function handleSearchShortcut(event: KeyboardEvent): void {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.shiftKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "f"
      ) {
        return;
      }

      event.preventDefault();

      const input = searchInputRef.current;

      input?.focus();
      input?.select();
    }

    window.addEventListener("keydown", handleSearchShortcut, true);

    return () => {
      window.removeEventListener("keydown", handleSearchShortcut, true);
    };
  }, [searchAvailable]);

  return (
    <main className="reader-shell">
      <header className="reader-header">
        <div className="reader-brand">
          <span className="reader-brand__name">{title}</span>
          <span className="reader-brand__subtitle">Lector digital</span>
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
          <nav className="reader-navigation" aria-label="Navegación de lectura">
            <button
              type="button"
              className="reader-button"
              onClick={onPrevious}
              disabled={pageNumber <= 1 || loading}
            >
              Anterior
            </button>

            <span className="reader-navigation__progress" aria-live="polite">
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
                  loading || (zoom.value !== null && zoom.value <= zoom.min)
                }
              >
                −
              </button>

              <output className="reader-zoom__value" aria-live="polite">
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
                  loading || (zoom.value !== null && zoom.value >= zoom.max)
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

      {hasDocument && search && (
        <form
          className="reader-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            search.onSearch();
          }}
        >
          <div className="reader-search__field">
            <label
              className="reader-search__label"
              htmlFor="reader-search-input"
            >
              Buscar en este PDF
            </label>

            <div className="reader-search__input-group">
              <input
                ref={searchInputRef}
                id="reader-search-input"
                type="search"
                className="reader-search__input"
                placeholder="Escribe una palabra o frase"
                value={search.query}
                onChange={(event) => search.onQueryChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) {
                    return;
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();

                    search.onQueryChange("");
                    event.currentTarget.blur();

                    return;
                  }

                  if (
                    event.key === "Enter" &&
                    search.status === "done" &&
                    search.totalMatches > 0
                  ) {
                    event.preventDefault();

                    if (event.shiftKey) {
                      search.onPrevious();
                    } else {
                      search.onNext();
                    }
                  }
                }}
                aria-keyshortcuts="Control+F Meta+F"
                autoComplete="off"
              />

              <button
                type="submit"
                className="reader-button reader-button--primary"
                disabled={
                  loading ||
                  search.status === "searching" ||
                  !search.query.trim()
                }
              >
                Buscar
              </button>
            </div>
          </div>

          <div className="reader-search__results">
            <span
              className="reader-search__status"
              role="status"
              aria-live="polite"
            >
              {search.status === "searching"
                ? `Buscando: ${search.scannedPages} de ${search.totalPages} páginas`
                : search.status === "error"
                  ? `Error: ${search.error ?? "No se pudo buscar"}`
                  : search.status === "done"
                    ? search.pagesWithMatches > 0
                      ? `${search.totalMatches} coincidencias en ${search.pagesWithMatches} páginas`
                      : "No se encontraron coincidencias"
                    : "Introduce un término y pulsa Buscar"}
            </span>

            {search.status === "done" && search.pagesWithMatches > 0 && (
              <div className="reader-search__navigation">
                <span className="reader-search__counter">
                  Coincidencia {search.selectedIndex + 1} de{" "}
                  {search.totalMatches}
                </span>

                <button
                  type="button"
                  className="reader-button reader-button--icon"
                  aria-label="Página anterior con resultados"
                  onClick={search.onPrevious}
                  disabled={search.totalMatches <= 1}
                >
                  ‹
                </button>

                <button
                  type="button"
                  className="reader-button reader-button--icon"
                  aria-label="Página siguiente con resultados"
                  onClick={search.onNext}
                  disabled={search.totalMatches <= 1}
                >
                  ›
                </button>
              </div>
            )}
          </div>
        </form>
      )}

      {error && (
        <p className="reader-error" role="alert">
          {error}
        </p>
      )}

      <section
        ref={viewportRef}
        key={`${documentKey ?? "empty"}-${pageNumber ?? 0}`}
        className="reader-viewport"
        aria-label="Contenido del documento"
      >
        {loading ? (
          <p className="reader-message">Preparando documento...</p>
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
