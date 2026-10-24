import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  BookmarkSimpleIcon,
  BookOpenIcon,
  BooksIcon,
  CaretLeftIcon,
  CaretRightIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  StackIcon,
  StackPlusIcon,
  StarIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { readStoredBookProgress } from "../reader/useReaderSession";
import {
  bookCategory,
  canReadBook,
  nativeLibrary,
  type LibraryBook,
  type LibraryFolder,
  type LibraryService,
} from "./LibrarySource";
import "./LibraryScreen.css";
import { BookDetailModal } from "./BookDetailModal";
import { LibraryCover } from "./LibraryCover";
import { directoryContents, normalizeRelativePath } from "./LibraryTree";
import { CATEGORY_LABELS, folderPreview } from "./LibraryOrganization";
import {
  getEffectiveBookMetadata,
  getStoredBookMetadataDecision,
  getUserBookRating,
  METADATA_UPDATED_EVENT,
} from "./PublicBookMetadata";

type Props = {
  loading: boolean;
  error: string | null;
  onOpenFile: () => void;
  onOpenBook: (book: LibraryBook) => void;
  service?: LibraryService;
};
type IndexedFolder = LibraryFolder & {
  books: LibraryBook[];
  warnings: string[];
  error?: string;
};
type Filter = "all" | "books" | "comics" | "manga" | "documents";
type MenuSection =
  | "library"
  | "search"
  | "mylist"
  | "collections"
  | "settings";

const BOOKMARKS_STORAGE_KEY = "universal-reader.bookmarked-books.v1";
const METADATA_DECISIONS_KEY = "universal-reader.book-metadata-decisions.v7";
const USER_RATINGS_KEY = "universal-reader.user-book-ratings.v1";
const PROGRESS_STORAGE_KEY = "universal-reader:book-progress:v1";

