import { useEffect, useRef, useState } from "react";
import { BookOpenIcon } from "@phosphor-icons/react";
import type { LibraryBook, LibraryService } from "./LibrarySource";
import {
  getEffectiveBookMetadata,
  METADATA_UPDATED_EVENT,
} from "./PublicBookMetadata";

let active = 0;
const queue: (() => void)[] = [];
function schedule<T>(work: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      active++;
      void work().then(resolve, reject).finally(() => { active--; queue.shift()?.(); });
    };
    if (active < 2) run(); else queue.push(run);
  });
}

type Props = { book: LibraryBook; loader: LibraryService["loadCover"]; revision: number };

export function LibraryCover({ book, loader, revision }: Props) {
  const element = useRef<HTMLDivElement>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [remoteFailed, setRemoteFailed] = useState(false);
  const [status, setStatus] = useState("idle");
  const [, setMetaVersion] = useState(0);
  const key = JSON.stringify([book.path, book.size, book.modified]);

  useEffect(() => {
    function handleMetaUpdate(event: Event): void {
      const detail = (event as CustomEvent<{ bookPath?: string }>).detail;
      if (!detail?.bookPath || detail.bookPath === book.path) {
        setRemoteFailed(false);
        setMetaVersion((v) => v + 1);
      }
    }
    window.addEventListener(METADATA_UPDATED_EVENT, handleMetaUpdate);
    return () => window.removeEventListener(METADATA_UPDATED_EVENT, handleMetaUpdate);
  }, [book.path]);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    let started = false;
    setLocalUrl(null);
    setRemoteFailed(false);
    setStatus("idle");
    const load = () => {
      if (started || !loader) { if (!loader) setStatus("unavailable"); return; }
      started = true;
      setStatus("loading");
      void schedule(async () => {
        if (controller.signal.aborted) return null;
        return loader(book, controller.signal);
      }).then((blob) => {
        if (controller.signal.aborted) return;
        if (!blob) { setStatus("unavailable"); return; }
        objectUrl = URL.createObjectURL(blob);
        setLocalUrl(objectUrl);
        setStatus("ready");
      }).catch(() => { if (!controller.signal.aborted) setStatus("unavailable"); });
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); load(); }
    }, { rootMargin: "180px" });
    if (element.current) observer.observe(element.current);
    return () => {
      controller.abort();
      observer.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key, loader, revision]);

  const savedMeta = getEffectiveBookMetadata(book.path);
  const remoteUrl = !remoteFailed ? (savedMeta?.coverUrl ?? null) : null;
  const preferRemote = Boolean(
    remoteUrl && savedMeta?.source.includes("Editado"),
  );
  const displayUrl = preferRemote
    ? (remoteUrl ?? localUrl)
    : (localUrl ?? (status === "unavailable" ? remoteUrl : null));
  const displayTitle =
    savedMeta?.title ?? book.name.replace(/\.[^.]+$/, "").replace(/_/g, " ");

  return <div ref={element} className={`library-book__cover${displayUrl ? " library-book__cover--image" : ""}`} data-cover-status={displayUrl ? "ready" : status}>
    {displayUrl ? <img src={displayUrl} alt={`Portada de ${displayTitle}`} decoding="async" onError={() => {
      if (displayUrl === remoteUrl) {
        setRemoteFailed(true);
      } else {
        setLocalUrl(null);
        setStatus("unavailable");
      }
    }} /> : <>
      <BookOpenIcon size={44} weight="thin" aria-hidden="true" />
      <span className="library-book__cover-title">{displayTitle}</span>
      <span className="library-book__cover-footer">{status === "loading" ? "CARGANDO PORTADA…" : status === "unavailable" ? "SIN PORTADA DISPONIBLE" : "UNIVERSAL READER"}</span>
    </>}
    <span className="library-book__format">{book.format.toUpperCase()}</span>
  </div>;
}
