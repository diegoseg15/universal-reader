
declare module "foliate-js/view.js" {
  export interface FoliateSection {
    id?: string;
    linear?: string;
    createDocument(): Document | Promise<Document>;
  }

  export interface FoliateTocItem {
    label: string;
    href?: string;
    subitems?: FoliateTocItem[];
  }

  export interface FoliateBook {
    metadata?: {
      title?: unknown;
      author?: unknown;
    };

    sections: FoliateSection[];
    toc?: FoliateTocItem[];

    resources?: {
      navPath?: string;
    };

    loadText(uri: string): Promise<string | null>;
    getCover?(): Promise<Blob | null>;

    resolveHref?(href: string): {
      index: number;
    } | null;

    isExternal?(href: string): boolean;

    destroy?(): void;
  }

  export function makeBook(
    file: Blob,
  ): Promise<FoliateBook>;
}
