import { useEffect, useRef, useState } from "react";
import { api } from "./agent-runtime";
import {
  tableCitationRows,
  tableCitationLabel,
} from "./knowledge-table-model.mjs";
import { ChevronLeft } from "lucide-react";
import { coverageLabel } from "../shared/knowledge-profiles.mjs";
import { KnowledgeReading } from "./knowledge-organization";
import { KnowledgeTablePreview } from "./knowledge-table-preview";
import { KnowledgeTextEditor } from "./knowledge-text-editor";
export function KnowledgeReader({
  reader,
  onClose,
  onReview,
  onPrepare,
  busy,
  error,
  embedded = false,
  onLocationLabel,
  onUpdated,
}) {
  const [editingText, setEditingText] = useState(false),
    [textNotice, setTextNotice] = useState("");
  const [tableResult, setTableResult] = useState(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [addresses, setAddresses] = useState(false);
  const [tableRetry, setTableRetry] = useState(0);
  const ready = tableResult?.docId === reader.doc.id;
  const table = ready && tableResult.sheets?.length ? tableResult : null;
  useEffect(() => {
    let alive = true;
    setTableResult(null);
    setRawOpen(false);
    api(`/api/knowledge/${reader.doc.id}/table`)
      .then((data) => {
        if (alive) setTableResult({ ...data, docId: reader.doc.id });
      })
      .catch((error) => {
        if (alive)
          setTableResult({ docId: reader.doc.id, error: error.message });
      });
    return () => {
      alive = false;
    };
  }, [reader.doc.id, reader.doc.sha256, tableRetry]);
  useEffect(() => {
    onLocationLabel?.(
      table
        ? tableCitationLabel(tableCitationRows(table, reader.highlight)) ||
            "表格引用待核对"
        : "",
    );
  }, [table, reader.highlight, onLocationLabel]);
  const selectedLineRef = useRef(null),
    headingRef = useRef(null);
  const targetLine =
    reader?.highlight?.matches?.[0]?.lineNo ||
    reader?.highlight?.startLine ||
    1;
  useEffect(() => {
    if (!reader.highlight) {
      if (embedded) return;
      headingRef.current?.scrollIntoView({
        block: "start",
        behavior: "instant",
      });
      return;
    }
    if (!ready || (table && !rawOpen)) return;
    const target = selectedLineRef.current;
    if (!target) return;
    let active = true,
      frame;
    const align = () => {
      if (!active) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (active) {
          const container = embedded && target.closest(".kw-source-body");
          if (container) {
            const rect = target.getBoundingClientRect(),
              parent = container.getBoundingClientRect();
            container.scrollTop +=
              rect.top -
              parent.top -
              Math.max(16, (container.clientHeight - rect.height) / 2);
          } else
            target.scrollIntoView({ block: "center", behavior: "instant" });
        }
      });
    };
    const observer = new ResizeObserver(align);
    observer.observe(target.closest(".guidelines-view"));
    observer.observe(target.parentElement);
    observer.observe(target);
    const stop = () => {
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // Late fonts/settings and source metadata can reflow both scroll containers.
    // Keep the initial anchor through layout changes, until the reader interacts.
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
      window.addEventListener(event, stop, { once: true, passive: true });
    document.fonts?.ready.then(align);
    align();
    return () => {
      stop();
      for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
        window.removeEventListener(event, stop);
    };
  }, [
    reader?.doc?.id,
    targetLine,
    Boolean(reader.highlight),
    embedded,
    ready,
    Boolean(table),
    rawOpen,
  ]);
  {
    const lines = reader.doc.text.split("\n");
    const { highlight } = reader;
    return (
      <div className="module-view kw-reader">
        {!embedded && (
          <div className="kw-reader-toolbar" ref={headingRef}>
            {window.history.state?.knowledgeReturn && (
              <button
                className="secondary"
                onClick={() => window.history.back()}
              >
                <ChevronLeft size={15} /> 返回回答
              </button>
            )}
            <button className="secondary" onClick={onClose}>
              <ChevronLeft size={15} /> 返回工作区
            </button>
            <span>{reader.doc.title}</span>
          </div>
        )}
        <section className="module-card guidelines-view">
          <div className="guidelines-reader-head">
            <h1>{reader.doc.title}</h1>
            <span className="muted">
              {[reader.doc.org, reader.doc.year].filter(Boolean).join(" · ")}
            </span>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {textNotice && <p role="status">{textNotice}</p>}
          {reader.stale && (
            <p className="form-error" role="alert">
              原文已更新，此引用来自旧内容。请重新核对当前段落，不要沿用旧行号。
            </p>
          )}
          {reader.doc.reviewStatus === "retired" && !embedded && (
            <p role="alert" className="form-error">
              此来源已停用。
            </p>
          )}
          {reader.doc.coverage?.status &&
            reader.doc.coverage.status !== "complete" && (
              <p role="status" className="form-error">
                {coverageLabel(reader.doc.coverage)}
              </p>
            )}
          {!ready && <p role="status">正在加载原文…</p>}
          {table && (
            <KnowledgeTablePreview
              key={reader.doc.id}
              data={table}
              highlight={reader.highlight}
              addresses={addresses}
              showCitationLabel={!embedded}
            />
          )}
          {ready && tableResult.error && (
            <p className="form-error" role="alert">
              表格视图暂不可用：{tableResult.error}
              。以下为提取文本，可重试或核对原件。
              <button
                className="text-button"
                onClick={() => setTableRetry((v) => v + 1)}
              >
                重试表格读取
              </button>
            </p>
          )}
          <details
            className={`kw-source-details ${embedded ? "kw-reader-more" : ""}`}
            onToggle={(e) => {
              if (!e.currentTarget.open) setRawOpen(false);
            }}
          >
            <summary>更多</summary>
            <div className="knowledge-source-card">
              <span
                className={`knowledge-state ${reader.doc.reviewStatus || "unreviewed"}`}
              >
                {reader.doc.reviewStatus === "retired" ? "已停用" : "使用中"}
              </span>
              {(reader.doc.edition || reader.doc.year) && (
                <span>{reader.doc.edition || reader.doc.year}</span>
              )}
              {reader.doc.sourceUrl && (
                <a href={reader.doc.sourceUrl} target="_blank" rel="noreferrer">
                  打开来源发布页
                </a>
              )}
              {onReview && (
                <button
                  className="text-button"
                  onClick={() => onReview(reader.doc)}
                >
                  管理来源与版本
                </button>
              )}
              {onUpdated && (
                <button
                  className="text-button"
                  onClick={() => {
                    setEditingText(true);
                    setTextNotice("");
                  }}
                >
                  修正正文
                </button>
              )}
            </div>

            {onPrepare && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => onPrepare(reader.doc, highlight)}
              >
                用此来源准备循证任务
              </button>
            )}
            <KnowledgeReading doc={reader.doc} highlight={highlight} />
            {table && (
              <label className="kw-sheet-options">
                <input
                  type="checkbox"
                  checked={addresses}
                  onChange={(e) => setAddresses(e.target.checked)}
                />
                显示单元格位置
              </label>
            )}
            {table && (
              <button
                className="text-button kw-raw-toggle"
                aria-expanded={rawOpen}
                onClick={() => setRawOpen((v) => !v)}
              >
                {rawOpen ? "收起提取文本" : "查看提取文本"}
              </button>
            )}
          </details>
          {editingText && (
            <KnowledgeTextEditor
              key={reader.doc.id}
              doc={reader.doc}
              onClose={() => setEditingText(false)}
              onSaved={(doc) => {
                onUpdated(doc);
                setEditingText(false);
                setTextNotice(
                  "正文已保存。请核对索引状态、重新生成图谱，并重新审核来源。",
                );
              }}
            />
          )}
          {ready && (!table || rawOpen) && (
            <div className="guidelines-text">
              {lines.map((line, index) => {
                const lineNo = index + 1;
                const isMatch =
                  highlight &&
                  lineNo >= highlight.startLine &&
                  lineNo <= highlight.endLine;
                return (
                  <p
                    key={lineNo}
                    ref={lineNo === targetLine ? selectedLineRef : null}
                    data-line={lineNo}
                    className={`guideline-line ${isMatch ? "matched" : ""}`}
                  >
                    <span className="line-no">{lineNo}</span>
                    {line || " "}
                  </p>
                );
              })}
            </div>
          )}
        </section>
      </div>
    );
  }
}
