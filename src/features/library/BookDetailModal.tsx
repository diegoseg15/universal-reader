import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { open as openFile, SeekMode } from "@tauri-apps/plugin-fs";
import {
  ArrowLeftIcon,
  BookmarkSimpleIcon,
  DotsThreeIcon,
  InfoIcon,
  PencilSimpleIcon,
  StarIcon,
} from "@phosphor-icons/react";
import { getDocument } from "pdfjs-dist";

import {
  createEpubProgressId,
  NativeFileBlob,
  NativeRangeSource,
} from "../reader/epub/EpubRangeSource";
import { LocalPDFTransport, readRange } from "../reader/pdf/PdfRangeSource";
import { readStoredBookProgress } from "../reader/useReaderSession";
import { LibraryCover } from "./LibraryCover";
import { CATEGORY_LABELS, bookCategory } from "./LibraryOrganization";
import {
  canReadBook,
  type LibraryBook,
  type LibraryService,
} from "./LibrarySource";
import {
  acceptPublicBookMetadata,
  declinePublicBookMetadata,
  fetchPublicBookMetadata,
  getStoredBookMetadataDecision,
  getUserBookRating,
  saveEditedBookMetadata,
  setUserBookRating,
  type PublicBookMetadata,
} from "./PublicBookMetadata";

type BookDetailModalProps = {
  book: LibraryBook;
  loader: LibraryService["loadCover"];
  revision: number;
  disabled: boolean;
  onClose: () => void;
  onStartReading: (book: LibraryBook) => void;
};

type ExtractedBookDetails = {
  title: string | null;
  author: string | null;
  description: string | null;
  pageCount: number | null;
  pageLabel: string;
  language: string | null;
  savedCurrentPage: number | null;
};

type SheetViewMode = "description" | "info";
type ActiveModalDialog = "rate" | "edit" | null;

const BOOKMARKS_STORAGE_KEY = "universal-reader.bookmarked-books.v1";

