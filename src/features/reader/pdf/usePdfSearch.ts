import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

type SearchPage = {
  pageNumber: number;
  matchCount: number;
};

type SearchMatch = {
  pageNumber: number;
  indexOnPage: number;
};

function findMatch(
  pages: SearchPage[],
  globalIndex: number,
): SearchMatch | null {
  if (!Number.isInteger(globalIndex) || globalIndex < 0) {
    return null;
  }

  let remaining = globalIndex;

  for (const page of pages) {
    if (remaining < page.matchCount) {
      return {
        pageNumber: page.pageNumber,
        indexOnPage: remaining,
      };
    }

    remaining -= page.matchCount;
  }

  return null;
}

type SearchStatus = "idle" | "searching" | "done" | "error";

function normalizeText(value: string): string {
  return value.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

function countMatches(content: string, query: string): number {
  let count = 0;
  let offset = 0;

  while (true) {
    const index = content.indexOf(query, offset);

    if (index === -1) break;

    count++;
    offset = index + query.length;
  }

  return count;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function usePdfSearch(
  document: PDFDocumentProxy | null,
  onNavigateToPage: (pageNumber: number) => void,
) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SearchStatus>("idle");

  const [pages, setPages] = useState<SearchPage[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scannedPages, setScannedPages] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Invalidates outdated searches and asynchronous results.
  const searchVersionRef = useRef(0);

  function resetResults(): void {
    searchVersionRef.current++;

    setPages([]);
    setSelectedIndex(0);
    setScannedPages(0);
    setStatus("idle");
    setError(null);
  }

  function changeQuery(value: string): void {
    resetResults();
    setQuery(value);
  }

  function clearSearch(): void {
    resetResults();
    setQuery("");
  }

  useEffect(() => {
    return () => {
      // A closed or replaced PDF invalidates its search.
      searchVersionRef.current++;
    };
  }, [document]);

  function search(): void {
    const activeDocument = document;
    const normalizedQuery = normalizeText(query);

    if (!activeDocument || !normalizedQuery) {
      return;
    }

    const version = ++searchVersionRef.current;

    setStatus("searching");
    setPages([]);
    setSelectedIndex(0);
    setScannedPages(0);
    setError(null);

    async function scanDocument(
      activeDocument: PDFDocumentProxy,
    ): Promise<void> {
      const foundPages: SearchPage[] = [];

      for (
        let pageNumber = 1;
        pageNumber <= activeDocument.numPages;
        pageNumber++
      ) {
        if (version !== searchVersionRef.current) {
          return;
        }

        const page = await activeDocument.getPage(pageNumber);

        const content = await page.getTextContent();

        if (version !== searchVersionRef.current) {
          return;
        }

        const pageText = normalizeText(
          content.items
            .map((item) => {
              if (!("str" in item)) return "";

              return item.str + (item.hasEOL ? " " : "");
            })
            .join(""),
        );

        const matches = countMatches(pageText, normalizedQuery);

        if (matches > 0) {
          foundPages.push({
            pageNumber,
            matchCount: matches,
          });
        }

        // Avoid unnecessary React updates on every page.
        if (pageNumber % 5 === 0 || pageNumber === activeDocument.numPages) {
          setScannedPages(pageNumber);
        }
      }

      if (version !== searchVersionRef.current) {
        return;
      }

      setPages(foundPages);
      setSelectedIndex(0);
      setStatus("done");

      if (foundPages.length > 0) {
        onNavigateToPage(foundPages[0].pageNumber);
      }
    }

    void scanDocument(activeDocument).catch((cause: unknown) => {
      if (version !== searchVersionRef.current) {
        return;
      }

      setStatus("error");
      setError(getErrorMessage(cause));
    });
  }

  const totalMatches = pages.reduce(
    (total, page) => total + page.matchCount,
    0,
  );

  const activeMatch =
    status === "done" ? findMatch(pages, selectedIndex) : null;

  function goToResult(index: number): void {
    if (status !== "done" || totalMatches === 0) {
      return;
    }

    const wrappedIndex = ((index % totalMatches) + totalMatches) % totalMatches;

    const match = findMatch(pages, wrappedIndex);

    if (!match) {
      return;
    }

    setSelectedIndex(wrappedIndex);

    onNavigateToPage(match.pageNumber);
  }

  return {
    query,
    status,
    pages,
    selectedIndex,
    activeMatch,
    scannedPages,
    error,
    totalMatches,

    changeQuery,
    clearSearch,
    search,

    previousResult: () => goToResult(selectedIndex - 1),

    nextResult: () => goToResult(selectedIndex + 1),
  };
}
