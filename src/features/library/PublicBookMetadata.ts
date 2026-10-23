import type { LibraryCategory } from "./LibraryOrganization";
import type { LibraryBook } from "./LibrarySource";

export type PublicBookMetadata = {
  title: string | null;
  author: string | null;
  description: string | null;
  pageCount: number | null;
  pageLabel: string | null;
  language: string | null;
  coverUrl: string | null;
  rating: number | null;
  ratingScale: 5 | 10;
  ratingsCount: number | null;
  categories: string[];
  publishedDate: string | null;
  publisher: string | null;
  source: string;
};

export type StoredBookMetadataDecision =
  | {
      status: "accepted";
      metadata: PublicBookMetadata;
    }
  | {
      status: "declined";
      rating?: number | null;
      ratingScale?: 5 | 10;
      ratingsCount?: number | null;
      ratingSource?: string | null;
    };

const METADATA_DECISIONS_KEY = "universal-reader.book-metadata-decisions.v7";
const USER_RATINGS_KEY = "universal-reader.user-book-ratings.v1";
export const METADATA_UPDATED_EVENT = "universal-reader:metadata-updated";

function notifyMetadataUpdated(bookPath: string): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(METADATA_UPDATED_EVENT, { detail: { bookPath } }),
    );
  }
}

function readDecisionsMap(): Record<string, StoredBookMetadataDecision> {
  try {
    const raw = window.localStorage.getItem(METADATA_DECISIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function writeDecision(
  bookPath: string,
  decision: StoredBookMetadataDecision,
): void {
  try {
    const current = readDecisionsMap();
    current[bookPath] = decision;
    window.localStorage.setItem(
      METADATA_DECISIONS_KEY,
      JSON.stringify(current),
    );
    notifyMetadataUpdated(bookPath);
  } catch {
    // Ignore storage quota errors.
  }
}

export function getStoredBookMetadataDecision(
  bookPath: string,
): StoredBookMetadataDecision | null {
  const map = readDecisionsMap();
  return map[bookPath] ?? null;
}

export function getEffectiveBookMetadata(
  bookPath: string,
): PublicBookMetadata | null {
  const decision = getStoredBookMetadataDecision(bookPath);
  return decision?.status === "accepted" ? decision.metadata : null;
}

export function acceptPublicBookMetadata(
  bookPath: string,
  metadata: PublicBookMetadata,
): void {
  writeDecision(bookPath, {
    status: "accepted",
    metadata,
  });
}

export function saveEditedBookMetadata(
  bookPath: string,
  updates: {
    title: string | null;
    author: string | null;
    description: string | null;
    pageCount: number | null;
    pageLabel: string | null;
    language: string | null;
    coverUrl: string | null;
  },
  existingMeta?: PublicBookMetadata | null,
): PublicBookMetadata {
  const nextMeta: PublicBookMetadata = {
    title: updates.title,
    author: updates.author,
    description: updates.description,
    pageCount: updates.pageCount,
    pageLabel: updates.pageLabel ?? existingMeta?.pageLabel ?? "Páginas",
    language: updates.language,
    coverUrl: updates.coverUrl,
    rating: existingMeta?.rating ?? null,
    ratingScale: existingMeta?.ratingScale ?? 5,
    ratingsCount: existingMeta?.ratingsCount ?? null,
    categories: existingMeta?.categories ?? [],
    publishedDate: existingMeta?.publishedDate ?? null,
    publisher: existingMeta?.publisher ?? null,
    source: existingMeta?.source
      ? `${existingMeta.source} (Editado)`
      : "Editado por el usuario",
  };

  writeDecision(bookPath, {
    status: "accepted",
    metadata: nextMeta,
  });

  return nextMeta;
}

export function declinePublicBookMetadata(
  bookPath: string,
  fallbackMeta?: PublicBookMetadata | null,
): void {
  writeDecision(bookPath, {
    status: "declined",
    rating: fallbackMeta?.rating ?? null,
    ratingScale: fallbackMeta?.ratingScale ?? 5,
    ratingsCount: fallbackMeta?.ratingsCount ?? null,
    ratingSource: fallbackMeta?.source ?? null,
  });
}

export function getUserBookRating(bookPath: string): number | null {
  try {
    const raw = window.localStorage.getItem(USER_RATINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, number>;
    const val = parsed?.[bookPath];
    return typeof val === "number" && val >= 0.5 && val <= 5 ? val : null;
  } catch {
    return null;
  }
}

export function setUserBookRating(
  bookPath: string,
  rating: number | null,
): void {
  try {
    const raw = window.localStorage.getItem(USER_RATINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    if (rating === null) {
      delete parsed[bookPath];
    } else {
      parsed[bookPath] = Math.max(0.5, Math.min(5, rating));
    }
    window.localStorage.setItem(USER_RATINGS_KEY, JSON.stringify(parsed));
    notifyMetadataUpdated(bookPath);
  } catch {
    // Ignore storage quota errors.
  }
}

function cleanQuerySegment(raw: string): string {
  return (
    raw
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\{[^}]*\}/g, " ")
      .replace(/[_]+/g, " ")
      .replace(/\.(?=[a-zA-Z0-9])/g, " ")
      .replace(/\s+[-_]?(:?es|esp|spa|en|eng|fr|pt|jp|jpn)$/i, "")
      .replace(
        /\b(?:vol(?:umen|ume)?|tomo|cap(?:itulo|ítulo)?|ch(?:apter)?|issue|ep(?:isodio)?|part(?:e)?|libro|book)\.?\s*\d+(?:[.,]\d+)?\b/gi,
        " ",
      )
      .replace(/\b(?:v|c|ch|t)\d{1,4}\b/gi, " ")
      .replace(/#\s*\d+\b/g, " ")
      .replace(/^\s*\d{1,4}\s*[-._:]+\s*/, "")
      .replace(/\s+-\s*\d{1,4}\s*$/, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function isGenericTitle(value: string): boolean {
  const norm = value.toLowerCase().trim();
  return (
    norm.length < 3 ||
    /^(?:scan|page|pagina|página|cap(?:itulo|ítulo)?|tomo|vol(?:umen)?|chapter|issue|libro|book|sin titulo|untitled|documento|microsoft word|index|calibre)\b/i.test(
      norm,
    ) ||
    /^\d+$/.test(norm)
  );
}

export function buildSearchQueries(
  book: LibraryBook,
  extractedTitle?: string | null,
  extractedAuthor?: string | null,
): { queries: string[]; authorQuery: string | null } {
  const cleanAuthor =
    extractedAuthor &&
    extractedAuthor.trim().length > 1 &&
    !isGenericTitle(extractedAuthor)
      ? extractedAuthor.trim()
      : null;

  if (extractedTitle) {
    const cleanedMeta = cleanQuerySegment(extractedTitle);
    if (!isGenericTitle(cleanedMeta)) {
      return {
        queries: [cleanedMeta],
        authorQuery: cleanAuthor,
      };
    }
  }

  const candidates: string[] = [];
  const cleanedFileName = cleanQuerySegment(book.name);
  if (!isGenericTitle(cleanedFileName)) {
    candidates.push(cleanedFileName);
    if (cleanedFileName.includes(" - ")) {
      const parts = cleanedFileName
        .split(" - ")
        .map((p) => p.trim())
        .filter((p) => !isGenericTitle(p));
      for (const part of parts) {
        candidates.push(part);
      }
    }
  }

  const pathSegments = book.relativePath
    .split(/[\\/]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (pathSegments.length >= 2) {
    const immediateFolder = cleanQuerySegment(
      pathSegments[pathSegments.length - 2],
    );
    if (!isGenericTitle(immediateFolder)) {
      candidates.push(immediateFolder);
    }
  }

  if (book.folderName) {
    const cleanedRootFolder = cleanQuerySegment(book.folderName);
    if (!isGenericTitle(cleanedRootFolder)) {
      candidates.push(cleanedRootFolder);
    }
  }

  const uniqueQueries = [...new Set(candidates.filter((q) => q.length >= 2))];
  return {
    queries: uniqueQueries.slice(0, 3),
    authorQuery: cleanAuthor,
  };
}

function cleanSynopsis(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const withoutHtml = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[Written by MAL Rewrite\]/gi, "")
    .replace(/\(Source:[^)]+\)/gi, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return withoutHtml.length >= 15 ? withoutHtml : null;
}

const STOP_WORDS = new Set([
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "unos",
  "unas",
  "de",
  "del",
  "al",
  "en",
  "con",
  "por",
  "para",
  "the",
  "of",
  "in",
  "and",
  "to",
  "a",
  "an",
]);

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantWords(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

function scoreTitleMatch(query: string, candidate: string): number {
  const normQuery = normalizeText(query);
  const normCandidate = normalizeText(candidate);
  if (!normQuery || !normCandidate) return 0;
  if (normQuery === normCandidate) return 100;
  if (normCandidate.startsWith(normQuery) || normQuery.startsWith(normCandidate)) {
    return 88;
  }
  if (normCandidate.includes(normQuery) || normQuery.includes(normCandidate)) {
    return 78;
  }

  const queryWords = significantWords(query);
  const candidateWords = significantWords(candidate);
  if (queryWords.length === 0 || candidateWords.length === 0) return 0;

  const matched = queryWords.filter((qw) =>
    candidateWords.some(
      (cw) =>
        cw === qw ||
        (cw.length >= 4 &&
          qw.length >= 4 &&
          (cw.startsWith(qw) || qw.startsWith(cw))),
    ),
  ).length;

  if (matched === 0) return 0;
  return Math.round((matched / queryWords.length) * 75);
}

function scoreAuthorMatch(
  expectedAuthor: string | null,
  candidateAuthors: string | string[] | undefined | null,
): number {
  if (!expectedAuthor) return 0;
  const candidateStr = Array.isArray(candidateAuthors)
    ? candidateAuthors.join(" ")
    : (candidateAuthors ?? "");
  if (!candidateStr.trim()) return 0;

  const expectedWords = significantWords(expectedAuthor);
  const candidateNorm = normalizeText(candidateStr);
  if (expectedWords.length === 0) return 0;

  const matched = expectedWords.filter((w) => candidateNorm.includes(w)).length;
  if (matched === 0) return -40;
  return Math.round((matched / expectedWords.length) * 45);
}

type GoogleVolumeItem = {
  volumeInfo?: {
    title?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    pageCount?: number;
    categories?: string[];
    averageRating?: number;
    ratingsCount?: number;
    language?: string;
    imageLinks?: {
      thumbnail?: string;
      smallThumbnail?: string;
    };
  };
  searchInfo?: {
    textSnippet?: string;
  };
};

async function queryGoogleVolumes(
  q: string,
  signal: AbortSignal,
): Promise<GoogleVolumeItem[]> {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", q);
  url.searchParams.set("maxResults", "10");
  url.searchParams.set("printType", "books");

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) return [];
  const data = (await response.json()) as { items?: GoogleVolumeItem[] };
  return data.items ?? [];
}

async function fetchGoogleBooks(
  titleQuery: string,
  authorQuery: string | null,
  category: LibraryCategory,
  signal: AbortSignal,
): Promise<PublicBookMetadata | null> {
  const strictParts = [`intitle:${titleQuery}`];
  if (authorQuery) {
    strictParts.push(`inauthor:${authorQuery}`);
  } else if (category === "comics") {
    strictParts.push("comic");
  }

  const broadQuery = authorQuery
    ? `${titleQuery} ${authorQuery}`
    : titleQuery;

  const [strictItems, broadItems] = await Promise.all([
    queryGoogleVolumes(strictParts.join(" "), signal).catch(() => []),
    queryGoogleVolumes(broadQuery, signal).catch(() => []),
  ]);

  const items = [...strictItems, ...broadItems];
  if (items.length === 0) return null;

  const ranked = items
    .map((item) => {
      const info = item.volumeInfo ?? {};
      const title = info.title?.trim() ?? "";
      const description =
        cleanSynopsis(info.description) ??
        cleanSynopsis(item.searchInfo?.textSnippet);
      const titleScore = scoreTitleMatch(titleQuery, title);
      const authorScore = scoreAuthorMatch(authorQuery, info.authors);
      const matchScore =
        titleScore +
        authorScore +
        (description ? 30 : 0) +
        (typeof info.averageRating === "number" && info.averageRating > 0
          ? 25
          : 0) +
        (info.language?.startsWith("es") ? 15 : 0) +
        (info.pageCount ? 5 : 0);
      return { info, description, titleScore, authorScore, matchScore };
    })
    .filter(
      (entry) =>
        (entry.titleScore >= 45 && (!authorQuery || entry.authorScore >= 0)) ||
        (authorQuery !== null &&
          entry.authorScore >= 30 &&
          entry.titleScore >= 25),
    )
    .sort((a, b) => b.matchScore - a.matchScore);

  const best = ranked[0];
  if (!best) return null;

  const bestWithDesc = ranked.find((r) => r.description) ?? best;
  const bestWithRating =
    ranked.find(
      (r) =>
        typeof r.info.averageRating === "number" && r.info.averageRating > 0,
    ) ??
    items
      .map((item) => ({
        info: item.volumeInfo ?? {},
        authorScore: scoreAuthorMatch(authorQuery, item.volumeInfo?.authors),
        titleScore: scoreTitleMatch(titleQuery, item.volumeInfo?.title ?? ""),
      }))
      .find(
        (r) =>
          typeof r.info.averageRating === "number" &&
          r.info.averageRating > 0 &&
          (r.titleScore >= 40 || (authorQuery !== null && r.authorScore >= 30)),
      ) ??
    best;

  const bestWithPages =
    ranked.find(
      (r) => typeof r.info.pageCount === "number" && r.info.pageCount > 0,
    ) ?? best;
  const bestWithCategories =
    ranked.find(
      (r) => Array.isArray(r.info.categories) && r.info.categories.length > 0,
    ) ?? best;
  const bestWithCover =
    ranked.find(
      (r) => r.info.imageLinks?.thumbnail ?? r.info.imageLinks?.smallThumbnail,
    ) ?? best;

  const { info } = best;
  const rawCover =
    bestWithCover.info.imageLinks?.thumbnail ??
    bestWithCover.info.imageLinks?.smallThumbnail ??
    null;
  const coverUrl = rawCover ? rawCover.replace(/^http:\/\//i, "https://") : null;

  return {
    title: info.title?.trim() ?? null,
    author:
      Array.isArray(info.authors) && info.authors.length > 0
        ? info.authors.join(", ")
        : null,
    description: bestWithDesc.description,
    pageCount:
      typeof bestWithPages.info.pageCount === "number" &&
      bestWithPages.info.pageCount > 0
        ? bestWithPages.info.pageCount
        : null,
    pageLabel: "Páginas",
    language: info.language ?? null,
    coverUrl,
    rating:
      typeof bestWithRating.info.averageRating === "number" &&
      bestWithRating.info.averageRating > 0
        ? bestWithRating.info.averageRating
        : null,
    ratingScale: 5,
    ratingsCount:
      typeof bestWithRating.info.ratingsCount === "number"
        ? bestWithRating.info.ratingsCount
        : null,
    categories: bestWithCategories.info.categories?.slice(0, 4) ?? [],
    publishedDate: info.publishedDate?.slice(0, 4) ?? null,
    publisher: info.publisher?.trim() ?? null,
    source: "Google Books",
  };
}

async function fetchMangaDex(
  titleQuery: string,
  signal: AbortSignal,
): Promise<PublicBookMetadata | null> {
  const url = new URL("https://api.mangadex.org/manga");
  url.searchParams.set("title", titleQuery);
  url.searchParams.set("limit", "6");
  url.searchParams.append("includes[]", "author");
  url.searchParams.append("includes[]", "cover_art");

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) return null;

  const payload = (await response.json()) as {
    data?: Array<{
      id: string;
      attributes?: {
        title?: Record<string, string>;
        altTitles?: Array<Record<string, string>>;
        description?: Record<string, string>;
        lastChapter?: string | null;
        year?: number | null;
        originalLanguage?: string | null;
        tags?: Array<{
          attributes?: {
            name?: Record<string, string>;
          };
        }>;
      };
      relationships?: Array<{
        type?: string;
        attributes?: {
          name?: string;
          fileName?: string;
        };
      }>;
    }>;
  };

  const list = payload.data ?? [];
  if (list.length === 0) return null;

  const matching = list.filter((item) => {
    const titles = Object.values(item.attributes?.title ?? {});
    const altTitles = (item.attributes?.altTitles ?? []).flatMap((t) =>
      Object.values(t),
    );
    return [...titles, ...altTitles].some(
      (t) => scoreTitleMatch(titleQuery, t) >= 45,
    );
  });

  if (matching.length === 0) return null;

  const entry =
    matching.find((item) => {
      const desc = item.attributes?.description ?? {};
      return Boolean(
        cleanSynopsis(
          desc.es ?? desc["es-la"] ?? desc.en ?? Object.values(desc)[0],
        ),
      );
    }) ?? matching[0];

  let rating: number | null = null;
  try {
    const statsResp = await fetch(
      `https://api.mangadex.org/statistics/manga/${entry.id}`,
      { signal },
    );
    if (statsResp.ok) {
      const statsData = (await statsResp.json()) as {
        statistics?: Record<
          string,
          {
            rating?: {
              bayesian?: number | null;
              average?: number | null;
            };
          }
        >;
      };
      const rawScore =
        statsData.statistics?.[entry.id]?.rating?.bayesian ??
        statsData.statistics?.[entry.id]?.rating?.average ??
        null;
      if (typeof rawScore === "number" && rawScore > 0) {
        rating = Number(rawScore.toFixed(1));
      }
    }
  } catch {
    // Ignore optional statistics fetch error.
  }

  const attrs = entry.attributes ?? {};
  const titles = attrs.title ?? {};
  const primaryTitle =
    titles.es ??
    titles["es-la"] ??
    titles.en ??
    titles.ja ??
    titles["ja-ro"] ??
    Object.values(titles)[0] ??
    null;

  const descriptions = attrs.description ?? {};
  const rawDescription =
    descriptions.es ??
    descriptions["es-la"] ??
    descriptions.en ??
    Object.values(descriptions)[0] ??
    null;
  const selectedLang =
    descriptions.es || descriptions["es-la"]
      ? "es"
      : descriptions.en
        ? "en"
        : (attrs.originalLanguage ?? "ja");

  const authorRel = entry.relationships?.find(
    (rel) => rel.type === "author" && rel.attributes?.name,
  );
  const coverRel = entry.relationships?.find(
    (rel) => rel.type === "cover_art" && rel.attributes?.fileName,
  );
  const coverUrl = coverRel?.attributes?.fileName
    ? `https://uploads.mangadex.org/covers/${entry.id}/${coverRel.attributes.fileName}.512.jpg`
    : null;

  const parsedChapters = attrs.lastChapter
    ? Number.parseInt(attrs.lastChapter, 10)
    : Number.NaN;

  const categories = (attrs.tags ?? [])
    .map(
      (tag) =>
        tag.attributes?.name?.es ??
        tag.attributes?.name?.en ??
        Object.values(tag.attributes?.name ?? {})[0],
    )
    .filter((name): name is string => Boolean(name))
    .slice(0, 4);

  return {
    title: primaryTitle?.trim() ?? null,
    author: authorRel?.attributes?.name?.trim() ?? null,
    description: cleanSynopsis(rawDescription),
    pageCount:
      Number.isFinite(parsedChapters) && parsedChapters > 0
        ? parsedChapters
        : null,
    pageLabel: "Capítulos",
    language: selectedLang,
    coverUrl,
    rating,
    ratingScale: 10,
    ratingsCount: null,
    categories,
    publishedDate: attrs.year ? String(attrs.year) : null,
    publisher: null,
    source: "MangaDex",
  };
}

async function fetchJikanManga(
  titleQuery: string,
  signal: AbortSignal,
): Promise<PublicBookMetadata | null> {
  const url = new URL("https://api.jikan.moe/v4/manga");
  url.searchParams.set("q", titleQuery);
  url.searchParams.set("limit", "5");

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) return null;

  const payload = (await response.json()) as {
    data?: Array<{
      title?: string;
      title_english?: string | null;
      synopsis?: string | null;
      chapters?: number | null;
      volumes?: number | null;
      score?: number | null;
      scored_by?: number | null;
      published?: {
        from?: string | null;
      };
      authors?: Array<{ name?: string }>;
      genres?: Array<{ name?: string }>;
      images?: {
        jpg?: {
          large_image_url?: string;
          image_url?: string;
        };
      };
    }>;
  };

  const items = (payload.data ?? []).filter((item) => {
    const s1 = item.title ? scoreTitleMatch(titleQuery, item.title) : 0;
    const s2 = item.title_english
      ? scoreTitleMatch(titleQuery, item.title_english)
      : 0;
    return Math.max(s1, s2) >= 45;
  });

  if (items.length === 0) return null;

  const best = items.find((item) => cleanSynopsis(item.synopsis)) ?? items[0];
  const withScore =
    items.find((item) => typeof item.score === "number") ?? best;
  const authors = (best.authors ?? [])
    .map((a) => a.name?.trim())
    .filter((name): name is string => Boolean(name))
    .join(", ");

  const chapters =
    typeof best.chapters === "number" && best.chapters > 0
      ? best.chapters
      : null;
  const volumes =
    typeof best.volumes === "number" && best.volumes > 0 ? best.volumes : null;

  const categories = (best.genres ?? [])
    .map((g) => g.name?.trim())
    .filter((name): name is string => Boolean(name))
    .slice(0, 4);

  return {
    title: (best.title_english ?? best.title)?.trim() ?? null,
    author: authors || null,
    description: cleanSynopsis(best.synopsis),
    pageCount: chapters ?? volumes,
    pageLabel: chapters ? "Capítulos" : volumes ? "Tomos" : null,
    language: "jpn",
    coverUrl:
      best.images?.jpg?.large_image_url ?? best.images?.jpg?.image_url ?? null,
    rating: typeof withScore.score === "number" ? withScore.score : null,
    ratingScale: 10,
    ratingsCount:
      typeof withScore.scored_by === "number" ? withScore.scored_by : null,
    categories,
    publishedDate: best.published?.from?.slice(0, 4) ?? null,
    publisher: null,
    source: "MyAnimeList",
  };
}

async function fetchOpenLibrary(
  titleQuery: string,
  authorQuery: string | null,
  signal: AbortSignal,
): Promise<PublicBookMetadata | null> {
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("title", titleQuery);
  if (authorQuery) {
    url.searchParams.set("author", authorQuery);
  }
  url.searchParams.set("limit", "6");
  url.searchParams.set(
    "fields",
    "key,title,author_name,number_of_pages_median,language,cover_i,first_sentence,ratings_average,ratings_count,subject,first_publish_year,publisher",
  );

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) return null;

  const payload = (await response.json()) as {
    docs?: Array<{
      key?: string;
      title?: string;
      author_name?: string[];
      number_of_pages_median?: number;
      language?: string[];
      cover_i?: number;
      first_sentence?: string[] | string;
      ratings_average?: number;
      ratings_count?: number;
      subject?: string[];
      first_publish_year?: number;
      publisher?: string[];
    }>;
  };

  const ranked = (payload.docs ?? [])
    .map((doc) => {
      const titleScore = scoreTitleMatch(titleQuery, doc.title ?? "");
      const authorScore = scoreAuthorMatch(authorQuery, doc.author_name);
      return {
        doc,
        titleScore,
        authorScore,
        total:
          titleScore +
          authorScore +
          (typeof doc.ratings_average === "number" && doc.ratings_average > 0
            ? 25
            : 0) +
          (doc.cover_i ? 10 : 0),
      };
    })
    .filter(
      (entry) =>
        (entry.titleScore >= 45 && (!authorQuery || entry.authorScore >= 0)) ||
        (authorQuery !== null && entry.authorScore >= 30),
    )
    .sort((a, b) => b.total - a.total);

  if (ranked.length === 0) return null;

  const doc = ranked[0].doc;
  let description: string | null = null;

  if (doc.key) {
    try {
      const workResp = await fetch(`https://openlibrary.org${doc.key}.json`, {
        signal,
      });
      if (workResp.ok) {
        const workData = (await workResp.json()) as {
          description?: string | { value?: string };
        };
        const rawDesc =
          typeof workData.description === "string"
            ? workData.description
            : workData.description?.value;
        description = cleanSynopsis(rawDesc);
      }
    } catch {
      // Ignore optional work fetch error.
    }
  }

  if (!description && doc.first_sentence) {
    const firstSentence = Array.isArray(doc.first_sentence)
      ? doc.first_sentence[0]
      : doc.first_sentence;
    description = cleanSynopsis(firstSentence);
  }

  const withRating =
    ranked.find(
      (r) =>
        typeof r.doc.ratings_average === "number" && r.doc.ratings_average > 0,
    )?.doc ?? doc;

  return {
    title: doc.title?.trim() ?? null,
    author:
      Array.isArray(doc.author_name) && doc.author_name.length > 0
        ? doc.author_name.slice(0, 2).join(", ")
        : null,
    description,
    pageCount:
      typeof doc.number_of_pages_median === "number" &&
      doc.number_of_pages_median > 0
        ? doc.number_of_pages_median
        : null,
    pageLabel: "Páginas",
    language: doc.language?.[0] ?? null,
    coverUrl: doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
      : null,
    rating:
      typeof withRating.ratings_average === "number" &&
      withRating.ratings_average > 0
        ? Number(withRating.ratings_average.toFixed(1))
        : null,
    ratingScale: 5,
    ratingsCount:
      typeof withRating.ratings_count === "number"
        ? withRating.ratings_count
        : null,
    categories: (doc.subject ?? []).slice(0, 4),
    publishedDate: doc.first_publish_year
      ? String(doc.first_publish_year)
      : null,
    publisher: doc.publisher?.[0] ?? null,
    source: "Open Library",
  };
}

async function fetchWikipediaSummary(
  titleQuery: string,
  authorQuery: string | null,
  signal: AbortSignal,
): Promise<string | null> {
  for (const lang of ["es", "en"]) {
    try {
      const searchUrl = new URL(`https://${lang}.wikipedia.org/w/api.php`);
      searchUrl.searchParams.set("action", "query");
      searchUrl.searchParams.set("list", "search");
      searchUrl.searchParams.set(
        "srsearch",
        authorQuery ? `${titleQuery} ${authorQuery}` : titleQuery,
      );
      searchUrl.searchParams.set("srlimit", "1");
      searchUrl.searchParams.set("format", "json");
      searchUrl.searchParams.set("origin", "*");

      const searchResp = await fetch(searchUrl.toString(), { signal });
      if (!searchResp.ok) continue;

      const searchData = (await searchResp.json()) as {
        query?: {
          search?: Array<{ title?: string }>;
        };
      };
      const pageTitle = searchData.query?.search?.[0]?.title;
      if (!pageTitle || scoreTitleMatch(titleQuery, pageTitle) < 50) {
        continue;
      }

      const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`;
      const summaryResp = await fetch(summaryUrl, { signal });
      if (!summaryResp.ok) continue;

      const summaryData = (await summaryResp.json()) as {
        extract?: string;
      };
      const cleaned = cleanSynopsis(summaryData.extract);
      if (!cleaned) continue;
      if (
        authorQuery &&
        scoreAuthorMatch(authorQuery, `${pageTitle} ${cleaned}`) < 0
      ) {
        continue;
      }
      return cleaned;
    } catch {
      // Ignore Wikipedia lookup error.
    }
  }
  return null;
}

function mergePublicMetadata(
  results: Array<PublicBookMetadata | null>,
): PublicBookMetadata | null {
  const valid = results.filter(
    (item): item is PublicBookMetadata => item !== null,
  );
  if (valid.length === 0) return null;

  const primary = valid.find((item) => item.description) ?? valid[0];
  const withRating = valid.find((item) => item.rating !== null) ?? primary;
  const withCategories =
    valid.find((item) => item.categories.length > 0) ?? primary;

  return {
    title: primary.title ?? valid.find((item) => item.title)?.title ?? null,
    author: primary.author ?? valid.find((item) => item.author)?.author ?? null,
    description:
      primary.description ??
      valid.find((item) => item.description)?.description ??
      null,
    pageCount:
      primary.pageCount ??
      valid.find((item) => item.pageCount)?.pageCount ??
      null,
    pageLabel:
      primary.pageLabel ??
      valid.find((item) => item.pageLabel)?.pageLabel ??
      null,
    language:
      primary.language ?? valid.find((item) => item.language)?.language ?? null,
    coverUrl:
      primary.coverUrl ?? valid.find((item) => item.coverUrl)?.coverUrl ?? null,
    rating: withRating.rating,
    ratingScale: withRating.ratingScale,
    ratingsCount: withRating.ratingsCount,
    categories: withCategories.categories,
    publishedDate:
      primary.publishedDate ??
      valid.find((item) => item.publishedDate)?.publishedDate ??
      null,
    publisher:
      primary.publisher ??
      valid.find((item) => item.publisher)?.publisher ??
      null,
    source: primary.source,
  };
}

async function searchSingleQuery(
  titleQuery: string,
  authorQuery: string | null,
  category: LibraryCategory,
  signal: AbortSignal,
): Promise<PublicBookMetadata | null> {
  let merged: PublicBookMetadata | null = null;

  if (category === "manga") {
    const [mangadex, jikan] = await Promise.all([
      fetchMangaDex(titleQuery, signal).catch(() => null),
      fetchJikanManga(titleQuery, signal).catch(() => null),
    ]);
    merged = mergePublicMetadata([mangadex, jikan]);

    if ((!merged?.description || merged.rating === null) && !signal.aborted) {
      const googleFallback = await fetchGoogleBooks(
        titleQuery,
        authorQuery,
        category,
        signal,
      ).catch(() => null);
      merged = mergePublicMetadata([merged, googleFallback]);
    }
  } else if (category === "comics") {
    const [googleComic, mangadex, openLib] = await Promise.all([
      fetchGoogleBooks(titleQuery, authorQuery, category, signal).catch(
        () => null,
      ),
      fetchMangaDex(titleQuery, signal).catch(() => null),
      fetchOpenLibrary(titleQuery, authorQuery, signal).catch(() => null),
    ]);
    merged = mergePublicMetadata([googleComic, openLib, mangadex]);
  } else {
    const [googleBook, openLib] = await Promise.all([
      fetchGoogleBooks(titleQuery, authorQuery, category, signal).catch(
        () => null,
      ),
      fetchOpenLibrary(titleQuery, authorQuery, signal).catch(() => null),
    ]);
    merged = mergePublicMetadata([googleBook, openLib]);
  }

  if (merged && !merged.description && !signal.aborted) {
    const wikiDesc = await fetchWikipediaSummary(
      merged.title ?? titleQuery,
      merged.author ?? authorQuery,
      signal,
    );
    if (wikiDesc) {
      merged = {
        ...merged,
        description: wikiDesc,
      };
    }
  }

  return merged;
}

export async function fetchPublicBookMetadata(
  book: LibraryBook,
  category: LibraryCategory,
  extractedTitle: string | null,
  extractedAuthor: string | null,
  signal: AbortSignal,
): Promise<PublicBookMetadata | null> {
  const { queries, authorQuery } = buildSearchQueries(
    book,
    extractedTitle,
    extractedAuthor,
  );
  if (queries.length === 0) return null;

  try {
    for (const query of queries) {
      if (signal.aborted) return null;
      const result = await searchSingleQuery(
        query,
        authorQuery,
        category,
        signal,
      );
      if (
        result &&
        (result.description ||
          result.rating !== null ||
          result.author ||
          result.pageCount)
      ) {
        return result;
      }
    }
    return null;
  } catch {
    return null;
  }
}
