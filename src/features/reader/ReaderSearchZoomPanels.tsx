import type { RefObject } from "react";

export type ReaderZoomControls = {
  value: number | null;
  min: number;
  max: number;
  onIncrease: () => void;
  onDecrease: () => void;
  onFit: () => void;
};

export type ReaderSearchControls = {
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

type ReaderSearchPanelProps = {
  search: ReaderSearchControls;
  searchInputRef: RefObject<HTMLInputElement | null>;
  loading: boolean;
};

export function ReaderSearchPanel({
  search,
  searchInputRef,
  loading,
}: ReaderSearchPanelProps) {
  return (
    <div
      id="reader-panel-search"
      role="tabpanel"
      aria-labelledby="reader-tab-search"
      className="reader-tools__content"
    >
      <h2 className="reader-tools__title">Buscar en el PDF</h2>

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
            Palabra o frase
          </label>

          <div className="reader-search__input-group">
            <input
              ref={searchInputRef}
              id="reader-search-input"
              type="search"
              className="reader-search__input"
              placeholder="Buscar..."
              value={search.query}
              autoComplete="off"
              aria-keyshortcuts="Control+F Meta+F"
              onChange={(event) => search.onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;

                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
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
                  : "Introduce un término para buscar"}
          </span>

          {search.status === "done" && search.pagesWithMatches > 0 && (
            <div className="reader-search__navigation">
              <span className="reader-search__counter">
                Coincidencia {search.selectedIndex + 1} de {search.totalMatches}
              </span>

              <button
                type="button"
                className="reader-button reader-button--icon"
                aria-label="Resultado anterior"
                onClick={search.onPrevious}
                disabled={search.totalMatches <= 1}
              >
                ‹
              </button>

              <button
                type="button"
                className="reader-button reader-button--icon"
                aria-label="Resultado siguiente"
                onClick={search.onNext}
                disabled={search.totalMatches <= 1}
              >
                ›
              </button>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

type ReaderZoomPanelProps = {
  zoom: ReaderZoomControls;
  isEpub: boolean;
  loading: boolean;
};

export function ReaderZoomPanel({
  zoom,
  isEpub,
  loading,
}: ReaderZoomPanelProps) {
  return (
    <div
      id="reader-panel-zoom"
      role="tabpanel"
      aria-labelledby="reader-tab-zoom"
      className="reader-tools__content"
    >
      <h2 className="reader-tools__title">
        {isEpub ? "Tamaño de lectura" : "Escala del documento"}
      </h2>

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
          disabled={loading || (zoom.value !== null && zoom.value <= zoom.min)}
        >
          −
        </button>

        <output className="reader-zoom__value" aria-live="polite">
          {zoom.value === null
            ? isEpub
              ? "100%"
              : "Ajustado"
            : `${Math.round(zoom.value * 100)}%`}
        </output>

        <button
          type="button"
          className="reader-button reader-button--icon"
          aria-label="Ampliar zoom"
          onClick={zoom.onIncrease}
          disabled={loading || (zoom.value !== null && zoom.value >= zoom.max)}
        >
          +
        </button>
      </div>

      <button
        type="button"
        className="reader-button reader-tools__fit"
        onClick={zoom.onFit}
        aria-pressed={zoom.value === null}
        disabled={loading}
      >
        {isEpub ? "Restablecer tamaño (100%)" : "Ajustar a la ventana"}
      </button>
    </div>
  );
}
