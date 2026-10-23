import type { FoliateBook } from "foliate-js/view.js";

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

const MAX_SECTION_CHARACTERS = 1_000_000;
const MAX_SECTION_NODES = 50_000;
const MAX_SECTION_DEPTH = 64;
const MAX_FALLBACK_SOURCE_CHARACTERS = 4_000_000;

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

export async function readBookSection(
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
