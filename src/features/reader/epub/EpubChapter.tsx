import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import type { EpubSectionContent, EpubSession } from "./EpubSource";

import { getEpubProgress, saveEpubProgress } from "./EpubProgress";

type EpubChapterProps = {
  session: EpubSession;
  sectionIndex: number;
  onNavigateSection: (index: number) => void;
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
  onNavigateSection,
  viewportRef,
}: EpubChapterProps) {
  const [result, setResult] = useState<ChapterResult | null>(null);

  const tocRef = useRef<HTMLDetailsElement>(null);

  const sectionTitle = session.toc.find(
    (entry) => entry.sectionIndex === sectionIndex,
  )?.title;

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

    const viewport = viewportRef.current;

    if (!viewport) return;

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
        margin: "24px auto",
        padding: "clamp(20px, 5vw, 48px)",
        background: "#ffffff",
        color: "#1f2937",
        borderRadius: "12px",
        lineHeight: 1.8,
        overflowWrap: "anywhere",
      }}
    >
      <header
        style={{
          marginBottom: "28px",
          paddingBottom: "20px",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <p style={{ margin: 0, color: "#64748b" }}>{session.summary.title}</p>

        <h1
          style={{
            margin: "8px 0",
            fontSize: "clamp(22px, 4vw, 30px)",
            lineHeight: 1.25,
          }}
        >
          {sectionTitle ?? `Sección ${sectionIndex + 1}`}
        </h1>

        <p style={{ margin: 0, color: "#64748b" }}>
          {session.summary.author} · {sectionIndex + 1} de{" "}
          {session.summary.sectionCount}
        </p>
      </header>

      {session.toc.length > 0 && (
        <details
          ref={tocRef}
          style={{
            marginBottom: "24px",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            overflow: "hidden",
          }}
        >
          <summary
            style={{
              padding: "12px 16px",
              cursor: "pointer",
              fontWeight: 600,
              background: "#f8fafc",
            }}
          >
            Índice del libro
          </summary>

          <nav
            aria-label="Índice de capítulos EPUB"
            style={{
              maxHeight: "320px",
              overflowY: "auto",
              padding: "8px",
            }}
          >
            {session.toc.map((entry) => {
              const target = entry.sectionIndex;
              const isCurrent = target !== null && target === sectionIndex;

              return (
                <div
                  key={entry.id}
                  style={{
                    paddingLeft: `${Math.min(entry.depth, 4) * 12}px`,
                  }}
                >
                  {target === null ? (
                    <span
                      style={{
                        display: "block",
                        padding: "10px",
                        color: "#64748b",
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
                      onClick={() => {
                        onNavigateSection(target);

                        if (tocRef.current) {
                          tocRef.current.open = false;
                        }
                      }}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "10px",
                        border: 0,
                        borderRadius: "6px",
                        background: isCurrent ? "#e2e8f0" : "transparent",
                        color: "#1f2937",
                        font: "inherit",
                        textAlign: "left",
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
        </details>
      )}

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
              maxWidth: "520px",
              maxHeight: "75vh",
              height: "auto",
              objectFit: "contain",
              marginInline: "auto",
            }}
          />
        </figure>
      ) : content?.blocks.length ? (
        <div>
          {content.blocks.map((block, index) =>
            block.kind === "heading" ? (
              <h2
                key={index}
                style={{
                  margin: "24px 0 12px",
                  fontSize: "1.35rem",
                  lineHeight: 1.35,
                  whiteSpace: "pre-wrap",
                }}
              >
                {block.text}
              </h2>
            ) : (
              <p
                key={index}
                style={{
                  margin: "0 0 18px",
                  whiteSpace: "pre-wrap",
                }}
              >
                {block.text}
              </p>
            ),
          )}
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
