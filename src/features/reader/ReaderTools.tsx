import type { RefObject } from "react";
import {
  MagnifyingGlassIcon,
  MagnifyingGlassPlusIcon,
  ListBulletsIcon,
  TextAaIcon,
} from "@phosphor-icons/react";

import {
  EpubAppearancePanel,
  EpubTocPanel,
  type ReaderEpubTools,
} from "./epub/EpubToolPanels";
import {
  ReaderSearchPanel,
  ReaderZoomPanel,
  type ReaderSearchControls,
  type ReaderZoomControls,
} from "./ReaderSearchZoomPanels";

export type { ReaderEpubTools, ReaderSearchControls, ReaderZoomControls };

export type ReaderToolTab = "search" | "zoom" | "toc" | "appearance";

type ReaderToolsProps = {
  zoom?: ReaderZoomControls;
  search?: ReaderSearchControls;
  activeTab: ReaderToolTab;
  onTabChange: (tab: ReaderToolTab) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  epubTools?: ReaderEpubTools;
  loading: boolean;
};

const TAB_LABELS: Record<ReaderToolTab, string> = {
  search: "Buscar",
  zoom: "Zoom",
  toc: "Índice",
  appearance: "Apariencia",
};

const TAB_ICONS = {
  search: MagnifyingGlassIcon,
  zoom: MagnifyingGlassPlusIcon,
  toc: ListBulletsIcon,
  appearance: TextAaIcon,
};

export function ReaderTools({
  zoom,
  search,
  activeTab,
  onTabChange,
  searchInputRef,
  loading,
  epubTools,
}: ReaderToolsProps) {
  const availableTabs: ReaderToolTab[] = [];

  if (search) availableTabs.push("search");
  if (zoom) availableTabs.push("zoom");

  if (epubTools) {
    if (epubTools.toc.length > 0) {
      availableTabs.push("toc");
    }

    availableTabs.push("appearance");
  }

  const selectedTab = availableTabs.includes(activeTab)
    ? activeTab
    : (availableTabs[0] ?? "search");

  return (
    <>
      <div
        className="reader-tools__tabs"
        role="tablist"
        aria-label="Herramientas del documento"
        style={{
          gridTemplateColumns: `repeat(${availableTabs.length}, minmax(0, 1fr))`,
        }}
      >
        {availableTabs.map((tab) => {
          const Icon = TAB_ICONS[tab];
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`reader-tab-${tab}`}
              aria-controls={`reader-panel-${tab}`}
              aria-selected={selectedTab === tab}
              className="reader-button reader-tools__tab"
              onClick={() => onTabChange(tab)}
            >
              <Icon size={20} aria-hidden="true" />
              <span>{TAB_LABELS[tab]}</span>
            </button>
          );
        })}
      </div>

      {epubTools && selectedTab === "toc" && (
        <EpubTocPanel epubTools={epubTools} />
      )}

      {epubTools && selectedTab === "appearance" && (
        <EpubAppearancePanel epubTools={epubTools} />
      )}

      {search && selectedTab === "search" && (
        <ReaderSearchPanel
          search={search}
          searchInputRef={searchInputRef}
          loading={loading}
        />
      )}

      {zoom && selectedTab === "zoom" && (
        <ReaderZoomPanel
          zoom={zoom}
          isEpub={Boolean(epubTools)}
          loading={loading}
        />
      )}
    </>
  );
}
