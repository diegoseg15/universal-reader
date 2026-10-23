import type { RefObject } from "react";
import {
  MagnifyingGlassIcon,
  MagnifyingGlassPlusIcon,
  ListBulletsIcon,
  TextAaIcon,
} from "@phosphor-icons/react";

import type { EpubTocEntry } from "./epub/EpubSource";

import {
  DEFAULT_EPUB_APPEARANCE,
  type EpubAppearance,
} from "./epub/EpubAppearance";

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

export type ReaderToolTab = "search" | "zoom" | "toc" | "appearance";

type ReaderToolsProps = {
  zoom?: ReaderZoomControls;
  search?: ReaderSearchControls;
  activeTab: ReaderToolTab;
  onTabChange: (tab: ReaderToolTab) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  epubTools?: ReaderEpubTools;
  loading: boolean;
};

export type ReaderEpubTools = {
  toc: EpubTocEntry[];
  sectionIndex: number;
  onNavigateSection: (index: number) => void;
  appearance: EpubAppearance;
  onAppearanceChange: (value: EpubAppearance) => void;
};

export function ReaderTools({
  zoom,
  search,
  activeTab,
  onTabChange,
  searchInputRef,
  loading,
  epubTools,
}: ReaderToolsProps) {
  const availableTabs: ReaderToolTab[] = [];

  if (search) availableTabs.push("search");
  if (zoom) availableTabs.push("zoom");

  if (epubTools) {
    if (epubTools.toc.length > 0) {
      availableTabs.push("toc");
    }

    availableTabs.push("appearance");
  }

  const selectedTab = availableTabs.includes(activeTab)
    ? activeTab
    : (availableTabs[0] ?? "search");

  const tabLabels: Record<ReaderToolTab, string> = {
    search: "Buscar",
    zoom: "Zoom",
    toc: "Índice",
    appearance: "Apariencia",
  };

  const tabIcons = {
    search: MagnifyingGlassIcon,
    zoom: MagnifyingGlassPlusIcon,
    toc: ListBulletsIcon,
    appearance: TextAaIcon,
  };

  return (
    <>
      <div
        className="reader-tools__tabs"
        role="tablist"
        aria-label="Herramientas del documento"
        style={{
          gridTemplateColumns: `repeat(${availableTabs.length}, minmax(0, 1fr))`,
        }}
      >
        {availableTabs.map((tab) => {
          const Icon = tabIcons[tab];
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`reader-tab-${tab}`}
              aria-controls={`reader-panel-${tab}`}
              aria-selected={selectedTab === tab}
              className="reader-button reader-tools__tab"
              onClick={() => onTabChange(tab)}
            >
              <Icon size={20} aria-hidden="true" />
              <span>{tabLabels[tab]}</span>
            </button>
          );
        })}
      </div>

      {epubTools && selectedTab === "toc" && (
        <section
          id="reader-panel-toc"
          role="tabpanel"
          aria-labelledby="reader-tab-toc"
          className="reader-tools__content"
        >
          <h2 className="reader-tools__title">Índice del libro</h2>

          <nav
            aria-label="Índice de capítulos EPUB"
            style={{
              display: "grid",
              gap: "4px",
              maxHeight: "65dvh",
              overflowY: "auto",
              minWidth: 0,
            }}
          >
            {epubTools.toc.map((entry) => {
              const target = entry.sectionIndex;

              const isCurrent =
                target !== null && target === epubTools.sectionIndex;

              const indentation = Math.min(entry.depth, 4) * 12;

              return (
                <div
                  key={entry.id}
                  style={{
                    minWidth: 0,
                    paddingLeft: `${indentation}px`,
                  }}
                >
                  {target === null ? (
                    <span
                      style={{
                        display: "block",
                        padding: "10px 8px",
                        color: "var(--reader-secondary)",
                        fontSize: "13px",
                        fontWeight: 600,
                        overflowWrap: "anywhere",
                      }}
                    >
                      {entry.title}
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-current={isCurrent ? "location" : undefined}
                      onClick={() => epubTools.onNavigateSection(target)}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "10px 8px",
                        background: isCurrent
                          ? "var(--reader-active-bg)"
                          : "transparent",
                        color: "var(--reader-text)",
                        border: isCurrent
                          ? "1px solid var(--reader-border)"
                          : "1px solid transparent",
                        borderRadius: "8px",
                        textAlign: "left",
                        font: "inherit",
                        fontSize: "13px",
                        cursor: "pointer",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {entry.title}
                    </button>
                  )}
                </div>
              );
            })}
          </nav>
        </section>
      )}

      {epubTools && selectedTab === "appearance" && (
        <section
          id="reader-panel-appearance"
          role="tabpanel"
          aria-labelledby="reader-tab-appearance"
          className="reader-tools__content"
        >
          <h2 className="reader-tools__title">Apariencia de lectura</h2>

          <label
            style={{
              display: "grid",
              gap: "10px",
              fontSize: "13px",
            }}
          >
            <span>Tamaño de texto: {epubTools.appearance.fontSize} px</span>

            <input
              type="range"
              min={10}
              max={28}
              step={1}
              value={epubTools.appearance.fontSize}
              onChange={(event) => {
                epubTools.onAppearanceChange({
                  ...epubTools.appearance,
                  fontSize: Number(event.currentTarget.value),
                });
              }}
              style={{
                width: "100%",
                accentColor: "var(--reader-accent)",
              }}
            />
          </label>

          <label
            style={{
              display: "grid",
              gap: "10px",
              fontSize: "13px",
            }}
          >
            <span>Tipografía</span>

            <select
              value={epubTools.appearance.fontFamily}
              onChange={(event) => {
                const value = event.currentTarget.value;

                if (value !== "serif" && value !== "sans") {
                  return;
                }

                epubTools.onAppearanceChange({
                  ...epubTools.appearance,
                  fontFamily: value,
                });
              }}
              style={{
                minHeight: "44px",
                width: "100%",
                padding: "10px",
                border: "1px solid var(--reader-border)",
                borderRadius: "8px",
                background: "var(--reader-surface)",
                color: "var(--reader-text)",
                font: "inherit",
                fontSize: "13px",
              }}
            >
              <option value="serif">Con serifas</option>
              <option value="sans">Sin serifas</option>
            </select>
          </label>

          <label
            style={{
              display: "grid",
              gap: "10px",
              fontSize: "13px",
            }}
          >
            <span>
              Interlineado: {epubTools.appearance.lineHeight.toFixed(1)}
            </span>

            <input
              type="range"
              min={1.4}
              max={2.1}
              step={0.1}
              value={epubTools.appearance.lineHeight}
              onChange={(event) => {
                epubTools.onAppearanceChange({
                  ...epubTools.appearance,
                  lineHeight: Number(
                    Number(event.currentTarget.value).toFixed(1),
                  ),
                });
              }}
              style={{
                width: "100%",
                accentColor: "var(--reader-accent)",
              }}
            />
          </label>

          <button
            type="button"
            className="reader-button"
            onClick={() =>
              epubTools.onAppearanceChange({
                ...DEFAULT_EPUB_APPEARANCE,
              })
            }
          >
            Restablecer apariencia
          </button>
        </section>
      )}

      {search && selectedTab === "search" && (
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
                    Coincidencia {search.selectedIndex + 1} de{" "}
                    {search.totalMatches}
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
      )}

      {zoom && selectedTab === "zoom" && (
        <div
          id="reader-panel-zoom"
          role="tabpanel"
          aria-labelledby="reader-tab-zoom"
          className="reader-tools__content"
        >
          <h2 className="reader-tools__title">
            {epubTools ? "Tamaño de lectura" : "Escala del documento"}
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
              disabled={
                loading || (zoom.value !== null && zoom.value <= zoom.min)
              }
            >
              −
            </button>

            <output className="reader-zoom__value" aria-live="polite">
              {zoom.value === null
                ? epubTools
                  ? "100%"
                  : "Ajustado"
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
          </div>

          <button
            type="button"
            className="reader-button reader-tools__fit"
            onClick={zoom.onFit}
            aria-pressed={zoom.value === null}
            disabled={loading}
          >
            {epubTools ? "Restablecer tamaño (100%)" : "Ajustar a la ventana"}
          </button>
        </div>
      )}
    </>
  );
}
