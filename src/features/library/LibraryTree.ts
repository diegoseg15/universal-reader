import type { LibraryBook } from "./LibrarySource";

export function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}

export type BookDirectory = { name: string; path: string; books: LibraryBook[] };

/** Only immediate children appear at each level; counts include descendants. */
export function directoryContents<T extends LibraryBook>(books: T[], directory: string) {
  const prefix = directory ? `${normalizeRelativePath(directory)}/` : "";
  const direct: T[] = [];
  const groups = new Map<string, BookDirectory>();
  for (const book of books) {
    const relative = normalizeRelativePath(book.relativePath);
    if (!relative.startsWith(prefix)) continue;
    const remainder = relative.slice(prefix.length);
    const slash = remainder.indexOf("/");
    if (slash < 0) { direct.push(book); continue; }
    const name = remainder.slice(0, slash);
    const path = prefix + name;
    const group = groups.get(path) ?? { name, path, books: [] };
    group.books.push(book);
    groups.set(path, group);
  }
  return {
    books: direct,
    directories: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "es", { numeric: true, sensitivity: "base" })),
  };
}
