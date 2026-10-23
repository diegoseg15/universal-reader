import { SeekMode, type FileHandle } from "@tauri-apps/plugin-fs";

import type { FoliateBook, FoliateTocItem } from "foliate-js/view.js";

export type EpubSummary = {
  title: string;
  author: string;
  sectionCount: number;
  tocCount: number;
  fileName: string;
};

export type EpubInlineNode =
  | { kind: "text"; text: string }
  | { kind: "break" }
  | {
      kind: "strong" | "emphasis" | "code" | "sup" | "sub";
      children: EpubInlineNode[];
    };

export type EpubTextBlock =
  | {
      kind: "heading";
      level: number;
      content: EpubInlineNode[];
    }
  | {
      kind: "paragraph";
      content: EpubInlineNode[];
    }
  | {
      kind: "quote";
      blocks: EpubTextBlock[];
    }
  | {
      kind: "list";
      ordered: boolean;
      items: EpubTextBlock[][];
    }
  | {
      kind: "pre";
      text: string;
    }
  | {
      kind: "rule";
    };

export type EpubSectionContent = {
  blocks: EpubTextBlock[];
  recoveredFromHtml?: boolean;
  coverUrl?: string;
};

export type EpubTocEntry = {
  id: string;
  title: string;
  sectionIndex: number | null;
  depth: number;
};

export type EpubSession = {
  summary: EpubSummary;
  toc: EpubTocEntry[];
  progressId: string;
  readSection: (index: number) => Promise<EpubSectionContent>;
  close: () => Promise<void>;
};

const MAX_EPUB_BYTES = 128 * 1024 * 1024;
const MAX_RANGE_BYTES = 16 * 1024 * 1024;

export class NativeRangeSource {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: FileHandle,
    readonly size: number,
  ) {}

  read(begin: number, end: number): Promise<Uint8Array> {
    if (
      !Number.isSafeInteger(begin) ||
      !Number.isSafeInteger(end) ||
      begin < 0 ||
      end < begin ||
      end > this.size ||
      end - begin > MAX_RANGE_BYTES
    ) {
      return Promise.reject(
        new Error("Rango de lectura EPUB inválido o demasiado grande."),
      );
    }

    const request = this.queue.then(async () => {
      const result = new Uint8Array(end - begin);

      if (result.length === 0) {
        return result;
      }

      await this.file.seek(begin, SeekMode.Start);

      let offset = 0;

      while (offset < result.length) {
        const count = await this.file.read(result.subarray(offset));

        if (count === null || count <= 0) {
          throw new Error(
            `Lectura EPUB incompleta en el byte ${begin + offset}.`,
          );
        }

        offset += count;
      }

      return result;
    });

    this.queue = request.then(
      () => undefined,
      () => undefined,
    );

    return request;
  }

  async waitForIdle(): Promise<void> {
    await this.queue;
  }
}

const FINGERPRINT_SAMPLE_BYTES = 64 * 1024;

async function createEpubProgressId(
  source: NativeRangeSource,
): Promise<string> {
  const prefixEnd = Math.min(source.size, FINGERPRINT_SAMPLE_BYTES);

  const suffixStart = Math.max(
    prefixEnd,
    source.size - FINGERPRINT_SAMPLE_BYTES,
  );

  const prefix = await source.read(0, prefixEnd);
  const suffix = await source.read(suffixStart, source.size);

  const sampledBytes = new Uint8Array(4 + prefix.length + suffix.length);

  new DataView(sampledBytes.buffer).setUint32(0, source.size, true);

  sampledBytes.set(prefix, 4);
  sampledBytes.set(suffix, 4 + prefix.length);

  const digest = await crypto.subtle.digest("SHA-256", sampledBytes.buffer);

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function clampSliceIndex(index: number, size: number): number {
  if (Number.isNaN(index)) return 0;

  if (index === Infinity) return size;
  if (index === -Infinity) return 0;

  const integer = Math.trunc(index);

  return integer < 0 ? Math.max(size + integer, 0) : Math.min(integer, size);
}

/**
 * Minimal virtual Blob backed by a native file handle.
 *
 * Foliate's ZIP BlobReader uses:
 * - blob.size
 * - blob.slice(start, end)
 * - blob.arrayBuffer()
 *
 * It does not require loading the entire book up front.
 */
export class NativeFileBlob extends Blob {
  readonly name: string;

  constructor(
    private readonly source: NativeRangeSource,
    private readonly begin: number,
    private readonly end: number,
    name: string,
  ) {
    super([]);
    this.name = name;
  }

  override get size(): number {
    return this.end - this.begin;
  }

  override slice(start = 0, end = this.size, _contentType?: string): Blob {
    const relativeBegin = clampSliceIndex(start, this.size);
    const relativeEnd = Math.max(
      relativeBegin,
      clampSliceIndex(end, this.size),
    );

    return new NativeFileBlob(
      this.source,
      this.begin + relativeBegin,
      this.begin + relativeEnd,
      this.name,
    );
  }

  override async arrayBuffer(): Promise<ArrayBuffer> {
    const bytes = await this.source.read(this.begin, this.end);

    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);

    return buffer;
  }
}

