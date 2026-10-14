import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import type { EpubSectionContent, EpubSession } from "./EpubSource";

import { getEpubProgress, saveEpubProgress } from "./EpubProgress";

import type { EpubAppearance } from "./EpubAppearance";

import { EpubRichText } from "./EpubRichText";

type EpubPageInfo = {
  sectionIndex: number;
  pageIndex: number;
  pageCount: number;
};

type EpubPageRequest = {
  sectionIndex: number;
  index: number | "last";
  serial: number;
};

type EpubChapterProps = {
  session: EpubSession;
  sectionIndex: number;
  appearance: EpubAppearance;
  viewportRef: RefObject<HTMLElement | null>;
  pageRequest: EpubPageRequest | null;
  onPageInfo: (info: EpubPageInfo) => void;
};

type SheetProfile = {
  maxWidth: number | null;
  minHeight: number;
  minPadding: number;
  maxPadding: number;
};

const EPUB_SHEET_PROFILES: Record<EpubAppearance["pageSize"], SheetProfile> = {
  compact: {
    maxWidth: 540,
    minHeight: 0,
    minPadding: 12,
    maxPadding: 28,
  },
  standard: {
    maxWidth: 880,
    minHeight: 820,
    minPadding: 18,
    maxPadding: 48,
  },
  wide: {
    maxWidth: null,
    minHeight: 0,
    minPadding: 16,
    maxPadding: 48,
  },
};

