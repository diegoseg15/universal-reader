import { useEffect, useRef, useState } from "react";
import { BookOpenIcon } from "@phosphor-icons/react";
import type { LibraryBook, LibraryService } from "./LibrarySource";

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
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState("idle");
  const key = JSON.stringify([book.path, book.size, book.modified]);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    let started = false;
    setUrl(null);
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
        setUrl(objectUrl);
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

  return <div ref={element} className={`library-book__cover${url ? " library-book__cover--image" : ""}`} data-cover-status={status}>
    {url ? <img src={url} alt={`Portada de ${book.name}`} decoding="async" onError={() => { setUrl(null); setStatus("unavailable"); }} /> : <>
      <BookOpenIcon size={44} weight="thin" aria-hidden="true" />
      <span className="library-book__cover-title">{book.name.replace(/\.[^.]+$/, "").replace(/_/g, " ")}</span>
      <span className="library-book__cover-footer">{status === "loading" ? "CARGANDO PORTADA…" : status === "unavailable" ? "SIN PORTADA DISPONIBLE" : "UNIVERSAL READER"}</span>
    </>}
    <span className="library-book__format">{book.format.toUpperCase()}</span>
  </div>;
}
