import { useEffect, useRef } from "react";
import { BookOpen, X } from "lucide-react";
import { sourceFile, exactQuote } from "../shared/clinical-evidence.mjs";
import { MaterialDetails } from "./material-details";
import "./evidence-reader.css";

export function EvidenceReader({
  title,
  sources = [],
  files = [],
  sessionId,
  onClose,
  children,
}) {
  const heading = useRef(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <aside className="evidence-reader" aria-label="依据阅读区">
      <header>
        <div>
          <span className="evidence-kicker">
            <BookOpen size={15} /> 对照阅读
          </span>
          <h4 ref={heading} tabIndex={-1}>
            {title}
          </h4>
        </div>
        {onClose && (
          <button
            className="icon-button"
            aria-label="关闭依据区"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        )}
      </header>
      {children}
      <div className="evidence-scroll">
        {sources.length ? (
          sources.map((entry, i) => {
            const source =
              typeof entry === "string" ? { sourceName: entry } : entry;
            const file = sourceFile(source.sourceName, files);
            const match = exactQuote(file?.text, source.quote);
            return (
              <section
                className="evidence-document"
                key={`${source.sourceName}-${i}`}
              >
                <span className="evidence-kicker">
                  {source.kind || "患者资料"}
                </span>
                <h5>{source.sourceName || "资料出处未记录"}</h5>
                {(source.page || source.line) && (
                  <p className="evidence-location">
                    引用时位置 ·{" "}
                    {source.page
                      ? `第 ${source.page} 页`
                      : `第 ${source.line} 行`}
                  </p>
                )}
                {source.quote && <blockquote>{source.quote}</blockquote>}
                {file ? (
                  <details open={!source.quote} className="evidence-original">
                    <summary>查看完整资料 · {file.name}</summary>
                    {match ? (
                      <pre>
                        {match.before}
                        <mark>{match.quote}</mark>
                        {match.after}
                      </pre>
                    ) : (
                      <pre>{file.text || "暂无可读取文字"}</pre>
                    )}
                    {source.quote && !match && (
                      <p className="muted">
                        当前文本中未找到唯一匹配的引文，请对照完整资料核对。
                      </p>
                    )}
                    {file.extraction && (
                      <MaterialDetails
                        key={file.id}
                        file={file}
                        sessionId={sessionId}
                        visionSupported={null}
                      />
                    )}
                  </details>
                ) : (
                  <p className="evidence-location">
                    {source.quote
                      ? "已保存的引用片段；当前资料中未匹配到唯一原文件。"
                      : "当前资料中未匹配到唯一原文件，请按来源名称核对。"}
                  </p>
                )}
              </section>
            );
          })
        ) : (
          <p className="evidence-empty">
            这项记录尚未保存来源，可结合患者已有资料补充核对。
          </p>
        )}
      </div>
    </aside>
  );
}
