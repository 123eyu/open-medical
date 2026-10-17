import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { api } from "./agent-runtime";
import { KnowledgeReader } from "./knowledge-reader";
import { KNOWLEDGE_SOURCE_EVENT } from "./knowledge-source-events";
import "./knowledge-source-panel.css";

export function KnowledgeSourcePanel({ contextKey }) {
  const [request, setRequest] = useState(null);
  const [reader, setReader] = useState(null);
  const [error, setError] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [locationLabel, setLocationLabel] = useState("");
  const [retry, setRetry] = useState(0);
  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 1100px)").matches,
  );
  const panel = useRef(null),
    body = useRef(null),
    closeButton = useRef(null),
    trigger = useRef(null),
    moreScroll = useRef(0);
  const close = () => {
    setRequest(null);
    if (trigger.current?.isConnected)
      trigger.current.focus({ preventScroll: true });
  };
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1100px)");
    const change = () => setNarrow(media.matches);
    media.addEventListener("change", change);
    const open = (event) => {
      if (!panel.current?.contains(document.activeElement))
        trigger.current = document.activeElement;
      setMoreOpen(false);
      setLocationLabel("");
      setReader(null);
      setError("");
      setRequest({ ...event.detail });
    };
    window.addEventListener(KNOWLEDGE_SOURCE_EVENT, open);
    return () => {
      media.removeEventListener("change", change);
      window.removeEventListener(KNOWLEDGE_SOURCE_EVENT, open);
    };
  }, []);
  useEffect(() => {
    setRequest(null);
  }, [contextKey]);
  useEffect(() => {
    if (!request) return;
    let alive = true;
    setReader(null);
    setError("");
    api(`/api/knowledge/${encodeURIComponent(request.id || "")}`)
      .then((doc) => {
        if (!alive) return;
        const stale = Boolean(request.sourceHash && request.sourceHash !== doc.sha256);
        const range = stale ? null : request.highlight;
        if (
          range &&
          (!Number.isInteger(range.startLine) ||
            !Number.isInteger(range.endLine) ||
            range.startLine < 1 ||
            range.endLine < range.startLine ||
            range.endLine > doc.lineCount)
        )
          throw new Error("引用行号已失效，请重新检索并核对原文。");
        setReader({
          doc,
          highlight: range || null,
          stale,
        });
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [request, retry]);
  useLayoutEffect(() => {
    if (!request) return;
    closeButton.current?.focus({ preventScroll: true });
  }, [request]);
  useEffect(() => {
    if (!request) return;
    const roots = narrow
      ? [
          ...document.querySelectorAll(
            ".product-content, .app-navigation, .topbar",
          ),
        ]
      : [];
    const states = roots.map((e) => e.inert);
    roots.forEach((e) => {
      e.inert = true;
    });
    const keydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        // Restore inert before returning focus to the citation.
        roots.forEach((e, i) => {
          e.inert = states[i];
        });
        close();
      }
      if (narrow && event.key === "Tab") {
        const controls = [
          ...panel.current.querySelectorAll(
            'button:not(:disabled), a[href], input, select, textarea, summary, [tabindex="0"]',
          ),
        ].filter((e) => e.getClientRects().length);
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      roots.forEach((e, i) => {
        e.inert = states[i];
      });
      window.removeEventListener("keydown", keydown);
      if (
        trigger.current?.isConnected &&
        !document.querySelector(".kw-source-panel")
      )
        trigger.current.focus({ preventScroll: true });
    };
  }, [Boolean(request), narrow]);
  if (!request) return null;
  return (
    <aside
      ref={panel}
      className="kw-source-panel"
      role="dialog"
      aria-modal={narrow ? "true" : undefined}
      aria-labelledby="kw-source-heading"
    >
      <header className="kw-source-heading">
        <div>
          <h2 id="kw-source-heading">{reader?.doc.title || "查看引用原文"}</h2>
        </div>
        <button
          ref={closeButton}
          className="icon-button"
          aria-label="关闭溯源"
          onClick={close}
        >
          <X size={20} />
        </button>
      </header>
      {reader && (
        <div className="kw-source-context">
          {reader.doc.reviewStatus === "retired" && (
            <strong role="alert">来源已停用</strong>
          )}
          {reader.doc.edition && <span>{reader.doc.edition}</span>}
          {reader.highlight && (
            <span>
              {locationLabel ||
                `第 ${reader.highlight.startLine}–${reader.highlight.endLine} 行`}
            </span>
          )}
          {reader.stale && (
            <strong role="alert">原文已更新，请重新核对当前段落。</strong>
          )}
          <button
            className="text-button"
            aria-expanded={moreOpen}
            onClick={() => {
              const details = body.current.querySelector(".kw-source-details");
              if (details) {
                if (!details.open) moreScroll.current = body.current.scrollTop;
                details.open = !details.open;
                setMoreOpen(details.open);
                if (details.open)
                  body.current.scrollTop +=
                    details.getBoundingClientRect().top -
                    body.current.getBoundingClientRect().top;
                else
                  requestAnimationFrame(() => {
                    if (body.current)
                      body.current.scrollTop = moreScroll.current;
                  });
              } else body.current.scrollTop = 0;
            }}
          >
            更多
          </button>
        </div>
      )}
      <div
        ref={body}
        className="kw-source-body"
        tabIndex={0}
        aria-label="引用原文内容"
        aria-busy={!reader && !error}
      >
        {error ? (
          <div className="kw-source-feedback" role="alert">
            <p>{error}</p>
            <button
              className="secondary"
              onClick={() => setRetry((v) => v + 1)}
            >
              重试读取
            </button>
          </div>
        ) : reader ? (
          <KnowledgeReader
            embedded
            onLocationLabel={setLocationLabel}
            reader={reader}
            onLocate={(_id, highlight) =>
              setReader((current) => ({ ...current, highlight }))
            }
          />
        ) : (
          <p className="kw-source-feedback" role="status">
            正在读取原文…
          </p>
        )}
      </div>
    </aside>
  );
}
