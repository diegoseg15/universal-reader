
declare module "foliate-js/view.js" {
  export interface FoliateSection {
    id?: string;
    linear?: string;
    createDocument(): Document | Promise<Document>;
  }

  export interface FoliateBook {
    metadata?: {
      title?: unknown;
      author?: unknown;
    };

    sections: FoliateSection[];
    toc?: unknown[];

    resources?: {
      navPath?: string;
    };

    loadText(uri: string): Promise<string | null>;
    getCover?(): Promise<Blob | null>;

    destroy?(): void;
  }

  export function makeBook(
    file: Blob,
  ): Promise<FoliateBook>;
}
