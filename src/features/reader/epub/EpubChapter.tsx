import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

import type { EpubSectionContent, EpubSession } from "./EpubSource";

import { getEpubProgress, saveEpubProgress } from "./EpubProgress";

import type { EpubAppearance } from "./EpubAppearance";

import { EpubRichText } from "./EpubRichText";

type EpubChapterProps = {
  session: EpubSession;
  sectionIndex: number;
  appearance: EpubAppearance;
  viewportRef: RefObject<HTMLElement | null>;
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
}: EpubChapterProps) {
  const [result, setResult] = useState<ChapterResult | null>(null);

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
    if (!isCurrent || !content) return;

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
  }, [session, sectionIndex, isCurrent, content, viewportRef]);

  return (
    <article
      aria-label="Contenido del libro EPUB"
      style={{
        boxSizing: "border-box",
        width: "min(100%, 760px)",
        margin: "12px auto 24px",
        padding: "clamp(4px, 2vw, 28px)",
        background: "var(--reader-surface)",
        color: "var(--reader-text)",
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
          }}
        >
          <img
            src={content.coverUrl}
            alt={`Portada de ${session.summary.title}`}
            decoding="async"
            style={{
              display: "block",
              width: "100%",
              height: "auto",
              maxWidth: "520px",
              maxHeight: "75vh",
              objectFit: "contain",
              marginInline: "auto",
            }}
          />
        </figure>
      ) : content?.blocks.length ? (
        <div
          style={{
            fontFamily:
              appearance.fontFamily === "serif"
                ? 'Georgia, "Times New Roman", serif'
                : 'system-ui, -apple-system, "Segoe UI", sans-serif',
            fontSize: `${appearance.fontSize}px`,
            lineHeight: appearance.lineHeight,
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
