import {
  DEFAULT_EPUB_APPEARANCE,
  type EpubAppearance,
} from "./EpubAppearance";
import type { EpubTocEntry } from "./EpubSource";

export type ReaderEpubTools = {
  toc: EpubTocEntry[];
  sectionIndex: number;
  onNavigateSection: (index: number) => void;
  appearance: EpubAppearance;
  onAppearanceChange: (value: EpubAppearance) => void;
};

type EpubToolsPanelProps = {
  epubTools: ReaderEpubTools;
};

export function EpubTocPanel({ epubTools }: EpubToolsPanelProps) {
  return (
    <section
      id="reader-panel-toc"
      role="tabpanel"
      aria-labelledby="reader-tab-toc"
      className="reader-tools__content"
    >
      <h2 className="reader-tools__title">Índice del libro</h2>

      <nav
        aria-label="Índice de capítulos EPUB"
        style={{
          display: "grid",
          gap: "4px",
          maxHeight: "65dvh",
          overflowY: "auto",
          minWidth: 0,
        }}
      >
        {epubTools.toc.map((entry) => {
          const target = entry.sectionIndex;

          const isCurrent =
            target !== null && target === epubTools.sectionIndex;

          const indentation = Math.min(entry.depth, 4) * 12;

          return (
            <div
              key={entry.id}
              style={{
                minWidth: 0,
                paddingLeft: `${indentation}px`,
              }}
            >
              {target === null ? (
                <span
                  style={{
                    display: "block",
                    padding: "10px 8px",
                    color: "var(--reader-secondary)",
                    fontSize: "13px",
                    fontWeight: 600,
                    overflowWrap: "anywhere",
                  }}
                >
                  {entry.title}
                </span>
              ) : (
                <button
                  type="button"
                  aria-current={isCurrent ? "location" : undefined}
                  onClick={() => epubTools.onNavigateSection(target)}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "10px 8px",
                    background: isCurrent
                      ? "var(--reader-active-bg)"
                      : "transparent",
                    color: "var(--reader-text)",
                    border: isCurrent
                      ? "1px solid var(--reader-border)"
                      : "1px solid transparent",
                    borderRadius: "8px",
                    textAlign: "left",
                    font: "inherit",
                    fontSize: "13px",
                    cursor: "pointer",
                    overflowWrap: "anywhere",
                  }}
                >
                  {entry.title}
                </button>
              )}
            </div>
          );
        })}
      </nav>
    </section>
  );
}

export function EpubAppearancePanel({ epubTools }: EpubToolsPanelProps) {
  return (
    <section
      id="reader-panel-appearance"
      role="tabpanel"
      aria-labelledby="reader-tab-appearance"
      className="reader-tools__content"
    >
      <h2 className="reader-tools__title">Apariencia de lectura</h2>

      <label
        style={{
          display: "grid",
          gap: "10px",
          fontSize: "13px",
        }}
      >
        <span>Tamaño de texto: {epubTools.appearance.fontSize} px</span>

        <input
          type="range"
          min={10}
          max={28}
          step={1}
          value={epubTools.appearance.fontSize}
          onChange={(event) => {
            epubTools.onAppearanceChange({
              ...epubTools.appearance,
              fontSize: Number(event.currentTarget.value),
            });
          }}
          style={{
            width: "100%",
            accentColor: "var(--reader-accent)",
          }}
        />
      </label>

      <label
        style={{
          display: "grid",
          gap: "10px",
          fontSize: "13px",
        }}
      >
        <span>Tipografía</span>

        <select
          value={epubTools.appearance.fontFamily}
          onChange={(event) => {
            const value = event.currentTarget.value;

            if (value !== "serif" && value !== "sans") {
              return;
            }

            epubTools.onAppearanceChange({
              ...epubTools.appearance,
              fontFamily: value,
            });
          }}
          style={{
            minHeight: "44px",
            width: "100%",
            padding: "10px",
            border: "1px solid var(--reader-border)",
            borderRadius: "8px",
            background: "var(--reader-surface)",
            color: "var(--reader-text)",
            font: "inherit",
            fontSize: "13px",
          }}
        >
          <option value="serif">Con serifas</option>
          <option value="sans">Sin serifas</option>
        </select>
      </label>

      <label
        style={{
          display: "grid",
          gap: "10px",
          fontSize: "13px",
        }}
      >
        <span>Interlineado: {epubTools.appearance.lineHeight.toFixed(1)}</span>

        <input
          type="range"
          min={1.4}
          max={2.1}
          step={0.1}
          value={epubTools.appearance.lineHeight}
          onChange={(event) => {
            epubTools.onAppearanceChange({
              ...epubTools.appearance,
              lineHeight: Number(
                Number(event.currentTarget.value).toFixed(1),
              ),
            });
          }}
          style={{
            width: "100%",
            accentColor: "var(--reader-accent)",
          }}
        />
      </label>

      <button
        type="button"
        className="reader-button"
        onClick={() =>
          epubTools.onAppearanceChange({
            ...DEFAULT_EPUB_APPEARANCE,
          })
        }
      >
        Restablecer apariencia
      </button>
    </section>
  );
}
