import { invoke } from "@tauri-apps/api/core";

export type LibraryFolder = { id: string; name: string };
export type LibraryBook = {
  path: string;
  name: string;
  relativePath: string;
  format: string;
  size?: number;
  modified?: number | null;
  folderName?: string;
};
export type FolderScan = { books: LibraryBook[]; warnings: string[] };
export type LibraryService = {
  folders: () => Promise<LibraryFolder[]>;
  pickFolder: () => Promise<LibraryFolder | null>;
  scanFolder: (id: string) => Promise<FolderScan>;
  removeFolder: (id: string) => Promise<void>;
  loadCover?: (book: LibraryBook, signal: AbortSignal) => Promise<Blob | null>;
};

export const nativeLibrary: LibraryService = {
  folders: () => invoke("plugin:library|folders"),
  pickFolder: () => invoke("plugin:library|pick_folder"),
  scanFolder: (id) => invoke("plugin:library|scan_folder", { id }),
  removeFolder: (id) => invoke("plugin:library|remove_folder", { id }),
  loadCover: async (book, signal) => {
    const { loadNativeCover } = await import("./BookCoverSource");
    return loadNativeCover(book, signal);
  },
};

export function canReadBook(book: LibraryBook): boolean {
  return book.format === "pdf" || book.format === "epub";
}

export { bookCategory } from "./LibraryOrganization";
