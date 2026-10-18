import { useRef, useState } from "react";
import { EvidenceReader } from "./evidence-reader";
import { medicalExcerpt } from "../shared/medical-excerpt.mjs";
import "./task-result.css";
export function TaskResult({ run, files = [], sessionId }) {
  const results = run?.displayResults || [],
    diagnostic = results.find((r) => r.kind === "diagnostic");
  const assessment = run?.artifacts?.find((a) => a.type === "treatment_review");
  const calculations = results.filter((r) => r.kind === "calculator");
  const literature = results.filter((r) => r.kind === "literature");
  const [query, setQuery] = useState("");
  if (diagnostic || assessment)
    return (
      <AssessmentResult
        diagnostic={diagnostic}
        assessment={assessment}
        files={files}
        sessionId={sessionId}
      />
    );
  if (calculations.length)
    return (
      <section className="task-result" aria-label="医学计算结果">
        {calculations.map((r, i) => (
          <article key={i}>
            <h3>{r.scaleName}</h3>
            <div className="calculation-value">
              {r.score}
              <span>{r.level}</span>
            </div>
            <p>{r.interpretation}</p>
            <h4>本次使用的数值</h4>
            <dl>
              {r.inputs?.map((v, j) => (
                <div key={j}>
                  <dt>{v.label}</dt>
                  <dd>{v.value === undefined ? "未提供" : String(v.value)}</dd>
                </div>
              ))}
            </dl>
            <details>
              <summary>计算方法与说明</summary>
              <p>{r.formula}</p>
              {r.detail?.map((v, j) => (
                <p key={j}>
                  {v.item}：{v.answer}{" "}
                  {v.points !== undefined ? `（${v.points}）` : ""}
                </p>
              ))}
              <p>{r.note}</p>
            </details>
          </article>
        ))}
      </section>
    );
  if (literature.length) {
    const articles = [
      ...new Map(
        literature
          .flatMap((r) => r.articles || (r.title ? [r] : []))
          .map((a) => [a.pmid || a.doi || a.title, a]),
      ).values(),
    ];
    const visible = articles.filter((a) =>
      `${a.title} ${a.journal} ${a.abstract || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
    return (
      <section className="task-result" aria-label="文献检索结果">
        <h3>文献检索结果 · {articles.length} 篇</h3>
        <input
          aria-label="筛选文献"
          placeholder="搜索标题、期刊或摘要"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {visible.map((a, i) => (
          <article key={a.pmid || a.doi || i}>
            <h4>{a.title}</h4>
            <p>
              {a.journal} {a.year}
            </p>
            <details>
              <summary>
                {a.abstract ? "阅读摘要" : "仅有题录，尚未读取摘要"}
              </summary>
              <p>{medicalExcerpt(a.abstract) || "尚未取得摘要。"}</p>
            </details>
            {a.pmid && /^\d+$/.test(String(a.pmid)) && (
              <a
                href={`https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`}
                target="_blank"
                rel="noreferrer"
              >
                查看原文网页
              </a>
            )}
          </article>
        ))}
        {!visible.length && (
          <p>
            {articles.length
              ? "没有符合筛选条件的文献。"
              : "本次没有取得文献，请查看检索记录。"}
          </p>
        )}
        <details>
          <summary>检索记录</summary>
          {literature
            .filter((r) => r.tool === "literature_search")
            .map((r, i) => (
              <div key={i}>
                <p>
                  {r.query} {r.source} {r.note}
                </p>
                {r.searches?.map((s, j) => (
                  <p key={j}>
                    {s.query} · {s.source} · {s.status}
                    {s.error ? `：${s.error}` : ""}
                  </p>
                ))}
              </div>
            ))}
        </details>
      </section>
    );
  }
  return null;
}
export const hasTaskResult = (run) =>
  Boolean(
    run?.displayResults?.some((r) =>
      ["diagnostic", "calculator", "literature"].includes(r.kind),
    ) || run?.artifacts?.some((a) => a.type === "treatment_review"),
  );

function AssessmentResult({ diagnostic, assessment, files, sessionId }) {
  const [selected, setSelected] = useState(null);
  const trigger = useRef(null);
  const open = (value, event) => {
    trigger.current = event.currentTarget;
    setSelected(value);
  };
  const close = () => {
    setSelected(null);
    trigger.current?.focus({ preventScroll: true });
  };
  const candidates = diagnostic?.candidates || [];
  const selectedCandidate =
    typeof selected === "number" ? candidates[selected] : null;
  const sources = selectedCandidate
    ? selectedCandidate.quote
      ? [
          {
            sourceName: selectedCandidate.sourceName || "患者资料摘录",
            quote: medicalExcerpt(selectedCandidate.quote),
            line: selectedCandidate.line,
          },
        ]
      : []
    : (assessment?.matches || []).map((m) => ({
        ...m,
        snapshot: assessment.evidenceSources?.find(source => source.id === m.sourceId),
        quote: medicalExcerpt(m.quote),
      }));
  return (
    <section
      className="task-result assessment-result"
      aria-label="辅助诊断与方案评估"
    >
      <header className="assessment-heading">
        <span className="evidence-kicker">诊疗参考 · 待医生核对</span>
        <h3>{diagnostic ? "辅助诊断参考" : "治疗方案评估"}</h3>
        <p>{(diagnostic || assessment).summary}</p>
      </header>
      <div
        className={`assessment-layout ${selected !== null ? "has-evidence" : ""}`}
      >
        <div className="assessment-findings">
          {diagnostic ? (
            candidates.map((c, i) => (
              <article key={i} className={selected === i ? "is-selected" : ""}>
                <h4>
                  <span className="assessment-number">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {c.name}
                </h4>
                <dl>
                  <dt>支持的依据</dt>
                  <dd>{c.support || "尚未记录"}</dd>
                  <dt>不支持或需要注意的地方</dt>
                  <dd>{c.against || "尚未记录"}</dd>
                  <dt>还需补充</dt>
                  <dd>{c.missing || "尚未记录"}</dd>
                </dl>
                <button
                  className="secondary"
                  aria-expanded={selected === i}
                  onClick={(event) => open(i, event)}
                >
                  查看「{c.name}」的依据
                </button>
              </article>
            ))
          ) : (
            <>
              {[
                ["需要注意", assessment.concerns],
                ["还需补充", assessment.infoGaps],
                ["建议进一步核对", assessment.questions],
              ].map(
                ([label, items], i) =>
                  items?.length > 0 && (
                    <article key={label}>
                      <h4>
                        <span className="assessment-number">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        {label}
                      </h4>
                      <ul>
                        {items.map((x, j) => (
                          <li key={j}>{x}</li>
                        ))}
                      </ul>
                    </article>
                  ),
              )}
              <button
                className="secondary assessment-source-button"
                aria-expanded={selected === "assessment"}
                onClick={(event) => open("assessment", event)}
              >
                查看本次评估依据 · {sources.length} 项
              </button>
            </>
          )}
        </div>
        {selected !== null && (
          <EvidenceReader
            title={selectedCandidate ? selectedCandidate.name : "本次评估依据"}
            sources={sources}
            files={files}
            sessionId={sessionId}
            onClose={close}
          >
            {!diagnostic && (
              <p className="evidence-scope">
                以下资料用于本次整体评估，尚未标注与每条意见的对应关系。
              </p>
            )}
          </EvidenceReader>
        )}
      </div>
      <small>供医生核对，不自动写入诊断或调整治疗。</small>
    </section>
  );
}
