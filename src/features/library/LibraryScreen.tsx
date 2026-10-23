import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  ArrowClockwiseIcon, ArrowLeftIcon, BookOpenIcon, BooksIcon, CaretRightIcon,
  MagnifyingGlassIcon, SquaresFourIcon, StackIcon, StackPlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import {
  bookCategory, canReadBook, nativeLibrary,
  type LibraryBook, type LibraryFolder, type LibraryService,
} from "./LibrarySource";
import "./LibraryScreen.css";
import { LibraryCover } from "./LibraryCover";
import { directoryContents, normalizeRelativePath } from "./LibraryTree";
import { CATEGORY_LABELS, folderPreview } from "./LibraryOrganization";

type Props = {
  loading: boolean;
  error: string | null;
  onOpenFile: () => void;
  onOpenBook: (book: LibraryBook) => void;
  service?: LibraryService;
};
type IndexedFolder = LibraryFolder & { books: LibraryBook[]; warnings: string[]; error?: string };
type Filter = "all" | "books" | "comics" | "manga" | "documents";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Todo" }, { id: "books", label: "Libros" },
  { id: "comics", label: "Cómics" }, { id: "manga", label: "Manga" }, { id: "documents", label: "Documentos" },
];
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function LibraryScreen({ loading, error, onOpenFile, onOpenBook, service = nativeLibrary }: Props) {
  const [folders, setFolders] = useState<IndexedFolder[]>([]);
  const [scanning, setScanning] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedFolder, setSelectedFolder] = useState("all");
  const [directory, setDirectory] = useState("");
  const [format, setFormat] = useState("all");
  const [visibleCount, setVisibleCount] = useState(60);
  const generation = useRef(0);
  const busy = useRef(false);
  const available = service !== nativeLibrary || isTauri();

  function navigate(folderId: string, path = ""): void {
    setSelectedFolder(folderId);
    setDirectory(normalizeRelativePath(path));
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
        indexed.push({ ...folder, books: [], warnings: [], error: message(cause) });
      }
      if (token !== generation.current) return;
      setFolders([...indexed]);
    }
    setFolders(indexed);
  }

  async function perform(action?: () => Promise<unknown>): Promise<void> {
    if (busy.current || loading) return;
    if (!available) {
      setLibraryError("Para acceder a tus colecciones, abre Universal Reader como aplicación de escritorio o Android.");
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
      if (token === generation.current) { busy.current = false; setScanning(false); }
    }
  }

  useEffect(() => {
    void perform();
    return () => { generation.current++; busy.current = false; };
  }, [service]);

  useEffect(() => { setVisibleCount(60); }, [query, filter, selectedFolder, directory, format]);

  const books = Array.from(new Map(folders
    .filter((folder) => selectedFolder === "all" || folder.id === selectedFolder)
    .flatMap((folder) => folder.books.map((book) => [`${folder.id}\0${book.path}`, { ...book, folderName: folder.name, folderId: folder.id }] as const))).values());
  const formats = [...new Set(folders.flatMap((folder) => folder.books.map((book) => book.format)))].sort();
  const visible = books.filter((book) =>
    (filter === "all" || bookCategory(book) === filter) &&
    (format === "all" || book.format === format) &&
    `${book.name} ${book.relativePath} ${book.folderName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()),
  ).sort((a, b) => a.name.localeCompare(b.name, "es", { numeric: true, sensitivity: "base" }));
  const contents = directoryContents(visible, directory);
  const currentFolder = folders.find((folder) => folder.id === selectedFolder);
  const directories = selectedFolder === "all"
    ? folders.map((folder) => ({
      id: folder.id, name: folder.name, path: "",
      books: visible.filter((book) => book.folderId === folder.id),
    })).filter((folder) => folder.books.length || (!query.trim() && filter === "all" && format === "all"))
    : contents.directories.map((folder) => ({ ...folder, id: selectedFolder }));
  const directBooks = selectedFolder === "all" ? [] : contents.books;
  const itemCount = directories.length + directBooks.length;
  const breadcrumbs = directory ? directory.split("/") : [];
  const matchingCount = selectedFolder === "all" ? new Set(visible.map((book) => book.path)).size
    : visible.filter((book) => normalizeRelativePath(book.relativePath).startsWith(directory ? `${directory}/` : "")).length;
  const disabled = scanning || loading;

  return (
    <main className="library-shell">
      <aside className="library-sidebar" aria-label="Colecciones de la biblioteca">
        <div className="library-brand"><BooksIcon size={27} weight="duotone" /><span>Universal<span>Reader</span></span></div>
        <span className="library-eyebrow">TU BIBLIOTECA</span>
        <button className={`library-folder ${selectedFolder === "all" ? "is-active" : ""}`} onClick={() => navigate("all")}>
          <SquaresFourIcon size={19} /><span>Todos los archivos</span><span className="library-count">{new Set(folders.flatMap((f) => f.books.map((b) => b.path))).size}</span>
        </button>
        <div className="library-sidebar__label"><span>COLECCIONES</span><button className="library-icon" aria-label="Añadir colección" onClick={() => void perform(service.pickFolder)} disabled={disabled}><StackPlusIcon size={20} /></button></div>
        <div className="library-folders">
          {folders.map((folder) => <div className="library-folder-row" key={folder.id}>
            <button title={folder.id} className={`library-folder ${selectedFolder === folder.id ? "is-active" : ""}`} onClick={() => navigate(folder.id)}><StackIcon size={18} /><span>{folder.name}</span><span className="library-count">{folder.books.length}</span></button>
            <button className="library-icon library-remove" title="Quitar de la biblioteca (conserva los archivos)" aria-label={`Quitar colección ${folder.name}`} disabled={disabled} onClick={() => void perform(async () => { await service.removeFolder(folder.id); if (selectedFolder === folder.id) navigate("all"); })}><TrashIcon size={16} /></button>
          </div>)}
          {!folders.length && <p className="library-sidebar__hint">Añade tus colecciones para reunir aquí tus lecturas.</p>}
        </div>
        <div className="library-local"><span className="library-local__dot" />Tu biblioteca, en tu dispositivo</div>
      </aside>

      <section className="library-main" aria-label="Biblioteca">
        <header className="library-header">
          <div><span className="library-eyebrow">UN ESPACIO PARA TUS HISTORIAS</span><h1>Mi biblioteca<span>.</span></h1><p>Libros, cómics y mundos por descubrir.</p></div>
          <div className="library-actions">
            <button className="library-button" onClick={onOpenFile} disabled={disabled}><BookOpenIcon size={19} />Abrir archivo</button>
            <button className="library-button library-button--primary" onClick={() => void perform(service.pickFolder)} disabled={disabled}><StackPlusIcon size={20} />Añadir colección</button>
          </div>
        </header>

        {(error || libraryError) && <p className="library-notice library-notice--error" role="alert">{error || libraryError}</p>}
        {folders.filter((f) => f.error || f.warnings.length).map((f) => <p className="library-notice" key={f.id} role="status"><strong>{f.name}:</strong> {f.error || [...new Set(f.warnings)].slice(0, 3).join(" · ")}{f.error && " Vuelve a conectar la unidad o añade la colección de nuevo y pulsa Actualizar."}</p>)}

        <div className="library-toolbar">
          <label className="library-search"><MagnifyingGlassIcon size={20} /><input aria-label="Buscar en la biblioteca" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por título o colección…" type="search" /></label>
          <select aria-label="Filtrar por formato" value={format} onChange={(e) => setFormat(e.target.value)}><option value="all">Todos los formatos</option>{format !== "all" && !formats.includes(format) && <option value={format}>{format.toUpperCase()}</option>}{formats.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}</select>
          <button className="library-button library-refresh" onClick={() => void perform()} disabled={disabled} aria-label="Actualizar biblioteca"><ArrowClockwiseIcon size={19} className={scanning ? "is-spinning" : ""} /><span>Actualizar</span></button>
        </div>
        <div className="library-filters" role="group" aria-label="Tipo de lectura">
          {FILTERS.map((item) => <button key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}
          <span role="status">{loading ? "Abriendo documento…" : scanning ? "Explorando colecciones…" : `${matchingCount} ${matchingCount === 1 ? "archivo" : "archivos"}`}</span>
        </div>

        <nav className="library-breadcrumbs" aria-label="Ruta de colecciones">
          {selectedFolder !== "all" && <button className="library-icon" aria-label="Subir un nivel" onClick={() => directory ? navigate(selectedFolder, breadcrumbs.slice(0, -1).join("/")) : navigate("all")}><ArrowLeftIcon size={18} /></button>}
          <button aria-current={selectedFolder === "all" ? "page" : undefined} onClick={() => navigate("all")}>Biblioteca</button>
          {currentFolder && <><CaretRightIcon size={13} aria-hidden="true" /><button aria-current={!directory ? "page" : undefined} onClick={() => navigate(selectedFolder)}>{currentFolder.name}</button></>}
          {breadcrumbs.map((part, index) => <span key={index}><CaretRightIcon size={13} aria-hidden="true" /><button aria-current={index === breadcrumbs.length - 1 ? "page" : undefined} onClick={() => navigate(selectedFolder, breadcrumbs.slice(0, index + 1).join("/"))}>{part}</button></span>)}
        </nav>

        {directories.length > 0 && <section aria-label="Colecciones" className="library-group">
          <h2 className="library-group__title">Colecciones <span>{directories.length}</span></h2>
          <div className="library-directory-grid">
            {directories.slice(0, visibleCount).map((folder) => {
              const { previews, childCount, categories } = folderPreview(folder.books, folder.path);
              return <button key={`${folder.id}\0${folder.path}`} className="library-directory" aria-label={`Abrir colección ${folder.name}`} onClick={() => navigate(folder.id, folder.path)}>
                <div className="library-directory__preview" data-count={previews.length} aria-hidden="true">
                  {previews.length ? previews.map((book) => <LibraryCover key={book.path} book={book} loader={service.loadCover} revision={generation.current} />) : <StackIcon size={48} weight="thin" />}
                </div>
                <span className="library-directory__name"><StackIcon size={17} aria-hidden="true" /><span>{folder.name}</span></span>
                <span className="library-directory__categories">{categories.map((category) => CATEGORY_LABELS[category]).join(" · ") || "Colección"}</span>
                <span className="library-directory__count"><span>{childCount > 0 && `${childCount} ${childCount === 1 ? "colección" : "colecciones"} · `}{folder.books.length} {folder.books.length === 1 ? "archivo" : "archivos"}</span><CaretRightIcon size={15} /></span>
              </button>;
            })}
          </div>
        </section>}

        {directBooks.length > 0 && <section aria-label="Archivos de esta colección" className="library-group">
          <h2 className="library-group__title">Archivos <span>{directBooks.length}</span></h2>
          <div className="library-grid">
          {directBooks.slice(0, Math.max(0, visibleCount - directories.length)).map((book) => {
            const category = bookCategory(book);
            const readable = canReadBook(book);
            return <article key={book.path} className={`library-book library-book--${category}`}>
              <button className="library-book__open" disabled={disabled || !readable} onClick={() => onOpenBook(book)} aria-label={readable ? `Leer ${book.name}` : `${book.name}: lectura de ${book.format.toUpperCase()} aún no disponible`} title={book.relativePath}>
                <LibraryCover book={book} loader={service.loadCover} revision={generation.current} />
                <h2>{book.name.replace(/\.[^.]+$/, "")}</h2>
              </button>
              <p title={book.relativePath}>{book.folderName} · {book.relativePath}</p>
              <span className={`library-book__status${readable ? " is-readable" : ""}`}>{readable ? "Abrir lector" : "Lectura aún no disponible"}</span>
            </article>;
          })}
        </div></section>}
        {!itemCount && <div className="library-empty"><div className="library-empty__icon"><BooksIcon size={44} weight="thin" /></div><h2>{scanning ? "Buscando tus próximas lecturas" : folders.length ? "No hay archivos para mostrar" : "Tus historias empiezan aquí"}</h2><p>{folders.length ? "Prueba otros filtros o actualiza tus colecciones. Se incluyen los archivos de las subcolecciones." : "Escoge una colección y reuniremos sus libros, cómics, manga y documentos en tu biblioteca."}</p>{!folders.length && <button className="library-button library-button--primary" disabled={disabled} onClick={() => void perform(service.pickFolder)}><StackPlusIcon size={20} />Escoger mi primera colección</button>}</div>}
        {itemCount > visibleCount && <button className="library-button library-load-more" onClick={() => setVisibleCount((count) => count + 60)}>Mostrar más · {itemCount - visibleCount} restantes</button>}
        <footer className="library-footer">Lectura disponible: PDF y EPUB. También puedes catalogar CBZ, CBR, CB7, CBT, MOBI, AZW, AZW3, FB2, DJVU y TXT.</footer>
      </section>
    </main>
  );
}
