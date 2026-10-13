
declare module "foliate-js/view.js" {
  export interface FoliateBook {
    metadata?: {
      title?: unknown;
      author?: unknown;
    };

    sections: unknown[];
    toc?: unknown[];
  }

  export function makeBook(
    file: Blob,
  ): Promise<FoliateBook>;
}