function readableMetadata(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (Array.isArray(value)) {
    const values = value
      .map(readableMetadata)
      .filter((entry): entry is string => entry !== null);

    return values.join(", ") || null;
  }

  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;

    if ("name" in record) {
      return readableMetadata(record.name);
    }

    for (const key of ["es", "en", "und", ...Object.keys(record)]) {
      if (!(key in record)) continue;

      const text = readableMetadata(record[key]);

      if (text) return text;
    }
  }

  return null;
}

const MAX_SECTION_CHARACTERS = 1_000_000;
const MAX_SECTION_NODES = 50_000;
const MAX_SECTION_DEPTH = 64;

const IGNORED_ELEMENTS = new Set([
  "script",
  "style",
  "noscript",
  "iframe",
  "object",
  "embed",
  "form",
  "template",
  "svg",
  "head",
  "img",
  "video",
  "audio",
  "canvas",
  "math",
]);

const BLOCK_ELEMENTS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "hr",
  "div",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "aside",
  "nav",
  "figure",
  "figcaption",
  "center",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "dl",
  "dt",
  "dd",
]);

type ExtractionBudget = {
  characters: number;
  nodes: number;
};

function visitNode(budget: ExtractionBudget, depth: number): void {
  budget.nodes += 1;

  if (budget.nodes > MAX_SECTION_NODES || depth > MAX_SECTION_DEPTH) {
    throw new Error(
      "La estructura de la sección EPUB supera los límites permitidos.",
    );
  }
}

function consumeText(text: string, budget: ExtractionBudget): string {
  budget.characters += text.length;

  if (budget.characters > MAX_SECTION_CHARACTERS) {
    throw new Error("La sección EPUB supera el límite de texto permitido.");
  }

  return text;
}

function readInline(
  node: Node,
  budget: ExtractionBudget,
  depth: number,
): EpubInlineNode[] {
  visitNode(budget, depth);

  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? "").replace(/\s+/g, " ");

    return text
      ? [
          {
            kind: "text",
            text: consumeText(text, budget),
          },
        ]
      : [];
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return [];
  }

  const element = node as Element;
  const tag = element.localName.toLowerCase();

  if (IGNORED_ELEMENTS.has(tag)) {
    return [];
  }

  if (tag === "br") {
    return [{ kind: "break" }];
  }

  const children = Array.from(element.childNodes).flatMap((child) =>
    readInline(child, budget, depth + 1),
  );

  if (children.length === 0) {
    return [];
  }

  if (tag === "strong" || tag === "b") {
    return [{ kind: "strong", children }];
  }

  if (tag === "em" || tag === "i" || tag === "cite") {
    return [{ kind: "emphasis", children }];
  }

  if (tag === "code" || tag === "kbd" || tag === "samp" || tag === "tt") {
    return [{ kind: "code", children }];
  }

  if (tag === "sup" || tag === "sub") {
    return [{ kind: tag, children }];
  }

  // Unknown inline tags preserve their text,
  // but never transfer HTML attributes or styles.
  return children;
}

function readInlineChildren(
  element: Element,
  budget: ExtractionBudget,
  depth: number,
): EpubInlineNode[] {
  return Array.from(element.childNodes).flatMap((child) =>
    readInline(child, budget, depth + 1),
  );
}

function hasReadableText(nodes: EpubInlineNode[]): boolean {
  return nodes.some((node) => {
    if (node.kind === "text") {
      return node.text.trim().length > 0;
    }

    if (node.kind === "break") {
      return false;
    }

    return hasReadableText(node.children);
  });
}

function readFlow(
  element: Element,
  budget: ExtractionBudget,
  depth: number,
): EpubTextBlock[] {
  visitNode(budget, depth);

  const blocks: EpubTextBlock[] = [];
  let inlineRun: Node[] = [];

  function flushInlineRun(): void {
    if (inlineRun.length === 0) return;

    const content = inlineRun.flatMap((node) =>
      readInline(node, budget, depth + 1),
    );

    inlineRun = [];

    if (hasReadableText(content)) {
      blocks.push({
        kind: "paragraph",
        content,
      });
    }
  }

  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const childElement = child as Element;
      const tag = childElement.localName.toLowerCase();

      if (IGNORED_ELEMENTS.has(tag)) {
        continue;
      }

      if (BLOCK_ELEMENTS.has(tag)) {
        flushInlineRun();

        blocks.push(...readBlock(childElement, budget, depth + 1));

        continue;
      }
    }

    inlineRun.push(child);
  }

  flushInlineRun();

  return blocks;
}

