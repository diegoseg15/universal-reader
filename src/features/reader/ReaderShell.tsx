import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";

import {
  ReaderTools,
  type ReaderSearchControls,
  type ReaderToolTab,
  type ReaderZoomControls,
  type ReaderEpubTools,
} from "./ReaderTools";

import "./ReaderShell.css";

import { ReaderBottomNavigation } from "./ReaderBottomNavigation";
import { useReaderNavigationGestures } from "./useReaderNavigationGestures";

import { SlidersHorizontalIcon } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { CaretLeftIcon } from "@phosphor-icons/react";

type ReaderShellProps = {
  title: string;
  loading: boolean;
  error: string | null;

  documentKey: string | null;
  pageNumber: number | null;
  pageCount: number | null;

  zoom?: ReaderZoomControls;
  search?: ReaderSearchControls;

  epubTools?: ReaderEpubTools;

  viewportRef?: Ref<HTMLElement>;

  navigationUnit: "página" | "sección";
  onGoToPage: (page: number) => void;

  bookTitle?: string | null;
  chapterTitle?: string | null;
  bookAuthor?: string | null;

  onReturnHome: () => void;

  onSelectFile: () => void;
  onPrevious: () => void;
  onNext: () => void;

  children: ReactNode;
};

const MOBILE_QUERY = "(max-width: 800px)";