function readBookmarkedPaths(): Set<string> {
  try {
    const raw = window.localStorage.getItem(BOOKMARKS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((item): item is string => typeof item === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function toggleBookmarkedPath(path: string): boolean {
  const current = readBookmarkedPaths();
  const nextState = !current.has(path);
  if (nextState) {
    current.add(path);
  } else {
    current.delete(path);
  }
  try {
    window.localStorage.setItem(
      BOOKMARKS_STORAGE_KEY,
      JSON.stringify([...current]),
    );
  } catch {
    // Ignore storage quota errors.
  }
  return nextState;
}

function readableText(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map(readableText)
      .filter((entry): entry is string => entry !== null);
    return parts.join(", ") || null;
  }

  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if ("name" in record) {
      return readableText(record.name);
    }
    for (const key of ["es", "en", "und", ...Object.keys(record)]) {
      if (!(key in record)) continue;
      const text = readableText(record[key]);
      if (text) return text;
    }
  }

  return null;
}

function stripHtmlDescription(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const doc = new DOMParser().parseFromString(raw, "text/html");
    const clean = (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
    return clean && clean.length >= 15 ? clean : null;
  } catch {
    const clean = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return clean && clean.length >= 15 ? clean : null;
  }
}

const LANGUAGE_OPTIONS: { code: string; label: string }[] = [
  { code: "", label: "Automático / Sin especificar" },
  { code: "es", label: "Español (es)" },
  { code: "en", label: "Inglés (en)" },
  { code: "fr", label: "Francés (fr)" },
  { code: "pt", label: "Portugués (pt)" },
  { code: "ja", label: "Japonés (ja)" },
  { code: "de", label: "Alemán (de)" },
  { code: "it", label: "Italiano (it)" },
  { code: "zh", label: "Chino (zh)" },
  { code: "ko", label: "Coreano (ko)" },
  { code: "ru", label: "Ruso (ru)" },
  { code: "ca", label: "Catalán (ca)" },
  { code: "la", label: "Latín (la)" },
];

function normalizeLanguageOption(raw: string | null): string {
  if (!raw) return "";
  const normalized = raw.trim().toLowerCase().split(/[-_]/)[0];
  if (normalized === "es" || normalized === "spa") return "es";
  if (normalized === "en" || normalized === "eng") return "en";
  if (normalized === "fr" || normalized === "fra") return "fr";
  if (normalized === "pt" || normalized === "por") return "pt";
  if (normalized === "ja" || normalized === "jpn") return "ja";
  if (normalized === "de" || normalized === "deu") return "de";
  if (normalized === "it" || normalized === "ita") return "it";
  if (normalized === "zh" || normalized === "zho" || normalized === "chi")
    return "zh";
  if (normalized === "ko" || normalized === "kor") return "ko";
  if (normalized === "ru" || normalized === "rus") return "ru";
  if (normalized === "ca" || normalized === "cat") return "ca";
  if (normalized === "la" || normalized === "lat") return "la";
  return "";
}

function formatLanguageCode(raw: string | null, fallbackFormat: string): string {
  if (!raw) return fallbackFormat.toUpperCase();
  const normalized = raw.trim().toLowerCase().split(/[-_]/)[0];
  if (normalized === "es" || normalized === "spa") return "Esp";
  if (normalized === "en" || normalized === "eng") return "Eng";
  if (normalized === "fr" || normalized === "fra") return "Fra";
  if (normalized === "pt" || normalized === "por") return "Por";
  if (normalized === "ja" || normalized === "jpn") return "Jpn";
  if (normalized === "de" || normalized === "deu") return "Deu";
  if (normalized === "it" || normalized === "ita") return "Ita";
  if (normalized === "zh" || normalized === "zho" || normalized === "chi")
    return "Zho";
  if (normalized === "ko" || normalized === "kor") return "Kor";
  if (normalized === "ru" || normalized === "rus") return "Rus";
  if (normalized === "ca" || normalized === "cat") return "Cat";
  if (normalized === "la" || normalized === "lat") return "Lat";
  return normalized.slice(0, 3).replace(/^./, (char) => char.toUpperCase());
}

function formatFullLanguageName(
  raw: string | null,
  fallbackFormat: string,
): string {
  if (!raw) return `No especificado (${fallbackFormat.toUpperCase()})`;
  const normalized = raw.trim().toLowerCase().split(/[-_]/)[0];
  if (normalized === "es" || normalized === "spa") return `Español (${raw})`;
  if (normalized === "en" || normalized === "eng") return `Inglés (${raw})`;
  if (normalized === "fr" || normalized === "fra") return `Francés (${raw})`;
  if (normalized === "pt" || normalized === "por") return `Portugués (${raw})`;
  if (normalized === "ja" || normalized === "jpn") return `Japonés (${raw})`;
  if (normalized === "de" || normalized === "deu") return `Alemán (${raw})`;
  if (normalized === "it" || normalized === "ita") return `Italiano (${raw})`;
  if (normalized === "zh" || normalized === "zho" || normalized === "chi")
    return `Chino (${raw})`;
  if (normalized === "ko" || normalized === "kor") return `Coreano (${raw})`;
  if (normalized === "ru" || normalized === "rus") return `Ruso (${raw})`;
  if (normalized === "ca" || normalized === "cat") return `Catalán (${raw})`;
  if (normalized === "la" || normalized === "lat") return `Latín (${raw})`;
  return raw;
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "Local";
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

function formatReviewsSummary(meta: PublicBookMetadata | null): string | null {
  if (!meta || !meta.rating || meta.rating <= 0) return null;
  const score = `${meta.rating.toFixed(1)}/${meta.ratingScale}`;
  if (meta.ratingsCount && meta.ratingsCount > 0) {
    return `${score} (${meta.ratingsCount.toLocaleString("es-ES")} reseñas)`;
  }
  return `${score} en ${meta.source}`;
}

function formatRatingStat(meta: PublicBookMetadata | null): string {
  if (!meta || !meta.rating || meta.rating <= 0) return "—";
  return `★ ${meta.rating.toFixed(1)}/${meta.ratingScale}`;
}

async function loadBookDetails(
  book: LibraryBook,
  signal: AbortSignal,
): Promise<ExtractedBookDetails | null> {
  if (!isTauri()) return null;

  const format = book.format.toLowerCase();
  if (!["pdf", "epub", "mobi", "azw", "azw3", "fb2"].includes(format)) {
    return null;
  }

  const file = await openFile(book.path, { read: true });
  let rangeSource: NativeRangeSource | undefined;

  try {
    const size = await file.seek(0, SeekMode.End);
    if (signal.aborted || !Number.isSafeInteger(size) || size <= 0) {
      return null;
    }

    if (format === "pdf") {
      const transport = new LocalPDFTransport(
        size,
        (begin, end) => readRange(file, begin, end),
        () => {
          void task.destroy().catch(() => {});
        },
      );

      const task = getDocument({
        range: transport,
        disableStream: true,
        disableAutoFetch: true,
        rangeChunkSize: 64 * 1024,
        wasmUrl: new URL(
          "pdfjs-wasm/",
          new URL(import.meta.env.BASE_URL, window.location.origin),
        ).href,
      });

      task.onPassword = () => {
        void task.destroy().catch(() => {});
      };

      const abort = () => {
        transport.abort();
        void task.destroy().catch(() => {});
      };
      signal.addEventListener("abort", abort, { once: true });

      try {
        const pdf = await task.promise;
        if (signal.aborted) return null;

        let title: string | null = null;
        let author: string | null = null;
        let description: string | null = null;
        let language: string | null = null;

        try {
          const meta = await pdf.getMetadata();
          const info = (meta?.info ?? {}) as Record<string, unknown>;
          title = readableText(info.Title);
          author = readableText(info.Author);
          description = stripHtmlDescription(readableText(info.Subject));
          language = readableText(info.Language);
        } catch {
          // Ignore optional PDF metadata errors.
        }

        return {
          title,
          author,
          description,
          pageCount: pdf.numPages,
          pageLabel: "Páginas",
          language,
          savedCurrentPage: null,
        };
      } finally {
        signal.removeEventListener("abort", abort);
        transport.abort();
        try {
          await task.destroy();
        } finally {
          await transport.waitForIdle();
        }
      }
    }

    rangeSource = new NativeRangeSource(file, size);
    const blob = new NativeFileBlob(rangeSource, 0, size, book.name);
    const { makeBook } = await import("foliate-js/view.js");
    const parsed = await makeBook(blob);

    try {
      if (signal.aborted) return null;

      const navPath = parsed.resources?.navPath;
      const sectionCount = Array.isArray(parsed.sections)
        ? parsed.sections.filter((s) => !navPath || s.id !== navPath).length
        : null;

      let savedCurrentPage: number | null = null;
      try {
        const progressId = await createEpubProgressId(rangeSource, book.name);
        const rawProgress = window.localStorage.getItem(
          `universal-reader:epub-progress:v1:${progressId}`,
        );
        if (rawProgress) {
          const parsedProgress = JSON.parse(rawProgress) as {
            lastSection?: number;
          };
          if (
            typeof parsedProgress.lastSection === "number" &&
            parsedProgress.lastSection >= 0
          ) {
            savedCurrentPage = parsedProgress.lastSection + 1;
          }
        }
      } catch {
        // Ignore progress lookup errors.
      }

      return {
        title: readableText(parsed.metadata?.title),
        author: readableText(parsed.metadata?.author),
        description: stripHtmlDescription(
          readableText(parsed.metadata?.description),
        ),
        pageCount: sectionCount,
        pageLabel: "Secciones",
        language: readableText(parsed.metadata?.language),
        savedCurrentPage,
      };
    } finally {
      parsed.destroy?.();
    }
  } catch {
    return null;
  } finally {
    try {
      await rangeSource?.waitForIdle();
    } finally {
      await file.close();
    }
  }
}

export function BookDetailModal({
  book,
  loader,
  revision,
  disabled,
  onClose,
  onStartReading,
}: BookDetailModalProps) {
  const [details, setDetails] = useState<ExtractedBookDetails | null>(null);
  const [acceptedMeta, setAcceptedMeta] = useState<PublicBookMetadata | null>(
    () => {
      const existing = getStoredBookMetadataDecision(book.path);
      return existing?.status === "accepted" ? existing.metadata : null;
    },
  );
  const [pendingPublicMeta, setPendingPublicMeta] =
    useState<PublicBookMetadata | null>(null);
  const [apiRatingMeta, setApiRatingMeta] =
    useState<PublicBookMetadata | null>(null);
  const [userRating, setUserRatingState] = useState<number | null>(() =>
    getUserBookRating(book.path),
  );
  const [searchingApi, setSearchingApi] = useState(false);
  const [coverBackdropUrl, setCoverBackdropUrl] = useState<string | null>(null);
  const [bookmarked, setBookmarked] = useState(() =>
    readBookmarkedPaths().has(book.path),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetView, setSheetView] = useState<SheetViewMode>("description");
  const [activeDialog, setActiveDialog] = useState<ActiveModalDialog>(null);

  // Form states for "Editar datos"
  const [editTitle, setEditTitle] = useState("");
  const [editAuthor, setEditAuthor] = useState("");
  const [editLanguage, setEditLanguage] = useState("");
  const [editCoverUrl, setEditCoverUrl] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const category = bookCategory(book);

  useEffect(() => {
    window.scrollTo(0, 0);
    setBookmarked(readBookmarkedPaths().has(book.path));
    setUserRatingState(getUserBookRating(book.path));
    setDetails(null);
    setPendingPublicMeta(null);
    setMenuOpen(false);
    setSheetView("description");
    setActiveDialog(null);

    const existingDecision = getStoredBookMetadataDecision(book.path);
    if (existingDecision?.status === "accepted") {
      setAcceptedMeta(existingDecision.metadata);
      setApiRatingMeta(existingDecision.metadata);
      setSearchingApi(false);
    } else if (existingDecision?.status === "declined") {
      setAcceptedMeta(null);
      setApiRatingMeta(
        typeof existingDecision.rating === "number"
          ? {
              title: null,
              author: null,
              description: null,
              pageCount: null,
              pageLabel: null,
              language: null,
              coverUrl: null,
              rating: existingDecision.rating,
              ratingScale: existingDecision.ratingScale ?? 5,
              ratingsCount: existingDecision.ratingsCount ?? null,
              categories: [],
              publishedDate: null,
              publisher: null,
              source: existingDecision.ratingSource ?? "API",
            }
          : null,
      );
      setSearchingApi(false);
    } else {
      setAcceptedMeta(null);
      setApiRatingMeta(null);
      setSearchingApi(true);
    }

    const controller = new AbortController();

    void (async () => {
      const localResult = await loadBookDetails(book, controller.signal);
      if (controller.signal.aborted) return;

      if (localResult) {
        setDetails(localResult);
      }

      if (existingDecision !== null) {
        return;
      }

      const remoteResult = await fetchPublicBookMetadata(
        book,
        category,
        localResult?.title ?? null,
        localResult?.author ?? null,
        controller.signal,
      );

      if (controller.signal.aborted) return;

      setSearchingApi(false);
      if (remoteResult) {
        setApiRatingMeta(remoteResult);
        setPendingPublicMeta(remoteResult);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [book, category]);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setCoverBackdropUrl(null);

    if (loader) {
      void loader(book, controller.signal)
        .then((blob) => {
          if (controller.signal.aborted || !blob) return;
          objectUrl = URL.createObjectURL(blob);
          setCoverBackdropUrl(objectUrl);
        })
        .catch(() => {});
    }

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [book, loader, revision]);

  function handleCloseWindow(): void {
    onClose();
  }

  function handleAcceptPublicMetadata(): void {
    if (!pendingPublicMeta) return;
    acceptPublicBookMetadata(book.path, pendingPublicMeta);
    setAcceptedMeta(pendingPublicMeta);
    setPendingPublicMeta(null);
  }

  function handleDeclinePublicMetadata(): void {
    declinePublicBookMetadata(book.path, pendingPublicMeta);
    setPendingPublicMeta(null);
  }

  function handleSelectUserRating(score: number | null): void {
    setUserBookRating(book.path, score);
    setUserRatingState(score);
  }

  const readable = canReadBook(book);
  const cleanFileName = book.name
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ");

  const displayTitle = acceptedMeta?.title ?? details?.title ?? cleanFileName;
  const displayAuthor =
    acceptedMeta?.author ??
    details?.author ??
    book.folderName ??
    CATEGORY_LABELS[category];

  const headerTitle =
    category === "comics"
      ? "Detalle del cómic"
      : category === "manga"
        ? "Detalle del manga"
        : category === "documents"
          ? "Detalle del documento"
          : "Detalle del libro";

  const workNoun =
    category === "comics"
      ? "cómic"
      : category === "manga"
        ? "manga"
        : category === "documents"
          ? "documento"
          : "libro";

  const fallbackDescription = `${CATEGORY_LABELS[category]} en formato ${book.format.toUpperCase()} dentro de la colección «${book.folderName ?? "Biblioteca"}» (${book.relativePath}). ${
    readable
      ? "Listo para abrir en el lector con acceso rápido y guardado automático de progreso."
      : "Catalogado en tu biblioteca local; el soporte de lectura para este formato estará disponible próximamente."
  }`;

  const resolvedDescription =
    acceptedMeta?.description ?? details?.description ?? fallbackDescription;

  const resolvedRatingMeta = acceptedMeta ?? pendingPublicMeta ?? apiRatingMeta;
  const reviewsSummary = formatReviewsSummary(resolvedRatingMeta);
  const pendingReviewsSummary = formatReviewsSummary(pendingPublicMeta);

  const isUserEdited = Boolean(acceptedMeta?.source.includes("Editado"));
  const resolvedLanguage = isUserEdited
    ? (acceptedMeta?.language ?? details?.language ?? null)
    : (details?.language ?? acceptedMeta?.language ?? null);
  const languageBadge = formatLanguageCode(resolvedLanguage, book.format);
  const resolvedCount =
    details?.pageCount ?? acceptedMeta?.pageCount ?? null;
  const resolvedCountLabel = details?.pageCount
    ? details.pageLabel
    : acceptedMeta?.pageCount
      ? (acceptedMeta.pageLabel ?? "Páginas")
      : "Formato";
  const resolvedBackdropUrl =
    isUserEdited && acceptedMeta?.coverUrl
      ? acceptedMeta.coverUrl
      : (coverBackdropUrl ?? acceptedMeta?.coverUrl ?? null);

  function openEditMetadataForm(): void {
    setEditTitle(displayTitle);
    setEditAuthor(displayAuthor);
    setEditLanguage(normalizeLanguageOption(resolvedLanguage));
    setEditCoverUrl(isUserEdited ? (acceptedMeta?.coverUrl ?? "") : "");
    setEditDescription(
      acceptedMeta?.description ?? details?.description ?? "",
    );
    setActiveDialog("edit");
    setMenuOpen(false);
  }

  function handleSaveEditedMetadata(event: React.FormEvent): void {
    event.preventDefault();
    const updated = saveEditedBookMetadata(
      book.path,
      {
        title: editTitle.trim() || null,
        author: editAuthor.trim() || null,
        language: editLanguage.trim() || null,
        pageCount: details?.pageCount ?? acceptedMeta?.pageCount ?? null,
        pageLabel: details?.pageLabel ?? acceptedMeta?.pageLabel ?? "Páginas",
        coverUrl: editCoverUrl.trim() || null,
        description: editDescription.trim() || null,
      },
      acceptedMeta ?? apiRatingMeta,
    );
    setAcceptedMeta(updated);
    setPendingPublicMeta(null);
    setActiveDialog(null);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        if (activeDialog) {
          setActiveDialog(null);
          return;
        }
        if (menuOpen) {
          setMenuOpen(false);
          return;
        }
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeDialog, menuOpen, onClose]);

  const infoLines = [
    `Ubicación en colección: ${book.folderName ?? "Biblioteca"} · ${book.relativePath}`,
    `Formato: ${book.format.toUpperCase()} · Tamaño: ${formatFileSize(book.size)}`,
    `Calificación API: ${reviewsSummary ?? "Sin calificación registrada"}`,
    `Mi calificación: ${userRating !== null ? `★ ${userRating.toFixed(1)}/5` : "Sin calificar"}`,
    acceptedMeta?.source
      ? `Fuente de metadata: ${acceptedMeta.source}`
      : "Fuente de metadata: Archivo local",
    acceptedMeta?.publisher ? `Editorial: ${acceptedMeta.publisher}` : null,
    acceptedMeta?.publishedDate ? `Año: ${acceptedMeta.publishedDate}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Reading progress calculation
  const storedProgress = readStoredBookProgress(book.path);
  const totalProgressUnits =
    details?.pageCount ??
    storedProgress?.totalPages ??
    acceptedMeta?.pageCount ??
    null;
  const currentProgressUnit =
    storedProgress?.currentPage ?? details?.savedCurrentPage ?? 1;
  const clampedCurrentUnit = totalProgressUnits
    ? Math.max(1, Math.min(totalProgressUnits, currentProgressUnit))
    : currentProgressUnit;
  const progressPercent =
    totalProgressUnits && totalProgressUnits > 0
      ? Math.min(
          100,
          Math.max(
            0,
            Math.round((clampedCurrentUnit / totalProgressUnits) * 100),
          ),
        )
      : 0;
  const progressUnitLabel =
    (details?.pageLabel ?? acceptedMeta?.pageLabel) === "Secciones"
      ? "Sección"
      : (details?.pageLabel ?? acceptedMeta?.pageLabel) === "Capítulos"
        ? "Capítulo"
        : "Página";

  return (
    <main
      className={`library-detail library-detail--${category}`}
      aria-label={displayTitle}
      onClick={() => {
        if (menuOpen) setMenuOpen(false);
      }}
    >
      <div className="library-detail__hero">
          {resolvedBackdropUrl && (
            <div className="library-detail__hero-bg-clip" aria-hidden="true">
              <div
                className="library-detail__hero-bg"
                style={{ backgroundImage: `url(${resolvedBackdropUrl})` }}
              />
            </div>
          )}

          <header className="library-detail__topbar">
            <button
              type="button"
              className="library-detail__nav-btn"
              onClick={handleCloseWindow}
              aria-label="Volver a la biblioteca"
              title="Volver"
            >
              <ArrowLeftIcon size={22} weight="bold" />
            </button>

            <span className="library-detail__topbar-title">{headerTitle}</span>

            <div
              className="library-detail__menu-wrap"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="library-detail__nav-btn"
                onClick={() => setMenuOpen((current) => !current)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-label="Opciones del archivo"
                title="Opciones"
              >
                <DotsThreeIcon size={24} weight="bold" />
              </button>

              {menuOpen && (
                <div className="library-detail__menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className={`library-detail__menu-item${sheetView === "info" ? " is-active" : ""}`}
                    onClick={() => {
                      setSheetView((current) =>
                        current === "info" ? "description" : "info",
                      );
                      setMenuOpen(false);
                    }}
                  >
                    <InfoIcon size={16} />
                    <span>Información</span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    className={`library-detail__menu-item${activeDialog === "rate" ? " is-active" : ""}`}
                    onClick={() => {
                      setActiveDialog("rate");
                      setMenuOpen(false);
                    }}
                  >
                    <StarIcon size={16} />
                    <span>Agregar calificación</span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    className={`library-detail__menu-item${activeDialog === "edit" ? " is-active" : ""}`}
                    onClick={openEditMetadataForm}
                  >
                    <PencilSimpleIcon size={16} />
                    <span>Editar datos</span>
                  </button>
                </div>
              )}
            </div>
          </header>

          <div className="library-detail__hero-content">
            <div className="library-detail__cover-3d">
              <LibraryCover book={book} loader={loader} revision={revision} />
            </div>

            <div className="library-detail__hero-info">
              <div className="library-detail__book-showcase">
                <h2 className="library-detail__title" title={displayTitle}>
                  {displayTitle}
                </h2>
                <p className="library-detail__author" title={displayAuthor}>
                  {displayAuthor}
                </p>

                {(userRating !== null ||
                  (acceptedMeta && acceptedMeta.categories.length > 0)) && (
                  <div className="library-detail__meta-badges">
                    {userRating !== null && (
                      <button
                        type="button"
                        className="library-detail__rating-pill"
                        onClick={() => setActiveDialog("rate")}
                        title="Editar mi calificación"
                      >
                        <StarIcon size={12} weight="fill" />
                        Mi nota: {userRating.toFixed(1)}/5
                      </button>
                    )}
                    {acceptedMeta?.categories.slice(0, 2).map((genre) => (
                      <span key={genre} className="library-detail__genre-pill">
                        {genre}
                      </span>
                    ))}
                    {acceptedMeta?.publishedDate && (
                      <span className="library-detail__genre-pill">
                        {acceptedMeta.publishedDate}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div
                className="library-detail__stats"
                aria-label="Información de la obra"
              >
                <div className="library-detail__stat">
                  <strong>{formatRatingStat(resolvedRatingMeta)}</strong>
                  <span>Calificación</span>
                </div>

                <div className="library-detail__stat">
                  <strong>{resolvedCount ?? book.format.toUpperCase()}</strong>
                  <span>{resolvedCount ? resolvedCountLabel : "Formato"}</span>
                </div>

                <div className="library-detail__stat">
                  <strong>{languageBadge}</strong>
                  <span>{resolvedLanguage ? "Idioma" : "Tipo"}</span>
                </div>
              </div>

              <div
                className="library-detail__progress"
                aria-label="Progreso de lectura"
              >
                <div className="library-detail__progress-header">
                  <span>
                    {totalProgressUnits
                      ? `${progressUnitLabel} ${clampedCurrentUnit} de ${totalProgressUnits}`
                      : `${progressUnitLabel} ${clampedCurrentUnit}`}
                  </span>
                  <strong>{progressPercent}%</strong>
                </div>
                <div
                  className="library-detail__progress-track"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={totalProgressUnits ?? 100}
                  aria-valuenow={
                    totalProgressUnits ? clampedCurrentUnit : progressPercent
                  }
                >
                  <div
                    className="library-detail__progress-fill"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="library-detail__sheet">
          <div className="library-detail__sheet-inner">
            <div className="library-detail__sheet-top">
              <footer className="library-detail__actions">
                <button
                  type="button"
                  className="library-detail__start-btn"
                  disabled={disabled || !readable}
                  onClick={() => onStartReading(book)}
                >
                  {readable ? "Comenzar lectura" : "Lectura aún no disponible"}
                </button>

                <div className="library-detail__action-icons">
                  <button
                    type="button"
                    className={`library-detail__bookmark${bookmarked ? " is-active" : ""}`}
                    onClick={() =>
                      setBookmarked(toggleBookmarkedPath(book.path))
                    }
                    aria-pressed={bookmarked}
                    aria-label={
                      bookmarked
                        ? "Quitar de favoritos"
                        : "Guardar en favoritos"
                    }
                    title={bookmarked ? "Guardado" : "Guardar en favoritos"}
                  >
                    <BookmarkSimpleIcon
                      size={22}
                      weight={bookmarked ? "fill" : "regular"}
                    />
                  </button>

                  <button
                    type="button"
                    className={`library-detail__bookmark library-detail__desktop-icon${userRating !== null ? " is-active" : ""}`}
                    onClick={() => setActiveDialog("rate")}
                    aria-label="Agregar o editar calificación"
                    title="Mi calificación"
                  >
                    <StarIcon
                      size={20}
                      weight={userRating !== null ? "fill" : "regular"}
                    />
                  </button>

                  <button
                    type="button"
                    className="library-detail__bookmark library-detail__desktop-icon"
                    onClick={openEditMetadataForm}
                    aria-label="Editar metadatos"
                    title="Editar datos"
                  >
                    <PencilSimpleIcon size={20} />
                  </button>
                </div>
              </footer>
            </div>

            <div className="library-detail__sheet-grid">
              <div className="library-detail__main-col">
                {searchingApi && !pendingPublicMeta && (
                  <div className="library-detail__api-prompt" role="status">
                    <div className="library-detail__api-prompt-body">
                      <strong>Buscando en catálogos públicos…</strong>
                      <span>
                        Consultando descripción y reseñas de este {workNoun}.
                      </span>
                    </div>
                  </div>
                )}

                {pendingPublicMeta && (
                  <div
                    className="library-detail__api-prompt"
                    role="alertdialog"
                    aria-label="Aviso de datos encontrados"
                  >
                    <div className="library-detail__api-prompt-body">
                      <strong>
                        Se encontraron datos de este {workNoun} en{" "}
                        {pendingPublicMeta.source}
                      </strong>
                      <span>
                        {pendingPublicMeta.title ?? displayTitle}
                        {pendingPublicMeta.author
                          ? ` · ${pendingPublicMeta.author}`
                          : ""}
                        {pendingReviewsSummary
                          ? ` · ★ ${pendingReviewsSummary}`
                          : ""}
                      </span>
                      {pendingPublicMeta.description && (
                        <p className="library-detail__api-prompt-preview">
                          {pendingPublicMeta.description}
                        </p>
                      )}
                      <span>¿Deseas agregar estos datos a la metadata?</span>
                    </div>
                    <div className="library-detail__api-prompt-actions">
                      <button
                        type="button"
                        className="library-detail__api-btn library-detail__api-btn--yes"
                        onClick={handleAcceptPublicMetadata}
                      >
                        Sí, agregar
                      </button>
                      <button
                        type="button"
                        className="library-detail__api-btn library-detail__api-btn--no"
                        onClick={handleDeclinePublicMetadata}
                      >
                        No
                      </button>
                    </div>
                  </div>
                )}

                <div className="library-detail__description-block">
                  <div className="library-detail__panel-header">
                    <h3>
                      {sheetView === "info"
                        ? "Información del archivo"
                        : "Descripción"}
                    </h3>
                    {sheetView === "info" && (
                      <button
                        type="button"
                        className="library-detail__panel-close"
                        onClick={() => setSheetView("description")}
                      >
                        Ver descripción
                      </button>
                    )}
                  </div>
                  <p>
                    {sheetView === "info" ? infoLines : resolvedDescription}
                  </p>
                </div>
              </div>

              <aside
                className="library-detail__meta-col"
                aria-label="Detalles técnicos y edición"
              >
                <div className="library-detail__meta-group">
                  <h4>Autor y edición</h4>
                  <p>
                    {displayAuthor}
                    {acceptedMeta?.publisher
                      ? ` · ${acceptedMeta.publisher}`
                      : ""}
                    {acceptedMeta?.publishedDate
                      ? ` (${acceptedMeta.publishedDate})`
                      : ""}
                  </p>
                  <span>
                    Fuente: {acceptedMeta?.source ?? "Archivo local"}
                  </span>
                </div>

                <div className="library-detail__meta-group">
                  <h4>Idioma</h4>
                  <p>{formatFullLanguageName(resolvedLanguage, book.format)}</p>
                </div>

                <div className="library-detail__meta-group">
                  <h4>Formato y archivo</h4>
                  <p>
                    {book.format.toUpperCase()} · {formatFileSize(book.size)}
                    {resolvedCount
                      ? ` · ${resolvedCount} ${resolvedCountLabel.toLowerCase()}`
                      : ""}
                  </p>
                  <span>
                    {book.folderName ?? "Biblioteca"} · {book.relativePath}
                  </span>
                </div>

                <div className="library-detail__meta-group">
                  <h4>Calificaciones</h4>
                  <p>
                    API: {reviewsSummary ?? "Sin calificación registrada"}
                  </p>
                  <span>
                    Mi calificación:{" "}
                    {userRating !== null
                      ? `★ ${userRating.toFixed(1)}/5`
                      : "Sin calificar"}
                  </span>
                </div>
              </aside>
            </div>
          </div>
        </div>

        {activeDialog !== null && (
          <div
            className="library-detail__submodal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label={
              activeDialog === "edit"
                ? "Editar metadatos"
                : "Agregar calificación"
            }
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                setActiveDialog(null);
              }
            }}
          >
            {activeDialog === "rate" ? (
              <div className="library-detail__submodal">
                <div className="library-detail__panel-header">
                  <h3>Mi calificación personal</h3>
                  <button
                    type="button"
                    className="library-detail__panel-close"
                    onClick={() => setActiveDialog(null)}
                  >
                    Cerrar
                  </button>
                </div>
                <p className="library-detail__panel-hint">
                  Esta calificación es personal y se muestra aparte de la
                  calificación de las APIs (
                  {formatRatingStat(resolvedRatingMeta)}).
                </p>
                <div
                  className="library-detail__stars-picker"
                  role="radiogroup"
                  aria-label="Seleccionar calificación de 1 a 5 estrellas"
                >
                  {[1, 2, 3, 4, 5].map((star) => {
                    const active = (userRating ?? 0) >= star;
                    return (
                      <button
                        key={star}
                        type="button"
                        className={`library-detail__star-btn${active ? " is-active" : ""}`}
                        onClick={() => handleSelectUserRating(star)}
                        aria-label={`${star} ${star === 1 ? "estrella" : "estrellas"}`}
                      >
                        <StarIcon
                          size={26}
                          weight={active ? "fill" : "regular"}
                        />
                        <span>{star}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="library-detail__panel-actions">
                  {userRating !== null && (
                    <button
                      type="button"
                      className="library-detail__api-btn library-detail__api-btn--no"
                      onClick={() => handleSelectUserRating(null)}
                    >
                      Quitar mi calificación
                    </button>
                  )}
                  <button
                    type="button"
                    className="library-detail__api-btn library-detail__api-btn--yes"
                    onClick={() => setActiveDialog(null)}
                  >
                    Listo
                  </button>
                </div>
              </div>
            ) : (
              <form
                className="library-detail__submodal library-detail__edit-form"
                onSubmit={handleSaveEditedMetadata}
              >
                <div className="library-detail__panel-header">
                  <h3>Editar metadatos</h3>
                  <button
                    type="button"
                    className="library-detail__panel-close"
                    onClick={() => setActiveDialog(null)}
                  >
                    Cerrar
                  </button>
                </div>

                <div className="library-detail__edit-grid">
                  <label className="library-detail__field">
                    <span>Título</span>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(event) => setEditTitle(event.target.value)}
                      placeholder="Título de la obra"
                    />
                  </label>

                  <label className="library-detail__field">
                    <span>Autor</span>
                    <input
                      type="text"
                      value={editAuthor}
                      onChange={(event) => setEditAuthor(event.target.value)}
                      placeholder="Nombre del autor"
                    />
                  </label>

                  <label className="library-detail__field">
                    <span>Idioma</span>
                    <select
                      value={editLanguage}
                      onChange={(event) => setEditLanguage(event.target.value)}
                    >
                      {LANGUAGE_OPTIONS.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="library-detail__field">
                    <span>URL de carátula (opcional)</span>
                    <input
                      type="url"
                      value={editCoverUrl}
                      onChange={(event) => setEditCoverUrl(event.target.value)}
                      placeholder="https://..."
                    />
                  </label>

                  <label className="library-detail__field">
                    <span>Descripción</span>
                    <textarea
                      rows={4}
                      value={editDescription}
                      onChange={(event) =>
                        setEditDescription(event.target.value)
                      }
                      placeholder="Sinopsis o notas sobre la obra"
                    />
                  </label>
                </div>

                <div className="library-detail__panel-actions">
                  <button
                    type="button"
                    className="library-detail__api-btn library-detail__api-btn--no"
                    onClick={() => setActiveDialog(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="library-detail__api-btn library-detail__api-btn--yes"
                  >
                    Guardar cambios
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
    </main>
  );
}