function readBlock(
  element: Element,
  budget: ExtractionBudget,
  depth: number,
): EpubTextBlock[] {
  visitNode(budget, depth);

  const tag = element.localName.toLowerCase();

  if (IGNORED_ELEMENTS.has(tag)) {
    return [];
  }

  if (/^h[1-6]$/.test(tag)) {
    const content = readInlineChildren(element, budget, depth);

    return hasReadableText(content)
      ? [
          {
            kind: "heading",
            level: Number(tag[1]),
            content,
          },
        ]
      : [];
  }

  if (tag === "p") {
    const content = readInlineChildren(element, budget, depth);

    return hasReadableText(content)
      ? [
          {
            kind: "paragraph",
            content,
          },
        ]
      : [];
  }

  if (tag === "pre") {
    const text = consumeText(
      (element.textContent ?? "").replace(/\r\n?/g, "\n"),
      budget,
    );

    return text.trim() ? [{ kind: "pre", text }] : [];
  }

  if (tag === "hr") {
    return [{ kind: "rule" }];
  }

  if (tag === "blockquote") {
    const blocks = readFlow(element, budget, depth + 1);

    return blocks.length > 0 ? [{ kind: "quote", blocks }] : [];
  }

  if (tag === "ul" || tag === "ol") {
    const items = Array.from(element.children)
      .filter((child) => child.localName.toLowerCase() === "li")
      .map((child) => readFlow(child, budget, depth + 1))
      .filter((item) => item.length > 0);

    return items.length > 0
      ? [
          {
            kind: "list",
            ordered: tag === "ol",
            items,
          },
        ]
      : [];
  }

  // Containers are traversed in document order.
  return readFlow(element, budget, depth + 1);
}

function extractSectionContent(parsed: Document): EpubSectionContent {
  if (
    parsed.contentType !== "text/html" &&
    parsed.querySelector("parsererror")
  ) {
    throw new Error("La sección EPUB contiene un documento XML inválido.");
  }

  const root = parsed.querySelector("body") ?? parsed.documentElement;

  if (!root) {
    return { blocks: [] };
  }

  const budget: ExtractionBudget = {
    characters: 0,
    nodes: 0,
  };

  return {
    blocks: readFlow(root, budget, 0),
  };
}

const MAX_FALLBACK_SOURCE_CHARACTERS = 4_000_000;

async function readBookSection(
  book: FoliateBook,
  index: number,
): Promise<EpubSectionContent> {
  const section = book.sections[index];

  const parsed = await section.createDocument();

  const xmlError =
    parsed.contentType !== "text/html" &&
    parsed.querySelector("parsererror") !== null;

  if (!xmlError) {
    return extractSectionContent(parsed);
  }

  if (!section.id) {
    throw new Error("No se pudo identificar la sección EPUB.");
  }

  const source = await book.loadText(section.id);

  if (
    typeof source !== "string" ||
    !source.trim() ||
    source.length > MAX_FALLBACK_SOURCE_CHARACTERS
  ) {
    throw new Error(
      "No se pudo recuperar el contenido textual de esta sección.",
    );
  }

  // Recovery is limited to text extraction.
  // The parsed HTML is never inserted into the app DOM.
  const recoveredDocument = new DOMParser().parseFromString(
    source,
    "text/html",
  );

  const content = extractSectionContent(recoveredDocument);

  if (content.blocks.length === 0) {
    throw new Error(
      "La sección contiene XHTML inválido y no fue posible recuperar texto.",
    );
  }

  console.warn(
    `EPUB: sección ${index + 1} con XHTML inválido; texto recuperado mediante HTML.`,
  );

  return {
    ...content,
    recoveredFromHtml: true,
  };
}

const MAX_TOC_ENTRIES = 1000;
const MAX_TOC_DEPTH = 8;

function buildEpubToc(
  book: FoliateBook,
  readingSectionIndexes: number[],
): EpubTocEntry[] {
  const visibleIndexBySource = new Map<number, number>(
    readingSectionIndexes.map((sourceIndex, visibleIndex) => [
      sourceIndex,
      visibleIndex,
    ]),
  );

  const entries: EpubTocEntry[] = [];

  function visit(items: FoliateTocItem[], depth: number): void {
    if (depth > MAX_TOC_DEPTH) return;

    for (const item of items) {
      if (entries.length >= MAX_TOC_ENTRIES) return;

      if (!item || typeof item !== "object") {
        continue;
      }

      const title =
        typeof item.label === "string" ? item.label.trim().slice(0, 200) : "";

      let sectionIndex: number | null = null;

      if (typeof item.href === "string" && item.href.length > 0) {
        try {
          if (!book.isExternal?.(item.href)) {
            const destination = book.resolveHref?.(item.href);

            if (destination && Number.isInteger(destination.index)) {
              sectionIndex =
                visibleIndexBySource.get(destination.index) ?? null;
            }
          }
        } catch (cause) {
          console.warn(
            "No se pudo resolver una entrada del índice EPUB:",
            cause,
          );
        }
      }

      if (title) {
        entries.push({
          id: `toc-${entries.length}`,
          title,
          sectionIndex,
          depth,
        });
      }

      if (Array.isArray(item.subitems)) {
        visit(item.subitems, depth + 1);
      }
    }
  }

  if (Array.isArray(book.toc)) {
    visit(book.toc, 0);
  }

  return entries;
}

