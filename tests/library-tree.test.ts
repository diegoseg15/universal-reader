import { test } from "node:test";
import assert from "node:assert/strict";
import { directoryContents, normalizeRelativePath } from "../src/features/library/LibraryTree.ts";

const book = (relativePath: string) => ({ path: relativePath, name: relativePath.split(/[\\/]/).at(-1)!, relativePath, format: relativePath.split(".").at(-1)!.toLowerCase() });

test("groups immediate subfolders without flattening nested volumes", () => {
  const books = [book("Manga/Serie A/01.cbz"), book("Manga/Serie A/02.cbz"), book("Manga/Serie B/01.cbz"), book("manual.pdf")];
  const root = directoryContents(books, "");
  assert.deepEqual(root.directories.map((d) => [d.name, d.books.length]), [["Manga", 3]]);
  assert.deepEqual(root.books.map((b) => b.name), ["manual.pdf"]);
  const manga = directoryContents(books, "Manga");
  assert.deepEqual(manga.directories.map((d) => [d.path, d.books.length]), [["Manga/Serie A", 2], ["Manga/Serie B", 1]]);
  assert.equal(manga.books.length, 0);
  assert.equal(directoryContents(books, "Manga/Serie A").books.length, 2);
});

test("handles Windows and Android separators consistently", () => {
  const contents = directoryContents([book("Comics\\Batman\\01.cbz"), book("Comics/Batman/02.cbz")], "Comics\\Batman");
  assert.equal(contents.books.length, 2);
  assert.equal(normalizeRelativePath("/Comics\\Batman//"), "Comics/Batman");
});

test("keeps similar sibling names and identically named series separate", () => {
  const books = [book("Manga/Serie/01.cbz"), book("Manga/Serie Extra/02.cbz"), book("Libros/Serie/03.epub")];
  assert.equal(directoryContents(books, "Manga/Serie").books.length, 1);
  assert.equal(directoryContents(books, "Libros/Serie").books[0].name, "03.epub");
});

test("counts only matching descendants and sorts folders naturally", () => {
  const books = [book("Volumen 10/01.cbz"), book("Volumen 2/01.cbz")];
  assert.deepEqual(directoryContents(books, "").directories.map((d) => d.name), ["Volumen 2", "Volumen 10"]);
  assert.equal(directoryContents(books.filter((b) => b.relativePath.includes("10")), "").directories.length, 1);
  assert.deepEqual(directoryContents(books, "No existe"), { books: [], directories: [] });
});


test("classifies by the nearest category folder rather than the file extension", async () => {
  const { bookCategory } = await import("../src/features/library/LibraryOrganization.ts");
  assert.equal(bookCategory(book("mangas/Serie/Tomo 01.cbz")), "manga");
  assert.equal(bookCategory(book("CÓMICS/Serie/Tomo 01.pdf")), "comics");
  assert.equal(bookCategory(book("libros/Historia.pdf")), "books");
  assert.equal(bookCategory({ ...book("Serie/Tomo 01.cbz"), folderName: "Mis mangas" }), "manga");
  assert.equal(bookCategory(book("Libros/Documentos/Apuntes.pdf")), "documents");
  assert.equal(bookCategory(book("Manga Studio/Libro.epub")), "books");
  assert.equal(bookCategory(book("Sin categoría/Tomo 01.cbz")), "comics");
});

test("folder previews sample different branches instead of only the first series", async () => {
  const { folderPreview } = await import("../src/features/library/LibraryOrganization.ts");
  const books = [book("comics/A/01.cbz"), book("comics/A/02.cbz"), book("comics/A/03.cbz"), book("libros/A.epub"), book("mangas/B/01.cbz")];
  const preview = folderPreview(books, "");
  assert.deepEqual(preview.previews.map((b) => b.relativePath.split("/")[0]), ["comics", "libros", "mangas"]);
  assert.equal(preview.childCount, 3);
  assert.deepEqual(preview.categories, ["comics", "books", "manga"]);
  assert.equal(folderPreview(books, "comics").childCount, 1);
  assert.equal(folderPreview(books, "mangas/B").previews.length, 1);
  assert.equal(folderPreview([], "").previews.length, 0);
});