type ChapterResult = {
  session: EpubSession;
  index: number;
  content: EpubSectionContent | null;
  error: string | null;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function EpubChapter({
  session,
  sectionIndex,
  appearance,
  viewportRef,
  pageRequest,
  onPageInfo,
}: EpubChapterProps) {
  const [result, setResult] = useState<ChapterResult | null>(null);

  const isCompact = appearance.pageSize === "compact";

  const columnsRef = useRef<HTMLDivElement>(null);

  const [layoutSize, setLayoutSize] = useState({
    width: 0,
    height: 0,
  });

  const appliedRequestRef = useRef<number | null>(null);

  const onPageInfoRef = useRef(onPageInfo);
  onPageInfoRef.current = onPageInfo;

  const sheet = EPUB_SHEET_PROFILES[appearance.pageSize];

  useEffect(() => {
    let cancelled = false;

    void session.readSection(sectionIndex).then(
      (content) => {
        if (cancelled) return;

        setResult({
          session,
          index: sectionIndex,
          content,
          error: null,
        });
      },
      (cause: unknown) => {
        if (cancelled) return;

        setResult({
          session,
          index: sectionIndex,
          content: null,
          error: getErrorMessage(cause),
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [session, sectionIndex]);

  const isCurrent =
    result?.session === session && result.index === sectionIndex;

  const content = isCurrent ? result.content : null;

  const error = isCurrent ? result.error : null;

  useLayoutEffect(() => {
    if (isCompact || !isCurrent || !content) return;

    const currentViewport = viewportRef.current;

    if (!currentViewport) return;

    const viewport: HTMLElement = currentViewport;

    const progress = getEpubProgress(session);

    const savedPosition = progress.positions.get(sectionIndex) ?? 0;

    progress.lastSection = sectionIndex;
    saveEpubProgress(session);

    let saveTimer: number | null = null;
    let restored = false;

    function updatePosition(): void {
      if (!restored) return;

      const maxScroll = Math.max(
        0,
        viewport.scrollHeight - viewport.clientHeight,
      );

      const percentage = maxScroll > 0 ? viewport.scrollTop / maxScroll : 0;

      progress.positions.set(
        sectionIndex,
        Math.max(0, Math.min(1, percentage)),
      );
    }

    function scheduleSave(): void {
      updatePosition();

      if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
      }

      saveTimer = window.setTimeout(() => {
        saveTimer = null;
        saveEpubProgress(session);
      }, 750);
    }

    function flushProgress(): void {
      if (!restored) return;

      updatePosition();

      if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
        saveTimer = null;
      }

      saveEpubProgress(session);
    }

    function onVisibilityChange(): void {
      if (window.document.visibilityState === "hidden") {
        flushProgress();
      }
    }

    const frame = requestAnimationFrame(() => {
      const maxScroll = Math.max(
        0,
        viewport.scrollHeight - viewport.clientHeight,
      );

      viewport.scrollTop = savedPosition * maxScroll;
      restored = true;

      viewport.addEventListener("scroll", scheduleSave, { passive: true });
    });

    window.addEventListener("pagehide", flushProgress);

    window.document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelAnimationFrame(frame);

      viewport.removeEventListener("scroll", scheduleSave);

      window.removeEventListener("pagehide", flushProgress);

      window.document.removeEventListener(
        "visibilitychange",
        onVisibilityChange,
      );

      flushProgress();

      if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
      }
    };
  }, [session, sectionIndex, isCurrent, content, viewportRef, isCompact]);

  useLayoutEffect(() => {
    if (!isCompact || !isCurrent || !content?.blocks.length) {
      return;
    }

    const element = columnsRef.current;

    if (!element) return;

    const observer = new ResizeObserver(() => {
      const width = element.clientWidth;
      const height = element.clientHeight;

      if (width <= 0 || height <= 0) return;

      setLayoutSize((previous) => {
        if (previous.width === width && previous.height === height) {
          return previous;
        }

        return { width, height };
      });
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, [isCompact, isCurrent, content, sectionIndex]);

  useLayoutEffect(() => {
    if (!isCompact || !isCurrent || !content) return;

    const progress = getEpubProgress(session);

    // A cover or textless section occupies one page.
    if (!content.blocks.length) {
      progress.lastSection = sectionIndex;
      progress.positions.set(sectionIndex, 0);
      saveEpubProgress(session);

      onPageInfoRef.current({
        sectionIndex,
        pageIndex: 0,
        pageCount: 1,
      });

      return;
    }

    const currentElement = columnsRef.current;

    if (!currentElement || layoutSize.width <= 0 || layoutSize.height <= 0) {
      return;
    }

    const element: HTMLDivElement = currentElement;

    let frame = 0;

    function measurePages(): void {
      const width = element.clientWidth;

      if (width <= 0) return;

      // CSS columns overflow horizontally when their
      // content exceeds the available page height.
      const pageCount = Math.max(
        1,
        Math.ceil((element.scrollWidth - 1) / width),
      );

      const savedFraction = progress.positions.get(sectionIndex) ?? 0;

      const requestForSection =
        pageRequest?.sectionIndex === sectionIndex ? pageRequest : null;

      const hasNewRequest =
        requestForSection !== null &&
        appliedRequestRef.current !== requestForSection.serial;

      let pageIndex = Math.round(savedFraction * Math.max(0, pageCount - 1));

      if (hasNewRequest && requestForSection) {
        pageIndex =
          requestForSection.index === "last"
            ? pageCount - 1
            : requestForSection.index;

        appliedRequestRef.current = requestForSection.serial;
      }

      pageIndex = Math.max(0, Math.min(pageCount - 1, pageIndex));

      element.scrollLeft = pageIndex * width;

      progress.lastSection = sectionIndex;

      progress.positions.set(
        sectionIndex,
        pageCount > 1 ? pageIndex / (pageCount - 1) : 0,
      );

      saveEpubProgress(session);

      onPageInfoRef.current({
        sectionIndex,
        pageIndex,
        pageCount,
      });
    }

    frame = requestAnimationFrame(measurePages);

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [
    isCompact,
    isCurrent,
    content,
    session,
    sectionIndex,
    layoutSize.width,
    layoutSize.height,
    appearance.fontSize,
    appearance.lineHeight,
    appearance.fontFamily,
    pageRequest,
  ]);

  return (
    <article
      aria-label="Contenido del libro EPUB"
      style={{
        boxSizing: "border-box",
        display: isCompact ? "flex" : "block",
        flexDirection: isCompact ? "column" : undefined,

        width:
          sheet.maxWidth === null ? "100%" : `min(100%, ${sheet.maxWidth}px)`,

        height: isCompact ? "100%" : undefined,
        minHeight: isCompact
          ? 0
          : `min(${sheet.minHeight}px, calc(100dvh - 160px))`,

        margin: isCompact ? "0 auto" : "12px auto 24px",

        padding: isCompact
          ? "clamp(12px, 3vw, 28px)"
          : `clamp(${sheet.minPadding}px, 4vw, ${sheet.maxPadding}px)`,

        background: "var(--reader-surface)",
        color: "var(--reader-text)",

        border: "1px solid rgba(201, 193, 177, 0.35)",
        borderRadius: "6px",

        overflow: isCompact ? "hidden" : undefined,
        lineHeight: 1.8,
        overflowWrap: "anywhere",
      }}
    >
      {content?.recoveredFromHtml && (
        <p
          role="status"
          style={{
            color: "#854d0e",
            background: "#fef3c7",
            borderRadius: "8px",
            padding: "12px 16px",
            lineHeight: 1.5,
          }}
        >
          Este capítulo contiene XHTML irregular. Se ha recuperado una versión
          de lectura textual; algunos elementos podrían no conservar su formato
          original.
        </p>
      )}

      {!isCurrent ? (
        <p role="status">Cargando sección...</p>
      ) : error ? (
        <p role="alert">No se pudo leer esta sección: {error}</p>
      ) : content?.coverUrl ? (
        <figure
          style={{
            margin: 0,
            textAlign: "center",
            display: isCompact ? "flex" : "block",
            alignItems: isCompact ? "center" : undefined,
            justifyContent: isCompact ? "center" : undefined,
            flex: isCompact ? "1 1 auto" : undefined,
            minHeight: isCompact ? 0 : undefined,
            overflow: isCompact ? "hidden" : undefined,
          }}
        >
          <img
            src={content.coverUrl}
            alt={`Portada de ${session.summary.title}`}
            decoding="async"
            style={{
              display: "block",
              width: "100%",
              height: isCompact ? "100%" : "auto",
              maxWidth: "520px",
              maxHeight: isCompact ? "100%" : "75vh",
              objectFit: "contain",
              marginInline: "auto",
            }}
          />
        </figure>
      ) : content?.blocks.length ? (
        <div
          ref={isCompact ? columnsRef : undefined}
          style={{
            fontFamily:
              appearance.fontFamily === "serif"
                ? 'Georgia, "Times New Roman", serif'
                : 'system-ui, -apple-system, "Segoe UI", sans-serif',

            fontSize: `${appearance.fontSize}px`,
            lineHeight: appearance.lineHeight,

            ...(isCompact
              ? {
                  flex: "1 1 auto",
                  minHeight: 0,
                  height: "100%",
                  width: "100%",
                  overflow: "hidden",

                  columnWidth: `${layoutSize.width || 540}px`,
                  columnGap: "0px",
                  columnFill: "auto" as const,
                }
              : {}),
          }}
        >
          <EpubRichText blocks={content.blocks} />
        </div>
      ) : (
        <p>
          Esta sección no contiene texto extraíble. Puede tratarse de una
          portada, una ilustración o contenido que todavía no admite este modo
          de lectura.
        </p>
      )}
    </article>
  );
}