export async function openEpub(
  file: FileHandle,
  size: number,
  fileName: string,
): Promise<EpubSession> {
  if (!Number.isSafeInteger(size) || size < 4 || size > MAX_EPUB_BYTES) {
    throw new Error(
      "El EPUB tiene un tamaño inválido o supera el límite de 128 MiB.",
    );
  }

  const source = new NativeRangeSource(file, size);

  const progressId = await createEpubProgressId(source);

  const blob = new NativeFileBlob(source, 0, size, fileName);

  const { makeBook } = await import("foliate-js/view.js");

  let book: Awaited<ReturnType<typeof makeBook>>;
  let readingSectionIndexes: number[] = [];

  try {
    book = await makeBook(blob);

    if (!Array.isArray(book.sections) || book.sections.length === 0) {
      throw new Error("El EPUB no contiene secciones de lectura válidas.");
    }

    const navigationPath = book.resources?.navPath;

    // Preserve original spine positions, excluding only
    // the identified EPUB navigation document.
    readingSectionIndexes = book.sections.flatMap((section, index) =>
      navigationPath && section.id === navigationPath ? [] : [index],
    );

    if (readingSectionIndexes.length === 0) {
      throw new Error("El EPUB no contiene secciones navegables.");
    }
  } catch (cause) {
    await source.waitForIdle();
    throw cause;
  }

  const summary: EpubSummary = {
    title: readableMetadata(book.metadata?.title) ?? "Libro sin título",
    author: readableMetadata(book.metadata?.author) ?? "Autor desconocido",
    sectionCount: readingSectionIndexes.length,
    tocCount: Array.isArray(book.toc) ? book.toc.length : 0,
    fileName,
  };

  const toc = buildEpubToc(book, readingSectionIndexes);

  const readingTasks = new Set<Promise<EpubSectionContent>>();

  let closePromise: Promise<void> | null = null;

  const MAX_COVER_BYTES = 8 * 1024 * 1024;

  const ALLOWED_COVER_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
  ]);

  let coverUrl: string | null = null;
  let coverRequest: Promise<string | null> | null = null;

  function getCoverUrl(): Promise<string | null> {
    if (!coverRequest) {
      coverRequest = (async () => {
        const cover = await book.getCover?.();

        if (!cover) return null;

        if (
          !ALLOWED_COVER_TYPES.has(cover.type.toLowerCase()) ||
          cover.size <= 0 ||
          cover.size > MAX_COVER_BYTES
        ) {
          throw new Error(
            "La portada EPUB tiene un formato o tamaño no admitido.",
          );
        }

        coverUrl = URL.createObjectURL(cover);

        return coverUrl;
      })();
    }

    return coverRequest;
  }

  function readSection(index: number): Promise<EpubSectionContent> {
    if (closePromise) {
      return Promise.reject(new Error("La sesión EPUB ya está cerrándose."));
    }

    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= readingSectionIndexes.length
    ) {
      return Promise.reject(new Error("Sección EPUB fuera de rango."));
    }

    const task = Promise.resolve().then(async () => {
      const sourceIndex = readingSectionIndexes[index];

      const content = await readBookSection(book, sourceIndex);

      // A textless opening section commonly contains
      // the book cover.
      if (index === 0 && content.blocks.length === 0) {
        const url = await getCoverUrl();

        if (url) {
          return {
            ...content,
            coverUrl: url,
          };
        }
      }

      return content;
    });

    readingTasks.add(task);

    void task.then(
      () => readingTasks.delete(task),
      () => readingTasks.delete(task),
    );

    return task;
  }

  function close(): Promise<void> {
    if (closePromise) {
      return closePromise;
    }

    closePromise = (async () => {
      // Do not release the file while a chapter is
      // still requesting ZIP ranges.
      await Promise.allSettled([...readingTasks]);

      try {
        book.destroy?.();
      } finally {
        try {
          await source.waitForIdle();
        } finally {
          try {
            await file.close();
          } finally {
            if (coverUrl) {
              URL.revokeObjectURL(coverUrl);
              coverUrl = null;
            }
          }
        }
      }
    })();

    return closePromise;
  }

  return {
    summary,
    toc,
    progressId,
    readSection,
    close,
  };
}