export function ReaderShell({
  title,
  loading,
  error,
  documentKey,
  pageNumber,
  pageCount,
  navigationUnit,
  zoom,
  search,
  epubTools,
  viewportRef,
  onSelectFile,
  onPrevious,
  onNext,
  onGoToPage,
  bookTitle,
  chapterTitle,
  bookAuthor,
  onReturnHome,
  children,
}: ReaderShellProps) {
  const hasDocument = pageNumber !== null && pageCount !== null;

  const hasTools =
    hasDocument &&
    (zoom !== undefined || search !== undefined || epubTools !== undefined);

  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia(MOBILE_QUERY).matches,
  );

  const [toolsOpen, setToolsOpen] = useState(true);

  const [activeTab, setActiveTab] = useState<ReaderToolTab>("search");

  const searchInputRef = useRef<HTMLInputElement>(null);
  const toolsPanelRef = useRef<HTMLElement>(null);
  const toolsTriggerRef = useRef<HTMLButtonElement>(null);

  const searchAvailable = hasDocument && search !== undefined && !loading;

  const swipeHandlers = useReaderNavigationGestures({
    enabled: hasDocument && !loading,
    pageNumber,
    pageCount,
    onPrevious,
    onNext,
  });

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);

    function handleChange(): void {
      setIsMobile(media.matches);
    }

    media.addEventListener("change", handleChange);

    return () => {
      media.removeEventListener("change", handleChange);
    };
  }, []);

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

      setActiveTab("search");
      setToolsOpen(true);

      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    }

    window.addEventListener("keydown", handleSearchShortcut, true);

    return () => {
      window.removeEventListener("keydown", handleSearchShortcut, true);
    };
  }, [searchAvailable]);

  useEffect(() => {
    if (!toolsOpen || !hasTools) return;

    function handleEscape(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.key !== "Escape") return;
      if (!toolsPanelRef.current?.contains(document.activeElement)) return;
      setToolsOpen(false);
      toolsTriggerRef.current?.focus();
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [toolsOpen, hasTools]);

  function closeTools(): void {
    setToolsOpen(false);
    toolsTriggerRef.current?.focus();
  }

  return (
    <main
      className={`reader-shell${hasTools && toolsOpen ? " reader-shell--tools-open" : ""}`}
    >
      <header className="reader-header">
        <div className="reader-header__identity">
          {hasDocument ? (
            <button
              type="button"
              className="reader-header__home"
              onClick={onReturnHome}
              disabled={loading}
              aria-label="Volver al inicio"
              title="Volver al inicio"
            >
              <CaretLeftIcon size={22} weight="regular" aria-hidden="true" />

              <span className="reader-brand__name">{title}</span>
            </button>
          ) : (
            <span className="reader-brand__name">{title}</span>
          )}
        </div>

        {hasDocument && (
          <div
            className="reader-header__metadata"
            aria-label="Documento actual"
          >
            <span
              className="reader-header__document-title"
              title={bookTitle ?? undefined}
            >
              {bookTitle ?? "Documento"}
            </span>

            {chapterTitle && (
              <strong
                className="reader-header__chapter-title"
                title={chapterTitle}
              >
                {chapterTitle}
              </strong>
            )}

            {bookAuthor && (
              <span className="reader-header__author">{bookAuthor}</span>
            )}
          </div>
        )}

        {hasTools && (
          <button
            ref={toolsTriggerRef}
            type="button"
            className="reader-header__icon"
            aria-label={
              toolsOpen ? "Ocultar herramientas" : "Mostrar herramientas"
            }
            title="Herramientas de lectura"
            aria-expanded={toolsOpen}
            aria-controls="reader-tools-panel"
            onClick={() => setToolsOpen((open) => !open)}
          >
            <SlidersHorizontalIcon
              size={23}
              weight="regular"
              aria-hidden="true"
            />
          </button>
        )}
      </header>

      {error && (
        <p className="reader-error" role="alert">
          {error}
        </p>
      )}

      <div
        className={
          hasTools && toolsOpen
            ? "reader-workspace"
            : "reader-workspace reader-workspace--solo"
        }
      >
        <section
          ref={viewportRef}
          key={`${documentKey ?? "empty"}-${
            epubTools ? epubTools.sectionIndex : (pageNumber ?? 0)
          }`}
          className="reader-viewport"
          aria-label="Contenido del documento"
          {...swipeHandlers}
        >
          {loading ? (
            <p className="reader-message">Preparando documento...</p>
          ) : children ? (
            children
          ) : (
            <div className="reader-empty">
              <h1>Tu próxima lectura comienza aquí</h1>

              <p>Abre un documento PDF o EPUB y continúa leyendo a tu ritmo.</p>

              <button
                type="button"
                className="reader-button reader-button--primary reader-empty__open"
                onClick={onSelectFile}
                disabled={loading}
              >
                <FolderOpenIcon size={22} weight="regular" aria-hidden="true" />
                Abrir documento
              </button>
            </div>
          )}
        </section>

        {hasTools && (
          <aside
            ref={toolsPanelRef}
            id="reader-tools-panel"
            className="reader-tools"
            aria-label="Herramientas de lectura"
            role="complementary"
            tabIndex={-1}
            hidden={!toolsOpen}
          >
            <div className="reader-tools__header">
              <div className="reader-tools__heading">
                <span className="reader-tools__eyebrow">A TU RITMO</span>
                <h2>Tu espacio de lectura</h2>
              </div>

              <button
                type="button"
                className="reader-button reader-tools__close"
                data-reader-tools-close
                onClick={closeTools}
                aria-label="Cerrar panel de herramientas"
              >
                ×
              </button>
            </div>

            <ReaderTools
              zoom={zoom}
              search={search}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              searchInputRef={searchInputRef}
              loading={loading}
              epubTools={
                epubTools
                  ? {
                      ...epubTools,
                      onNavigateSection: (index) => {
                        epubTools.onNavigateSection(index);

                        if (isMobile) {
                          closeTools();
                        }
                      },
                    }
                  : undefined
              }
            />
          </aside>
        )}
      </div>

      {pageNumber !== null &&
        pageCount !== null &&
        (isMobile || !hasTools || toolsOpen) && (
          <ReaderBottomNavigation
            key={documentKey ?? "document"}
            pageNumber={pageNumber}
            pageCount={pageCount}
            unit={navigationUnit}
            loading={loading}
            onPrevious={onPrevious}
            onNext={onNext}
            onGoToPage={onGoToPage}
          />
        )}
    </main>
  );
}
