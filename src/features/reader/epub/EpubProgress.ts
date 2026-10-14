import type { EpubSession } from "./EpubSource";

type EpubProgress = {
  lastSection: number;
  positions: Map<number, number>;
};

const STORAGE_PREFIX = "universal-reader:epub-progress:v1:";

const MAX_STORED_DATA_LENGTH = 200_000;

const progressCache = new WeakMap<EpubSession, EpubProgress>();

function storageKey(session: EpubSession): string {
  return `${STORAGE_PREFIX}${session.progressId}`;
}

export function getEpubProgress(session: EpubSession): EpubProgress {
  const cached = progressCache.get(session);

  if (cached) return cached;

  const progress: EpubProgress = {
    lastSection: 0,
    positions: new Map(),
  };

  try {
    const raw = window.localStorage.getItem(storageKey(session));

    if (raw && raw.length <= MAX_STORED_DATA_LENGTH) {
      const parsed: unknown = JSON.parse(raw);

      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        const record = parsed as Record<string, unknown>;

        const lastSection = record.lastSection;

        if (
          typeof lastSection === "number" &&
          Number.isSafeInteger(lastSection) &&
          lastSection >= 0 &&
          lastSection < session.summary.sectionCount
        ) {
          progress.lastSection = lastSection;
        }

        const positions = record.positions;

        if (
          typeof positions === "object" &&
          positions !== null &&
          !Array.isArray(positions)
        ) {
          for (const [key, value] of Object.entries(positions)) {
            const index = Number(key);

            if (
              !/^(0|[1-9]\d*)$/.test(key) ||
              !Number.isSafeInteger(index) ||
              index >= session.summary.sectionCount ||
              typeof value !== "number" ||
              !Number.isFinite(value) ||
              value < 0 ||
              value > 1
            ) {
              continue;
            }

            progress.positions.set(index, value);
          }
        }
      }
    }
  } catch (error) {
    console.warn("No se pudo recuperar el progreso EPUB:", error);
  }

  progressCache.set(session, progress);

  return progress;
}

export function saveEpubProgress(session: EpubSession): void {
  const progress = getEpubProgress(session);

  try {
    window.localStorage.setItem(
      storageKey(session),
      JSON.stringify({
        lastSection: progress.lastSection,
        positions: Object.fromEntries(progress.positions),
      }),
    );
  } catch (error) {
    console.warn("No se pudo guardar el progreso EPUB:", error);
  }
}
