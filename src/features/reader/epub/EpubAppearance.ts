export type EpubAppearance = {
  fontSize: number;
  lineHeight: number;
  fontFamily: "serif" | "sans";
  pageSize: "compact" | "standard" | "wide";
};

export const DEFAULT_EPUB_APPEARANCE: EpubAppearance = {
  fontSize: 16,
  lineHeight: 1.7,
  fontFamily: "serif",
  pageSize: "compact",
};

const STORAGE_KEY = "universal-reader:epub-appearance:v1";

export function readEpubAppearance(): EpubAppearance {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);

    if (!stored || stored.length > 1024) {
      return { ...DEFAULT_EPUB_APPEARANCE };
    }

    const parsed: unknown = JSON.parse(stored);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { ...DEFAULT_EPUB_APPEARANCE };
    }

    const value = parsed as Record<string, unknown>;

    const fontSize =
      typeof value.fontSize === "number" &&
      Number.isInteger(value.fontSize) &&
      value.fontSize >= 16 &&
      value.fontSize <= 28
        ? value.fontSize
        : DEFAULT_EPUB_APPEARANCE.fontSize;

    const lineHeight =
      typeof value.lineHeight === "number" &&
      Number.isFinite(value.lineHeight) &&
      value.lineHeight >= 1.4 &&
      value.lineHeight <= 2.1
        ? value.lineHeight
        : DEFAULT_EPUB_APPEARANCE.lineHeight;

    const fontFamily =
      value.fontFamily === "serif" || value.fontFamily === "sans"
        ? value.fontFamily
        : DEFAULT_EPUB_APPEARANCE.fontFamily;

    const pageSize: EpubAppearance["pageSize"] =
      value.pageSize === "compact" ||
      value.pageSize === "standard" ||
      value.pageSize === "wide"
        ? value.pageSize
        : DEFAULT_EPUB_APPEARANCE.pageSize;

    return {
      fontSize,
      lineHeight,
      fontFamily,
      pageSize,
    };
  } catch (error) {
    console.warn("No se pudieron recuperar las preferencias EPUB:", error);

    return { ...DEFAULT_EPUB_APPEARANCE };
  }
}

export function saveEpubAppearance(appearance: EpubAppearance): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
  } catch (error) {
    console.warn("No se pudieron guardar las preferencias EPUB:", error);
  }
}
