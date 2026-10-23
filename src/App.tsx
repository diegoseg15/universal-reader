import { useRef } from "react";

import { LibraryScreen } from "./features/library/LibraryScreen";
import { ReaderShell } from "./features/reader/ReaderShell";
import { useReaderSession } from "./features/reader/useReaderSession";
import { EpubChapter } from "./features/reader/epub/EpubChapter";
import { PdfCanvasPage } from "./features/reader/pdf/PdfCanvasPage";
import { usePdfSearch } from "./features/reader/pdf/usePdfSearch";
import { usePdfViewport } from "./features/reader/pdf/usePdfViewport";

function App() {
  const viewportRef = useRef<HTMLElement | null>(null);
  const resetPdfExtrasRef = useRef<() => void>(() => {});

  const {
    document,
    epub,
    epubSession,
    pdfFileName,
    pageNumber,
    setPageNumber,
    epubSectionIndex,
    setEpubSectionIndex,
    epubAppearance,
    setEpubAppearance,
    epubZoomControls,
    currentChapterTitle,
    loading,
    error,
    setError,
    selectDocument,
    returnHome,
  } = useReaderSession({
    onBeforeSwitch: () => resetPdfExtrasRef.current(),
  });

  const pdfSearch = usePdfSearch(document, (page) => {
    pdfViewport.clearZoomAnchor();
    setPageNumber(page);
  });

  const pdfViewport = usePdfViewport(
    document,
    pageNumber,
    viewportRef,
    pdfSearch,
  );

  resetPdfExtrasRef.current = () => {
    pdfSearch.clearSearch();
    pdfViewport.resetViewportState();
  };

  return (
    <>
      <div hidden={document !== null || epub !== null}>
        <LibraryScreen
          loading={loading}
          error={error}
          onOpenFile={() => void selectDocument()}
          onOpenBook={(book) => void selectDocument(book.path, book.name)}
        />
      </div>
      {(document !== null || epub !== null) && (
        <ReaderShell
          title="Universal Reader"
          loading={loading}
          error={error}
          documentKey={document?.fingerprints[0] ?? epub?.fileName ?? null}
          pageNumber={document ? pageNumber : epub ? epubSectionIndex + 1 : null}
          pageCount={document?.numPages ?? epub?.sectionCount ?? null}
          navigationUnit={document ? "página" : "sección"}
          onSelectFile={() => void selectDocument()}
          viewportRef={viewportRef}
          bookTitle={epub?.title ?? (document ? pdfFileName : null)}
          chapterTitle={currentChapterTitle}
          bookAuthor={epub?.author ?? null}
          onReturnHome={() => void returnHome()}
          onPrevious={() => {
            if (epub) {
              setEpubSectionIndex((current) => Math.max(0, current - 1));
              return;
            }

            pdfViewport.clearZoomAnchor();
            setPageNumber((current) => Math.max(1, current - 1));
          }}
          onNext={() => {
            if (epub) {
              setEpubSectionIndex((current) =>
                Math.min(epub.sectionCount - 1, current + 1),
              );
              return;
            }

            pdfViewport.clearZoomAnchor();
            setPageNumber((current) =>
              Math.min(document?.numPages ?? current, current + 1),
            );
          }}
          onGoToPage={(target) => {
            if (document) {
              pdfViewport.clearZoomAnchor();
              setPageNumber(Math.max(1, Math.min(document.numPages, target)));
              return;
            }

            if (epub) {
              setEpubSectionIndex(
                Math.max(0, Math.min(epub.sectionCount - 1, target - 1)),
              );
            }
          }}
          zoom={pdfViewport.zoomControls ?? epubZoomControls}
          search={
            document
              ? {
                  query: pdfSearch.query,
                  status: pdfSearch.status,
                  scannedPages: pdfSearch.scannedPages,
                  totalPages: document.numPages,
                  pagesWithMatches: pdfSearch.pages.length,
                  totalMatches: pdfSearch.totalMatches,
                  selectedIndex: pdfSearch.selectedIndex,
                  error: pdfSearch.error,
                  onQueryChange: pdfSearch.changeQuery,
                  onSearch: pdfSearch.search,
                  onPrevious: pdfSearch.previousResult,
                  onNext: pdfSearch.nextResult,
                }
              : undefined
          }
          epubTools={
            epub && epubSession
              ? {
                  toc: epubSession.toc,
                  sectionIndex: epubSectionIndex,
                  onNavigateSection: setEpubSectionIndex,
                  appearance: epubAppearance,
                  onAppearanceChange: setEpubAppearance,
                }
              : undefined
          }
        >
          {document ? (
            <PdfCanvasPage
              key={`${document.fingerprints[0]}-${pageNumber}`}
              document={document}
              pageNumber={pageNumber}
              zoom={pdfViewport.zoom}
              highlightQuery={
                pdfSearch.status === "done" ? pdfSearch.query : null
              }
              activeMatchIndex={pdfViewport.activeMatchIndex}
              onActiveMatchReady={pdfViewport.centerActiveMatch}
              onError={setError}
              onCanvasLayout={pdfViewport.restoreZoomPosition}
            />
          ) : epub && epubSession ? (
            <EpubChapter
              session={epubSession}
              sectionIndex={epubSectionIndex}
              appearance={epubAppearance}
              viewportRef={viewportRef}
            />
          ) : null}
        </ReaderShell>
      )}
    </>
  );
}

export default App;
