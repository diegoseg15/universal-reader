
declare module "foliate-js/view.js" {
  export interface FoliateSection {
    id?: string;
    createDocument(): Document | Promise<Document>;
  }

  export interface FoliateBook {
    metadata?: {
      title?: unknown;
      author?: unknown;
    };

    sections: FoliateSection[];
    toc?: unknown[];

    loadText(uri: string): Promise<string | null>;

    destroy?(): void;
  }

  export function makeBook(
    file: Blob,
  ): Promise<FoliateBook>;
}
