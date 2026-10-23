import type { LibraryBook } from "./LibrarySource";

export type BookCategory = "books" | "comics" | "manga" | "documents";
export const CATEGORY_LABELS: Record<BookCategory, string> = {
  books: "Libros", comics: "Cómics", manga: "Manga", documents: "Documentos",
};

function folderCategory(name: string): BookCategory | undefined {
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[_-]+/g, " ").trim().replace(/\s+/g, " ")
    .replace(/^(mis|my) /, "");
  if (/^(manga|mangas)$/.test(normalized)) return "manga";
  if (/^(comic|comics|historieta|historietas)$/.test(normalized)) return "comics";
  if (/^(libro|libros|book|books|ebook|ebooks|novela|novelas)$/.test(normalized)) return "books";
  if (/^(documento|documentos|document|documents)$/.test(normalized)) return "documents";
}

/** Honor the nearest category folder, including a separately selected root. */
export function bookCategory(book: LibraryBook): BookCategory {
  const folders = [book.folderName ?? "", ...book.relativePath.split(/[\\/]/).slice(0, -1)];
  for (const folder of folders.reverse()) {
    const category = folderCategory(folder);
    if (category) return category;
  }
  if (["cbz", "cbr", "cb7", "cbt"].includes(book.format)) return "comics";
  if (["pdf", "djvu", "txt"].includes(book.format)) return "documents";
  return "books";
}

/** Sample different child folders before taking additional books from one branch. */
export function folderPreview(books: LibraryBook[], directory: string) {
  const prefix = directory ? `${directory.replace(/\\/g, "/")}/` : "";
  const branches = new Map<string, LibraryBook[]>();
  const children = new Set<string>();
  const unique = [...new Map(books.map((book) => [book.path, book])).values()];
  for (const book of unique) {
    const relative = book.relativePath.replace(/\\/g, "/");
    if (!relative.startsWith(prefix)) continue;
    const parts = relative.slice(prefix.length).split("/");
    const branch = parts.length > 1 ? parts[0] : "";
    if (branch) children.add(branch);
    if (["txt", "djvu"].includes(book.format)) continue;
    const siblings = branches.get(branch) ?? [];
    siblings.push(book);
    branches.set(branch, siblings);
  }
  const groups = [...branches.entries()].sort(([a], [b]) => a.localeCompare(b, "es", { numeric: true }));
  const previews: LibraryBook[] = [];
  for (let depth = 0; previews.length < 3; depth++) {
    const next = groups.flatMap(([, group]) => group[depth] ? [group[depth]] : []);
    if (!next.length) break;
    previews.push(...next.slice(0, 3 - previews.length));
  }
  const categories = [...new Set(unique.map(bookCategory))];
  return { previews, childCount: children.size, categories };
}