function readBookmarkedSet(): Set<string> {
  try {
    const raw = window.localStorage.getItem(BOOKMARKS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(
          parsed.filter((item): item is string => typeof item === "string"),
        )
      : new Set();
  } catch {
    return new Set();
  }
}

const HUB_ITEMS: {
  id: Filter;
  title: string;
  subtitle: string;
}[] = [
  {
    id: "all",
    title: "TU CATÁLOGO",
    subtitle: "Todo el catálogo",
  },
  {
    id: "books",
    title: "LIBROS",
    subtitle: "Literatura y ensayo",
  },
  {
    id: "comics",
    title: "CÓMICS",
    subtitle: "Novela gráfica",
  },
  {
    id: "manga",
    title: "MANGA",
    subtitle: "Lectura oriental",
  },
];

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function LibraryScreen({
  loading,
  error,
  onOpenFile,
  onOpenBook,
  service = nativeLibrary,
}: Props) {
  const [folders, setFolders] = useState<IndexedFolder[]>([]);
  const [scanning, setScanning] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [activeMenu, setActiveMenu] = useState<MenuSection>("library");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState("all");
  const [directory, setDirectory] = useState("");
  const [format, setFormat] = useState("all");
  const [visibleCount, setVisibleCount] = useState(60);
  const [selectedBook, setSelectedBook] = useState<LibraryBook | null>(null);
  const [spotlightIndex, setSpotlightIndex] = useState(0);
  const [, setMetadataRevision] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const available = service !== nativeLibrary || isTauri();

  function navigate(folderId: string, path = ""): void {
    setSelectedFolder(folderId);
    setDirectory(normalizeRelativePath(path));
    setActiveMenu("library");
  }

  function resetToHome(): void {
    setActiveMenu("library");
    setSelectedFolder("all");
    setDirectory("");
    setFilter("all");
    setOnlyFavorites(false);
    setQuery("");
    setFormat("all");
  }

  function selectMenu(section: MenuSection): void {
    setSettingsNotice(null);
    setActiveMenu(section);
    if (section === "library") {
      setOnlyFavorites(false);
      setQuery("");
    } else if (section === "search") {
      setOnlyFavorites(false);
      window.setTimeout(() => searchInputRef.current?.focus(), 40);
    } else if (section === "mylist") {
      setOnlyFavorites(true);
      setFilter("all");
      setSelectedFolder("all");
      setDirectory("");
    } else if (section === "collections") {
      setOnlyFavorites(false);
      setFilter("all");
    }
  }

  async function indexFolders(token: number): Promise<void> {
    const saved = await service.folders();
    if (token !== generation.current) return;
    const indexed: IndexedFolder[] = [];
    for (const folder of saved) {
      try {
        const scan = await service.scanFolder(folder.id);
        indexed.push({ ...folder, ...scan });
      } catch (cause) {
        indexed.push({
          ...folder,
          books: [],
          warnings: [],
          error: message(cause),
        });
      }
      if (token !== generation.current) return;
      setFolders([...indexed]);
    }
    setFolders(indexed);
  }

  async function perform(action?: () => Promise<unknown>): Promise<void> {
    if (busy.current || loading) return;
    if (!available) {
      setLibraryError(
        "Para acceder a tus colecciones, abre Universal Reader como aplicación de escritorio o Android.",
      );
      return;
    }
    busy.current = true;
    const token = ++generation.current;
    setScanning(true);
    setLibraryError(null);
    try {
      if (action) {
        const result = await action();
        if (result === null || token !== generation.current) return;
      }
      await indexFolders(token);
    } catch (cause) {
      if (token === generation.current) setLibraryError(message(cause));
    } finally {
      if (token === generation.current) {
        busy.current = false;
        setScanning(false);
      }
    }
  }

  useEffect(() => {
    void perform();
    return () => {
      generation.current++;
      busy.current = false;
    };
  }, [service]);

  useEffect(() => {
    setVisibleCount(60);
  }, [query, filter, onlyFavorites, selectedFolder, directory, format]);

  useEffect(() => {
    const onMetaChange = () => setMetadataRevision((v) => v + 1);
    window.addEventListener(METADATA_UPDATED_EVENT, onMetaChange);
    return () =>
      window.removeEventListener(METADATA_UPDATED_EVENT, onMetaChange);
  }, []);

  const bookmarkedPaths = readBookmarkedSet();

  const allUniqueBooks = Array.from(
    new Map(
      folders.flatMap((folder) =>
        folder.books.map(
          (book) =>
            [
              book.path,
              { ...book, folderName: folder.name, folderId: folder.id },
            ] as const,
        ),
      ),
    ).values(),
  );

  const books = Array.from(
    new Map(
      folders
        .filter(
          (folder) => selectedFolder === "all" || folder.id === selectedFolder,
        )
        .flatMap((folder) =>
          folder.books.map(
            (book) =>
              [
                `${folder.id}\0${book.path}`,
                { ...book, folderName: folder.name, folderId: folder.id },
              ] as const,
          ),
        ),
    ).values(),
  );

  const formats = [
    ...new Set(folders.flatMap((folder) => folder.books.map((b) => b.format))),
  ].sort();

  const visible = books
    .filter((book) => {
      if (onlyFavorites && !bookmarkedPaths.has(book.path)) return false;
      if (filter !== "all" && bookCategory(book) !== filter) return false;
      if (format !== "all" && book.format !== format) return false;
      if (!query.trim()) return true;
      const savedMeta = getEffectiveBookMetadata(book.path);
      const haystack = `${book.name} ${savedMeta?.title ?? ""} ${savedMeta?.author ?? ""} ${book.relativePath} ${book.folderName}`.toLocaleLowerCase();
      return haystack.includes(query.toLocaleLowerCase().trim());
    })
    .sort((a, b) =>
      a.name.localeCompare(b.name, "es", {
        numeric: true,
        sensitivity: "base",
      }),
    );

  // Category counts for the 6 Disney+ style Hub tiles
  const categoryCounts: Record<Filter | "favorites", number> = {
    all: allUniqueBooks.length,
    books: allUniqueBooks.filter((b) => bookCategory(b) === "books").length,
    comics: allUniqueBooks.filter((b) => bookCategory(b) === "comics").length,
    manga: allUniqueBooks.filter((b) => bookCategory(b) === "manga").length,
    documents: allUniqueBooks.filter((b) => bookCategory(b) === "documents")
      .length,
    favorites: allUniqueBooks.filter((b) => bookmarkedPaths.has(b.path)).length,
  };

  // Spotlight books (up to 7 featured books from the entire library, independent of category filter)
  const spotlightBooks = (() => {
    if (allUniqueBooks.length === 0) return [];
    const scored = allUniqueBooks.map((book) => {
      const progress = readStoredBookProgress(book.path);
      const isFav = bookmarkedPaths.has(book.path);
      const hasMeta = getEffectiveBookMetadata(book.path) !== null;
      let score = 0;
      if (progress && progress.currentPage > 1) score += 30;
      if (isFav) score += 20;
      if (hasMeta) score += 10;
      if (canReadBook(book)) score += 5;
      return { book, score };
    });
    scored.sort(
      (a, b) =>
        b.score - a.score ||
        a.book.name.localeCompare(b.book.name, "es", {
          numeric: true,
          sensitivity: "base",
        }),
    );
    return scored.slice(0, 7).map((entry) => entry.book);
  })();

  const safeSpotlightIndex =
    spotlightBooks.length > 0 ? spotlightIndex % spotlightBooks.length : 0;
  const activeSpotlightBook = spotlightBooks[safeSpotlightIndex] ?? null;
  const [spotlightBackdropUrl, setSpotlightBackdropUrl] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!activeSpotlightBook) {
      setSpotlightBackdropUrl(null);
      return;
    }
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setSpotlightBackdropUrl(null);

    if (service.loadCover) {
      void service
        .loadCover(activeSpotlightBook, controller.signal)
        .then((blob) => {
          if (controller.signal.aborted || !blob) return;
          objectUrl = URL.createObjectURL(blob);
          setSpotlightBackdropUrl(objectUrl);
        })
        .catch(() => {});
    }

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [activeSpotlightBook?.path, service, generation.current]);

  useEffect(() => {
    if (spotlightBooks.length <= 1 || selectedBook !== null) return;
    const timer = window.setInterval(() => {
      setSpotlightIndex((current) => (current + 1) % spotlightBooks.length);
    }, 14000);
    return () => window.clearInterval(timer);
  }, [spotlightBooks.length, selectedBook, safeSpotlightIndex]);

  // Books currently in progress ("Continuar leyendo")
  const inProgressBooks = allUniqueBooks.filter((book) => {
    const progress = readStoredBookProgress(book.path);
    return progress !== null && progress.currentPage > 1;
  });

  // Recommended / featured shelf on the home screen
  const recommendedBooks = visible.slice(0, 18);

  const contents = directoryContents(visible, directory);
  const currentFolder = folders.find((folder) => folder.id === selectedFolder);
  const directories =
    selectedFolder === "all"
      ? folders
          .map((folder) => ({
            id: folder.id,
            name: folder.name,
            path: "",
            books: visible.filter((book) => book.folderId === folder.id),
          }))
          .filter(
            (folder) =>
              folder.books.length ||
              (!query.trim() &&
                filter === "all" &&
                !onlyFavorites &&
                format === "all"),
          )
      : contents.directories.map((folder) => ({
          ...folder,
          id: selectedFolder,
        }));

  const directBooks =
    activeMenu === "search" || activeMenu === "mylist"
      ? visible
      : selectedFolder === "all" &&
          !onlyFavorites &&
          filter === "all" &&
          !query.trim() &&
          format === "all"
        ? []
        : selectedFolder === "all"
          ? visible
          : contents.books;

  const isHomeOverview =
    activeMenu === "library" &&
    selectedFolder === "all" &&
    !directory &&
    filter === "all" &&
    !onlyFavorites &&
    !query.trim() &&
    format === "all";

  const itemCount =
    directories.length +
    directBooks.length +
    (isHomeOverview ? recommendedBooks.length : 0);
  const breadcrumbs = directory ? directory.split("/") : [];
  const matchingCount =
    selectedFolder === "all"
      ? new Set(visible.map((book) => book.path)).size
      : visible.filter((book) =>
          normalizeRelativePath(book.relativePath).startsWith(
            directory ? `${directory}/` : "",
          ),
        ).length;
  const disabled = scanning || loading;

  function renderBookCard(book: LibraryBook, keyPrefix = "grid") {
    const category = bookCategory(book);
    const readable = canReadBook(book);
    const savedMeta = getEffectiveBookMetadata(book.path);
    const decision = getStoredBookMetadataDecision(book.path);
    const userRating = getUserBookRating(book.path);
    const apiRating =
      savedMeta?.rating ??
      (decision?.status === "declined" ? decision.rating : null);
    const displayRating = userRating ?? apiRating;
    const progress = readStoredBookProgress(book.path);
    const progressPercent =
      progress && progress.totalPages && progress.totalPages > 0
        ? Math.min(
            100,
            Math.max(
              0,
              Math.round((progress.currentPage / progress.totalPages) * 100),
            ),
          )
        : 0;
    const cardTitle = savedMeta?.title ?? book.name.replace(/\.[^.]+$/, "");
    const cardSubtitle = savedMeta?.author
      ? `${savedMeta.author} · ${book.folderName}`
      : `${book.folderName} · ${book.relativePath}`;

    return (
      <article
        key={`${keyPrefix}-${book.path}`}
        className={`library-book library-book--${category}`}
      >
        <button
          className="library-book__open"
          disabled={disabled}
          onClick={() => setSelectedBook(book)}
          aria-label={`Ver detalles de ${cardTitle}`}
          title={book.relativePath}
        >
          <div className="library-book__poster-wrap">
            <LibraryCover
              book={book}
              loader={service.loadCover}
              revision={generation.current}
            />
            {displayRating && displayRating > 0 && (
              <span className="library-book__rating-badge">
                <StarIcon size={11} weight="fill" />
                {displayRating.toFixed(1)}
              </span>
            )}
            {progressPercent > 0 && (
              <div
                className="library-book__progress-bar"
                title={`${progressPercent}% leído`}
              >
                <span style={{ width: `${progressPercent}%` }} />
              </div>
            )}
          </div>
          <h2>{cardTitle}</h2>
        </button>
        <p title={cardSubtitle}>{cardSubtitle}</p>
        <span className={`library-book__status${readable ? " is-readable" : ""}`}>
          {readable ? "Ver detalles" : "Lectura aún no disponible"}
        </span>
      </article>
    );
  }

  const spotlightMeta = activeSpotlightBook
    ? getEffectiveBookMetadata(activeSpotlightBook.path)
    : null;
  const spotlightCategory = activeSpotlightBook
    ? bookCategory(activeSpotlightBook)
    : "books";
  const spotlightTitle = activeSpotlightBook
    ? (spotlightMeta?.title ??
      activeSpotlightBook.name.replace(/\.[^.]+$/, "").replace(/_/g, " "))
    : "";
  const spotlightAuthor = activeSpotlightBook
    ? (spotlightMeta?.author ??
      activeSpotlightBook.folderName ??
      CATEGORY_LABELS[spotlightCategory])
    : "";
  const spotlightProgress = activeSpotlightBook
    ? readStoredBookProgress(activeSpotlightBook.path)
    : null;
  const spotlightDesc =
    spotlightMeta?.description ??
    (activeSpotlightBook
      ? `${CATEGORY_LABELS[spotlightCategory]} en formato ${activeSpotlightBook.format.toUpperCase()} dentro de tu colección «${activeSpotlightBook.folderName ?? "Biblioteca"}». Abre su ficha para consultar sinopsis, calificaciones y comenzar a leer.`
      : "");
  const isSpotlightEdited = Boolean(spotlightMeta?.source.includes("Editado"));
  const resolvedSpotlightBackdropUrl =
    isSpotlightEdited && spotlightMeta?.coverUrl
      ? spotlightMeta.coverUrl
      : (spotlightBackdropUrl ?? spotlightMeta?.coverUrl ?? null);

  return (
    <>
      <div hidden={selectedBook !== null}>
        <main className="library-shell">
          <aside
            className="library-sidebar"
            aria-label="Menú principal de la biblioteca"
          >
            <button
              type="button"
              className="library-brand"
              onClick={resetToHome}
              title="Ir a Biblioteca"
            >
              <BooksIcon size={28} weight="duotone" />
              <span>
                Universal<span>Reader</span>
              </span>
            </button>

            <nav className="library-sidebar__nav" aria-label="Secciones">
              <button
                type="button"
                className={`library-sidebar__item${activeMenu === "library" ? " is-active" : ""}`}
                onClick={() => selectMenu("library")}
              >
                <BooksIcon
                  size={20}
                  weight={activeMenu === "library" ? "fill" : "regular"}
                />
                <span>Biblioteca</span>
                <span className="library-count">{allUniqueBooks.length}</span>
              </button>

              <button
                type="button"
                className={`library-sidebar__item${activeMenu === "search" ? " is-active" : ""}`}
                onClick={() => selectMenu("search")}
              >
                <MagnifyingGlassIcon
                  size={20}
                  weight={activeMenu === "search" ? "bold" : "regular"}
                />
                <span>Buscar</span>
              </button>

              <button
                type="button"
                className={`library-sidebar__item${activeMenu === "mylist" ? " is-active" : ""}`}
                onClick={() => selectMenu("mylist")}
              >
                <BookmarkSimpleIcon
                  size={20}
                  weight={activeMenu === "mylist" ? "fill" : "regular"}
                />
                <span>Mi lista</span>
                {categoryCounts.favorites > 0 && (
                  <span className="library-count">
                    {categoryCounts.favorites}
                  </span>
                )}
              </button>

              <button
                type="button"
                className={`library-sidebar__item${activeMenu === "collections" ? " is-active" : ""}`}
                onClick={() => selectMenu("collections")}
              >
                <StackIcon
                  size={20}
                  weight={activeMenu === "collections" ? "fill" : "regular"}
                />
                <span>Gestionar Colecciones</span>
                <span className="library-count">{folders.length}</span>
              </button>

              <button
                type="button"
                className={`library-sidebar__item${activeMenu === "settings" ? " is-active" : ""}`}
                onClick={() => selectMenu("settings")}
              >
                <GearSixIcon
                  size={20}
                  weight={activeMenu === "settings" ? "fill" : "regular"}
                />
                <span>Ajustes</span>
              </button>
            </nav>

            <div className="library-sidebar__footer">
              <div className="library-local">
                <span className="library-local__dot" />
                <span>Tu biblioteca, en tu dispositivo</span>
                <button
                  type="button"
                  className="library-icon"
                  onClick={() => void perform()}
                  disabled={disabled}
                  aria-label="Actualizar biblioteca"
                  title="Actualizar biblioteca"
                >
                  <ArrowClockwiseIcon
                    size={16}
                    className={scanning ? "is-spinning" : ""}
                  />
                </button>
              </div>
            </div>
          </aside>

          <section className="library-main" aria-label="Biblioteca">
            {(error || libraryError) && (
              <p className="library-notice library-notice--error" role="alert">
                {error || libraryError}
              </p>
            )}
            {settingsNotice && (
              <p className="library-notice" role="status">
                {settingsNotice}
              </p>
            )}
            {folders
              .filter((f) => f.error || f.warnings.length)
              .map((f) => (
                <p className="library-notice" key={f.id} role="status">
                  <strong>{f.name}:</strong>{" "}
                  {f.error ||
                    [...new Set(f.warnings)].slice(0, 3).join(" · ")}
                  {f.error &&
                    " Vuelve a conectar la unidad o añade la colección de nuevo y pulsa Actualizar."}
                </p>
              ))}

            {activeMenu === "settings" ? (
              <section
                className="library-settings"
                aria-label="Ajustes de Universal Reader"
              >
                <header className="library-section-header">
                  <div>
                    <span className="library-eyebrow">PREFERENCIAS</span>
                    <h1>Ajustes</h1>
                    <p>
                      Administra los datos locales, caché de metadatos e
                      historial de tu biblioteca.
                    </p>
                  </div>
                </header>

                <div className="library-settings__grid">
                  <article className="library-settings__card">
                    <div>
                      <h3>Metadatos y catálogos públicos</h3>
                      <p>
                        Restablece las decisiones y ediciones guardadas para
                        volver a consultar las APIs públicas al abrir un libro.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="library-button"
                      onClick={() => {
                        window.localStorage.removeItem(METADATA_DECISIONS_KEY);
                        setMetadataRevision((v) => v + 1);
                        setSettingsNotice(
                          "Se restablecieron los metadatos descargados y editados.",
                        );
                      }}
                    >
                      Restablecer metadatos
                    </button>
                  </article>

                  <article className="library-settings__card">
                    <div>
                      <h3>Progreso de lectura</h3>
                      <p>
                        Limpia el registro de páginas actuales y porcentaje de
                        lectura acumulado en tus archivos.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="library-button"
                      onClick={() => {
                        window.localStorage.removeItem(PROGRESS_STORAGE_KEY);
                        setMetadataRevision((v) => v + 1);
                        setSettingsNotice(
                          "Se reinició el historial de progreso de lectura.",
                        );
                      }}
                    >
                      Reiniciar progreso
                    </button>
                  </article>

                  <article className="library-settings__card">
                    <div>
                      <h3>Mi lista y calificaciones personales</h3>
                      <p>
                        Borra los libros guardados en «Mi lista» y tus
                        calificaciones personales con estrellas.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="library-button"
                      onClick={() => {
                        window.localStorage.removeItem(BOOKMARKS_STORAGE_KEY);
                        window.localStorage.removeItem(USER_RATINGS_KEY);
                        setMetadataRevision((v) => v + 1);
                        setSettingsNotice(
                          "Se vaciaron «Mi lista» y tus calificaciones personales.",
                        );
                      }}
                    >
                      Limpiar lista y notas
                    </button>
                  </article>

                  <article className="library-settings__card">
                    <div>
                      <h3>Sincronización de colecciones</h3>
                      <p>
                        Escanea nuevamente todas tus carpetas locales para
                        detectar nuevos libros, cómics, manga o documentos.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="library-button library-button--primary"
                      disabled={disabled}
                      onClick={() => void perform()}
                    >
                      <ArrowClockwiseIcon
                        size={17}
                        className={scanning ? "is-spinning" : ""}
                      />
                      <span>Actualizar todas las colecciones</span>
                    </button>
                  </article>
                </div>
              </section>
            ) : activeMenu === "collections" ? (
              <section
                className="library-collections-manager"
                aria-label="Gestionar Colecciones"
              >
                <header className="library-section-header">
                  <div>
                    <span className="library-eyebrow">CARPETAS LOCALES</span>
                    <h1>Gestionar Colecciones</h1>
                    <p>
                      Añade carpetas de tu dispositivo, explora su contenido o
                      quítalas de la biblioteca sin borrar tus archivos.
                    </p>
                  </div>
                  <div className="library-section-header__actions">
                    <button
                      type="button"
                      className="library-button"
                      disabled={disabled}
                      onClick={() => void perform()}
                    >
                      <ArrowClockwiseIcon
                        size={18}
                        className={scanning ? "is-spinning" : ""}
                      />
                      <span>Actualizar</span>
                    </button>
                    <button
                      type="button"
                      className="library-button"
                      disabled={disabled}
                      onClick={onOpenFile}
                    >
                      <BookOpenIcon size={18} />
                      <span>Abrir archivo</span>
                    </button>
                    <button
                      type="button"
                      className="library-button library-button--primary"
                      disabled={disabled}
                      onClick={() => void perform(service.pickFolder)}
                    >
                      <StackPlusIcon size={19} />
                      <span>Añadir colección</span>
                    </button>
                  </div>
                </header>

                {folders.length > 0 ? (
                  <div className="library-directory-grid">
                    {folders.map((folder) => {
                      const { previews, childCount, categories } =
                        folderPreview(folder.books, "");
                      return (
                        <div
                          key={folder.id}
                          className="library-directory-card"
                        >
                          <button
                            type="button"
                            className="library-directory"
                            aria-label={`Abrir colección ${folder.name}`}
                            onClick={() => navigate(folder.id, "")}
                          >
                            <div
                              className="library-directory__preview"
                              data-count={previews.length}
                              aria-hidden="true"
                            >
                              {previews.length ? (
                                previews.map((book) => (
                                  <LibraryCover
                                    key={book.path}
                                    book={book}
                                    loader={service.loadCover}
                                    revision={generation.current}
                                  />
                                ))
                              ) : (
                                <StackIcon size={48} weight="thin" />
                              )}
                            </div>
                            <span className="library-directory__name">
                              <StackIcon size={17} aria-hidden="true" />
                              <span>{folder.name}</span>
                            </span>
                            <span className="library-directory__categories">
                              {categories
                                .map((category) => CATEGORY_LABELS[category])
                                .join(" · ") || "Colección"}
                            </span>
                            <span className="library-directory__count">
                              <span>
                                {childCount > 0 &&
                                  `${childCount} ${childCount === 1 ? "subcarpeta" : "subcarpetas"} · `}
                                {folder.books.length}{" "}
                                {folder.books.length === 1
                                  ? "archivo"
                                  : "archivos"}
                              </span>
                              <CaretRightIcon size={15} />
                            </span>
                          </button>
                          <button
                            type="button"
                            className="library-icon library-directory-card__remove"
                            title="Quitar de la biblioteca (conserva los archivos)"
                            aria-label={`Quitar colección ${folder.name}`}
                            disabled={disabled}
                            onClick={() =>
                              void perform(async () => {
                                await service.removeFolder(folder.id);
                                if (selectedFolder === folder.id) {
                                  setSelectedFolder("all");
                                  setDirectory("");
                                }
                              })
                            }
                          >
                            <TrashIcon size={15} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="library-empty">
                    <div className="library-empty__icon">
                      <StackIcon size={44} weight="thin" />
                    </div>
                    <h2>Aún no has añadido colecciones</h2>
                    <p>
                      Selecciona una carpeta de tu dispositivo para organizar
                      automáticamente tus libros, cómics, manga y documentos.
                    </p>
                    <button
                      type="button"
                      className="library-button library-button--primary"
                      disabled={disabled}
                      onClick={() => void perform(service.pickFolder)}
                    >
                      <StackPlusIcon size={20} />
                      <span>Añadir mi primera colección</span>
                    </button>
                  </div>
                )}
              </section>
            ) : (
              <>
                {(activeMenu === "search" ||
                  Boolean(query.trim()) ||
                  format !== "all") && (
                  <div className="library-search-drawer">
                    <label className="library-search">
                      <MagnifyingGlassIcon size={20} />
                      <input
                        ref={searchInputRef}
                        aria-label="Buscar en la biblioteca"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Buscar por título, autor o colección…"
                        type="search"
                      />
                    </label>

                    <select
                      aria-label="Filtrar por colección"
                      value={selectedFolder}
                      onChange={(e) => {
                        setSelectedFolder(e.target.value);
                        setDirectory("");
                      }}
                    >
                      <option value="all">Todas las colecciones</option>
                      {folders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name} ({f.books.length})
                        </option>
                      ))}
                    </select>

                    <select
                      aria-label="Filtrar por formato"
                      value={format}
                      onChange={(e) => setFormat(e.target.value)}
                    >
                      <option value="all">Todos los formatos</option>
                      {format !== "all" && !formats.includes(format) && (
                        <option value={format}>{format.toUpperCase()}</option>
                      )}
                      {formats.map((f) => (
                        <option key={f} value={f}>
                          {f.toUpperCase()}
                        </option>
                      ))}
                    </select>

                    <span
                      className="library-search-drawer__status"
                      role="status"
                    >
                      {loading
                        ? "Abriendo documento…"
                        : scanning
                          ? "Explorando colecciones…"
                          : `${matchingCount} ${matchingCount === 1 ? "archivo" : "archivos"}`}
                    </span>
                  </div>
                )}

                {activeMenu === "library" && activeSpotlightBook && (
                  <section
                    className="library-spotlight"
                    aria-label="Lectura destacada"
                  >
                    <div className="library-spotlight__stage">
                      {spotlightBooks.length > 1 && (
                        <button
                          type="button"
                          className="library-spotlight__arrow library-spotlight__arrow--prev"
                          onClick={() =>
                            setSpotlightIndex(
                              (current) =>
                                (current - 1 + spotlightBooks.length) %
                                spotlightBooks.length,
                            )
                          }
                          aria-label="Destacado anterior"
                        >
                          <CaretLeftIcon size={24} weight="bold" />
                        </button>
                      )}

                      <div
                        className={`library-spotlight__banner library-spotlight__banner--${spotlightCategory}`}
                        onClick={() => setSelectedBook(activeSpotlightBook)}
                      >
                        {resolvedSpotlightBackdropUrl && (
                          <div
                            key={`bg-${activeSpotlightBook.path}-${resolvedSpotlightBackdropUrl}`}
                            className="library-spotlight__bg-clip"
                            aria-hidden="true"
                          >
                            <div
                              className="library-spotlight__bg"
                              style={{
                                backgroundImage: `url(${resolvedSpotlightBackdropUrl})`,
                              }}
                            />
                          </div>
                        )}
                        <div
                          key={`content-${activeSpotlightBook.path}`}
                          className="library-spotlight__content"
                        >
                          <div className="library-spotlight__badges">
                            <span className="library-spotlight__pill library-spotlight__pill--accent">
                              {spotlightProgress &&
                              spotlightProgress.currentPage > 1
                                ? "CONTINUAR LECTURA"
                                : "DESTACADO EN TU BIBLIOTECA"}
                            </span>
                            <span className="library-spotlight__pill">
                              {CATEGORY_LABELS[spotlightCategory].toUpperCase()}{" "}
                              · {activeSpotlightBook.format.toUpperCase()}
                            </span>
                            {spotlightProgress &&
                              spotlightProgress.currentPage > 1 && (
                                <span className="library-spotlight__pill">
                                  Pág. {spotlightProgress.currentPage}
                                  {spotlightProgress.totalPages
                                    ? ` / ${spotlightProgress.totalPages}`
                                    : ""}
                                </span>
                              )}
                          </div>

                          <h1
                            className="library-spotlight__title"
                            title={spotlightTitle}
                          >
                            {spotlightTitle}
                          </h1>
                          <p className="library-spotlight__author">
                            {spotlightAuthor}
                          </p>
                          <p className="library-spotlight__desc">
                            {spotlightDesc}
                          </p>

                          <div
                            className="library-spotlight__actions"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {canReadBook(activeSpotlightBook) && (
                              <button
                                type="button"
                                className="library-spotlight__btn library-spotlight__btn--primary"
                                disabled={disabled}
                                onClick={() => onOpenBook(activeSpotlightBook)}
                              >
                                <BookOpenIcon size={18} weight="fill" />
                                <span>
                                  {spotlightProgress &&
                                  spotlightProgress.currentPage > 1
                                    ? "Continuar leyendo"
                                    : "Comenzar lectura"}
                                </span>
                              </button>
                            )}
                            <button
                              type="button"
                              className="library-spotlight__btn library-spotlight__btn--secondary"
                              disabled={disabled}
                              onClick={() =>
                                setSelectedBook(activeSpotlightBook)
                              }
                            >
                              <span>Ver detalles</span>
                            </button>
                          </div>
                        </div>

                        <div
                          key={`visual-${activeSpotlightBook.path}`}
                          className="library-spotlight__Visual"
                        >
                          <div className="library-spotlight__cover">
                            <LibraryCover
                              book={activeSpotlightBook}
                              loader={service.loadCover}
                              revision={generation.current}
                            />
                          </div>
                        </div>
                      </div>

                      {spotlightBooks.length > 1 && (
                        <button
                          type="button"
                          className="library-spotlight__arrow library-spotlight__arrow--next"
                          onClick={() =>
                            setSpotlightIndex(
                              (current) =>
                                (current + 1) % spotlightBooks.length,
                            )
                          }
                          aria-label="Siguiente destacado"
                        >
                          <CaretRightIcon size={24} weight="bold" />
                        </button>
                      )}
                    </div>

                    {spotlightBooks.length > 1 && (
                      <div
                        className="library-spotlight__dots"
                        role="tablist"
                        aria-label="Seleccionar libro destacado"
                      >
                        {spotlightBooks.map((item, idx) => (
                          <button
                            key={item.path}
                            type="button"
                            role="tab"
                            aria-selected={idx === safeSpotlightIndex}
                            aria-label={`Destacado ${idx + 1}: ${item.name}`}
                            className={`library-spotlight__dot${idx === safeSpotlightIndex ? " is-active" : ""}`}
                            onClick={() => setSpotlightIndex(idx)}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {activeMenu === "library" && (
                  <section
                    className="library-hubs"
                    aria-label="Categorías de lectura"
                  >
                    {HUB_ITEMS.map((hub) => {
                      const active = !onlyFavorites && filter === hub.id;
                      const count = categoryCounts[hub.id];
                      return (
                        <button
                          key={hub.id}
                          type="button"
                          className={`library-hub${active ? " is-active" : ""}`}
                          onClick={() => {
                            if (hub.id === "all") {
                              resetToHome();
                            } else {
                              setOnlyFavorites(false);
                              setFilter(filter === hub.id ? "all" : hub.id);
                            }
                          }}
                        >
                          <span className="library-hub__title">{hub.title}</span>
                          <span className="library-hub__meta">
                            {hub.subtitle} · {count}
                          </span>
                        </button>
                      );
                    })}
                  </section>
                )}

                {(selectedFolder !== "all" || directory) && (
                  <nav
                    className="library-breadcrumbs"
                    aria-label="Ruta de colecciones"
                  >
                    <button
                      className="library-icon"
                      aria-label="Subir un nivel"
                      onClick={() =>
                        directory
                          ? navigate(
                              selectedFolder,
                              breadcrumbs.slice(0, -1).join("/"),
                            )
                          : navigate("all")
                      }
                    >
                      <ArrowLeftIcon size={18} />
                    </button>
                    <button
                      aria-current={
                        selectedFolder === "all" ? "page" : undefined
                      }
                      onClick={() => navigate("all")}
                    >
                      Biblioteca
                    </button>
                    {currentFolder && (
                      <>
                        <CaretRightIcon size={13} aria-hidden="true" />
                        <button
                          aria-current={!directory ? "page" : undefined}
                          onClick={() => navigate(selectedFolder)}
                        >
                          {currentFolder.name}
                        </button>
                      </>
                    )}
                    {breadcrumbs.map((part, index) => (
                      <span key={index}>
                        <CaretRightIcon size={13} aria-hidden="true" />
                        <button
                          aria-current={
                            index === breadcrumbs.length - 1
                              ? "page"
                              : undefined
                          }
                          onClick={() =>
                            navigate(
                              selectedFolder,
                              breadcrumbs.slice(0, index + 1).join("/"),
                            )
                          }
                        >
                          {part}
                        </button>
                      </span>
                    ))}
                  </nav>
                )}

                {isHomeOverview && inProgressBooks.length > 0 && (
                  <section
                    aria-label="Continuar leyendo"
                    className="library-group"
                  >
                    <h2 className="library-group__title">
                      Continuar leyendo <span>{inProgressBooks.length}</span>
                    </h2>
                    <div className="library-shelf">
                      {inProgressBooks
                        .slice(0, 12)
                        .map((book) => renderBookCard(book, "continue"))}
                    </div>
                  </section>
                )}

                {isHomeOverview && recommendedBooks.length > 0 && (
                  <section
                    aria-label="Recomendados para ti"
                    className="library-group"
                  >
                    <h2 className="library-group__title">
                      Recomendados para ti <span>{visible.length}</span>
                    </h2>
                    <div className="library-shelf">
                      {recommendedBooks.map((book) =>
                        renderBookCard(book, "recommended"),
                      )}
                    </div>
                  </section>
                )}

                {activeMenu === "library" && directories.length > 0 && (
                  <section aria-label="Colecciones" className="library-group">
                    <div className="library-group__header">
                      <h2 className="library-group__title">
                        {selectedFolder === "all"
                          ? "Tus colecciones"
                          : "Subcolecciones"}{" "}
                        <span>{directories.length}</span>
                      </h2>
                    </div>
                    <div className="library-directory-grid">
                      {directories.slice(0, visibleCount).map((folder) => {
                        const { previews, childCount, categories } =
                          folderPreview(folder.books, folder.path);
                        const isRootFolder =
                          selectedFolder === "all" && !folder.path;
                        return (
                          <div
                            key={`${folder.id}\0${folder.path}`}
                            className="library-directory-card"
                          >
                            <button
                              type="button"
                              className="library-directory"
                              aria-label={`Abrir colección ${folder.name}`}
                              onClick={() => navigate(folder.id, folder.path)}
                            >
                              <div
                                className="library-directory__preview"
                                data-count={previews.length}
                                aria-hidden="true"
                              >
                                {previews.length ? (
                                  previews.map((book) => (
                                    <LibraryCover
                                      key={book.path}
                                      book={book}
                                      loader={service.loadCover}
                                      revision={generation.current}
                                    />
                                  ))
                                ) : (
                                  <StackIcon size={48} weight="thin" />
                                )}
                              </div>
                              <span className="library-directory__name">
                                <StackIcon size={17} aria-hidden="true" />
                                <span>{folder.name}</span>
                              </span>
                              <span className="library-directory__categories">
                                {categories
                                  .map((category) => CATEGORY_LABELS[category])
                                  .join(" · ") || "Colección"}
                              </span>
                              <span className="library-directory__count">
                                <span>
                                  {childCount > 0 &&
                                    `${childCount} ${childCount === 1 ? "colección" : "colecciones"} · `}
                                  {folder.books.length}{" "}
                                  {folder.books.length === 1
                                    ? "archivo"
                                    : "archivos"}
                                </span>
                                <CaretRightIcon size={15} />
                              </span>
                            </button>
                            {isRootFolder && (
                              <button
                                type="button"
                                className="library-icon library-directory-card__remove"
                                title="Quitar de la biblioteca (conserva los archivos)"
                                aria-label={`Quitar colección ${folder.name}`}
                                disabled={disabled}
                                onClick={() =>
                                  void perform(async () => {
                                    await service.removeFolder(folder.id);
                                    if (selectedFolder === folder.id) {
                                      navigate("all");
                                    }
                                  })
                                }
                              >
                                <TrashIcon size={15} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {directBooks.length > 0 && (
                  <section
                    aria-label="Archivos de esta colección"
                    className="library-group"
                  >
                    <h2 className="library-group__title">
                      {activeMenu === "mylist" || onlyFavorites
                        ? "Mi lista"
                        : activeMenu === "search"
                          ? "Resultados de búsqueda"
                          : filter !== "all"
                            ? CATEGORY_LABELS[filter]
                            : "Archivos"}{" "}
                      <span>{directBooks.length}</span>
                    </h2>
                    <div className="library-grid">
                      {directBooks
                        .slice(
                          0,
                          Math.max(
                            0,
                            visibleCount -
                              (activeMenu === "library"
                                ? directories.length
                                : 0),
                          ),
                        )
                        .map((book) => renderBookCard(book, "direct"))}
                    </div>
                  </section>
                )}

                {!itemCount && (
                  <div className="library-empty">
                    <div className="library-empty__icon">
                      <BooksIcon size={44} weight="thin" />
                    </div>
                    <h2>
                      {scanning
                        ? "Buscando tus próximas lecturas"
                        : activeMenu === "mylist"
                          ? "Tu lista está vacía"
                          : folders.length
                            ? "No hay archivos para mostrar"
                            : "Tus historias empiezan aquí"}
                    </h2>
                    <p>
                      {activeMenu === "mylist"
                        ? "Abre el detalle de cualquier libro, cómic o manga y pulsa el icono de guardado para añadirlo a «Mi lista»."
                        : folders.length
                          ? "Prueba otros filtros o actualiza tus colecciones. Se incluyen los archivos de las subcolecciones."
                          : "Escoge una colección y reuniremos sus libros, cómics, manga y documentos en tu biblioteca."}
                    </p>
                    {!folders.length && (
                      <button
                        className="library-button library-button--primary"
                        disabled={disabled}
                        onClick={() => void perform(service.pickFolder)}
                      >
                        <StackPlusIcon size={20} />
                        Escoger mi primera colección
                      </button>
                    )}
                  </div>
                )}

                {itemCount > visibleCount && (
                  <button
                    className="library-button library-load-more"
                    onClick={() => setVisibleCount((count) => count + 60)}
                  >
                    Mostrar más · {itemCount - visibleCount} restantes
                  </button>
                )}
              </>
            )}

            <footer className="library-footer">
              Lectura disponible: PDF y EPUB. También puedes catalogar CBZ, CBR,
              CB7, CBT, MOBI, AZW, AZW3, FB2, DJVU y TXT.
            </footer>
          </section>
        </main>
      </div>

      {selectedBook && (
        <BookDetailModal
          book={selectedBook}
          loader={service.loadCover}
          revision={generation.current}
          disabled={disabled}
          onClose={() => setSelectedBook(null)}
          onStartReading={(book) => {
            setSelectedBook(null);
            onOpenBook(book);
          }}
        />
      )}
    </>
  );
}
