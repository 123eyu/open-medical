import { useEffect, useRef, useState } from "react";
import { api } from "../../../src/agent-runtime";
import { requestSettingsTab } from "../../../src/extension-center";
import "../../../src/tools-clarity.css";
import "./literature.css";
import { Search, Loader2, FilePlus, Copy, ExternalLink, Check } from "lucide-react";

// Literature search view: queries PubMed / Europe PMC through the local
// server. Only the query text leaves the machine; imports land as session
// materials with SHA-256 provenance. Non-Latin queries (e.g. Chinese) are
// handed to the assistant, which needs a configured model.
const NON_LATIN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Devanagari}]/u;
export function LiteratureView({ onOpenTask, config, onSettings }) {
  const modelConfigured = Boolean(config?.modelConfigured);
  const openModelSettings = () => { requestSettingsTab("general"); onSettings?.(); };
  const [specialty, setSpecialty] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("research");
  const [source, setSource] = useState("pubmed");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState({});
  const importsInFlight = useRef(new Set());
  const searchInFlight = useRef(false);
  const importSessions = useRef(new Map());
  const [importing, setImporting] = useState({});
  const [abstractErrors, setAbstractErrors] = useState({});
  const [abstracts, setAbstracts] = useState({});
  const [imported, setImported] = useState({});
  const [copied, setCopied] = useState("");

  useEffect(() => {
    api("/api/doctor/profile")
      .then((profile) => setSpecialty(profile.fields?.specialty || ""))
      .catch(() => {});
  }, []);
  const runSearch = async (event, options = {}) => {
    event?.preventDefault();
    const searchQuery = options.query ?? query;
    if (searchInFlight.current || !searchQuery.trim()) return;
    const needsAssistant = mode === "research" || NON_LATIN.test(searchQuery);
    if (needsAssistant && !modelConfigured) {
      setError("需先连接模型：研究与综述、中文等非英文检索交给助手处理，未连接模型时不能发送。可改用英文关键词直接查找论文。");
      return;
    }
    searchInFlight.current = true;
    setBusy(true);
    setError("");
    setResults(null);
    try {
      if (needsAssistant) {
        const session = await api("/api/sessions", "POST", { title: `${mode === "research" ? "文献研究" : "文献检索"} · ${searchQuery.slice(0, 40)}` });
        // 医生的检索词原样作为提问；方式、来源和年份作为附带上下文。
        await onOpenTask(session.id, {
          submit: true,
          draft: searchQuery,
          context: {
            kind: "literature-search",
            label: `${mode === "research" ? "文献研究" : "查找论文"} · ${options.source || source}${yearFrom || yearTo ? ` · ${yearFrom || "不限"}–${yearTo || "不限"}` : ""}`,
            scope: {
              mode: mode === "research" ? "research" : "search",
              source: options.source || source,
              ...(yearFrom ? { yearFrom } : {}),
              ...(yearTo ? { yearTo } : {}),
              ...(options.sort === "date" ? { sort: "date" } : {}),
            },
          },
          ...(mode === "research" ? { workflow: "literature-research" } : {}),
        });
        return;
      }
      const params = new URLSearchParams({
        query: searchQuery,
        source: options.source || source,
        limit: "15",
      });
      if (options.sort) params.set("sort", options.sort);
      if (options.source) setSource(options.source);
      if (yearFrom) params.set("yearFrom", yearFrom);
      if (yearTo) params.set("yearTo", yearTo);
      const value = await api(`/api/literature/search?${params}`);
      setResults(value);
      setAbstracts({});
      setExpanded({});
      if (options.query !== undefined) setQuery(searchQuery);
    } catch (err) {
      setError(err.message);
    } finally {
      searchInFlight.current = false;
      setBusy(false);
    }
  };
  const loadAbstract = async (article) => {
    const key = article.pmid || article.doi;
    if (abstracts[key]) return abstracts[key];
    const params = new URLSearchParams();
    if (article.pmid) params.set("pmid", article.pmid);
    else params.set("doi", article.doi);
    setAbstractErrors(prev => ({ ...prev, [key]: "" }));
    try {
      const full = await api(`/api/literature/article?${params}`);
      setAbstracts((prev) => ({ ...prev, [key]: full }));
      return full;
    } catch (err) {
      setAbstractErrors(prev => ({ ...prev, [key]: err.message }));
    }
  };
  const toggleExpand = async (article) => {
    const key = article.pmid || article.doi;
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
    if (!expanded[key]) loadAbstract(article).catch(() => {});
  };
  const importAsMaterial = async (article) => {
    const key = article.pmid || article.doi;
    if (importsInFlight.current.has(key)) return;
    importsInFlight.current.add(key);
    setImporting(prev => ({ ...prev, [key]: true }));
    setError("");
    try {
      let session = importSessions.current.get(key);
      if (!session) {
        session = await api("/api/sessions", "POST", { title: `文献 · ${(article.title || "未命名").slice(0, 40)}` });
        importSessions.current.set(key, session);
      }
      await api("/api/literature/import", "POST", {
        sessionId: session.id,
        pmid: article.pmid || undefined,
        doi: article.pmid ? undefined : article.doi || undefined,
      });
      setImported((prev) => ({ ...prev, [article.pmid || article.doi]: true }));
      await onOpenTask?.(session.id);
    } catch (err) {
      setError(err.message);
    } finally {
      importsInFlight.current.delete(key);
      setImporting(prev => ({ ...prev, [key]: false }));
    }
  };
  const citation = (article) => {
    const authors = article.authors || [];
    const authorText =
      authors.length > 3 ? `${authors.slice(0, 3).join(", ")} 等` : authors.join(", ");
    return `${authorText}. ${article.title}. ${article.journal}${article.year ? `, ${article.year}` : ""}.${article.doi ? ` doi:${article.doi}.` : ""}${article.pmid ? ` PMID:${article.pmid}.` : ""}`;
  };
  const copyCitation = async (article) => {
    try {
      await navigator.clipboard.writeText(citation(article));
      setCopied(article.pmid || article.doi);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setError("无法写入剪贴板，请重试或手动复制");
    }
  };
  const pubmedLink = (article) =>
    article.pmid
      ? `https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/`
      : `https://doi.org/${article.doi}`;

  return (
    <div className="module-view tool-page">
      <section className="module-card literature-view">
        <div className="module-head">
          <div>
            <h1>文献研究</h1>
            <p className="module-phase">围绕问题查找、阅读和比较证据，形成有来源的总结。</p>
          </div>
        </div>
        <section className="tool-section literature-search">
          <div className="tool-section-head">
            <div className="tool-segment" role="group" aria-label="文献工作方式"><button aria-pressed={mode === 'research'} onClick={() => setMode('research')}>研究与综述</button><button aria-pressed={mode === 'search'} onClick={() => setMode('search')}>查找论文</button></div>
            {specialty && (
              <button
                className="om-link"
                onClick={(event) =>
                  runSearch(event, {
                    query: specialty,
                    source: "europepmc",
                    sort: "date",
                  })
                }
                disabled={busy}
              >
                {mode === 'research' ? '让助手研究我关注的领域：' : NON_LATIN.test(specialty) ? '让助手查找近期论文：' : '查找最新论文：'}{specialty} →
              </button>
            )}
          </div>
          <p className="om-meta literature-mode-hint">{mode === "research" ? "描述临床问题，助手检索并比较证据，生成带出处的总结（需已连接模型）。" : "按主题、标题、PMID 或英文关键词直接检索 PubMed / Europe PMC；中文等非英文检索词交给助手处理，需已连接模型。"}</p>
          {!modelConfigured && (mode === "research" || NON_LATIN.test(query)) && <p className="notice" role="status">需先连接模型：{mode === "research" ? "研究与综述" : "非英文检索"}由助手执行，未连接模型时不能发送。<button type="button" className="text-button" onClick={openModelSettings}>连接模型</button></p>}
          <form className="literature-form" onSubmit={runSearch}>
            <textarea
              rows={3}
              className="literature-query"
              value={query}
              aria-label="文献检索主题" placeholder={mode === "research" ? "描述你要解决的问题，例如：比较两种治疗方案的证据、适用人群和局限" : "论文主题、标题、PMID 或英文关键词"}
              onChange={(e) => setQuery(e.target.value)}
            />
            <details className="literature-options om-disclosure"><summary>检索范围：{source === "pubmed" ? "PubMed" : "Europe PMC"}{yearFrom || yearTo ? ` · ${yearFrom || "不限"}–${yearTo || "至今"}` : " · 不限年份"}</summary><div>
            <select aria-label="文献来源" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="pubmed">PubMed</option>
              <option value="europepmc">Europe PMC</option>
            </select>
            <input
              className="literature-year"
              value={yearFrom}
              aria-label="检索起始年" placeholder="起始年"
              inputMode="numeric"
              onChange={(e) => setYearFrom(e.target.value.replace(/\D/g, ""))}
            />
            <input
              className="literature-year"
              value={yearTo}
              aria-label="检索结束年" placeholder="结束年"
              inputMode="numeric"
              onChange={(e) => setYearTo(e.target.value.replace(/\D/g, ""))}
            />
            </div></details>
            <button className="primary" type="submit" disabled={busy || !query.trim() || (!modelConfigured && (mode === "research" || NON_LATIN.test(query)))} title={!modelConfigured && (mode === "research" || NON_LATIN.test(query)) ? "需先连接模型" : undefined}>
              {busy ? <Loader2 className="spin" size={15} /> : <Search size={15} />}
              {mode === "research" ? "开始研究" : NON_LATIN.test(query) ? "让助手查找" : "检索"}
            </button>
          </form>
        </section>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {results && (
          <p className="om-meta literature-meta">
            {results.cached ? "（本地缓存结果）" : ""}
            共 {results.count} 条 · 来源：{results.source === "pubmed" ? "PubMed" : "Europe PMC"}
            {results.fallback && <span role="status"> · {results.note}</span>}
          </p>
        )}
        {results && <ul className="literature-results tool-section tool-list">
          {(results?.articles || []).map((article) => {
            const key = article.pmid || article.doi;
            return (
              <li className="literature-item" key={key}>
                <div className="literature-title-row tool-list-title">
                  <button aria-expanded={Boolean(expanded[key])} className="literature-title" onClick={() => toggleExpand(article)}>
                    {article.title}
                  </button>
                  <span className="literature-journal">
                    {article.journal}
                    {article.year ? ` · ${article.year}` : ""}
                  </span>
                </div>
                <p className="literature-authors">
                  {(article.authors || []).slice(0, 4).join(", ")}
                  {article.authorCount > 4 ? " 等" : ""}
                </p>
                {(article.hints || []).length > 0 && (
                  <div className="literature-hints">
                    {article.hints.map((hint) => (
                      <span className="om-chip" key={hint}>
                        {hint}
                      </span>
                    ))}
                    {article.isOpenAccess && <span className="om-chip is-info">开放获取</span>}
                  </div>
                )}
                {expanded[key] && (
                  <div className="literature-abstract">
                    {abstractErrors[key] ? <div role="alert"><p>摘要读取失败：{abstractErrors[key]}</p><button className="secondary" onClick={() => loadAbstract(article)}>重试摘要</button></div> : abstracts[key] ? (
                      abstracts[key].abstract ? (
                        <p>{abstracts[key].abstract.replace(/<[^>]+>/g, "")}</p>
                      ) : (
                        <p className="muted">该文献未提供结构化摘要。</p>
                      )
                    ) : (
                      <p className="muted">正在加载摘要…</p>
                    )}
                  </div>
                )}
                <div className="literature-actions">
                  <button
                    className="secondary"
                    onClick={() => importAsMaterial(article)}
                    disabled={imported[key] || importing[key]}
                  >
                    {imported[key] ? <Check size={14} /> : <FilePlus size={14} />}
                    {importing[key] ? "正在导入…" : imported[key] ? "已导入" : "导入为材料"}
                  </button>
                  <button className="secondary" onClick={() => copyCitation(article)}>
                    {copied === key ? <Check size={14} /> : <Copy size={14} />}
                    复制引用
                  </button>
                  <a
                    className="icon-link"
                    href={pubmedLink(article)}
                    target="_blank"
                    rel="noreferrer"
                    title={article.pmid ? "在 PubMed 打开" : "打开 DOI 来源"}
                  >
                    <ExternalLink size={14} />
                  </a>
                </div>
              </li>
            );
          })}
          {results && !results.count && (
            <li className="tool-list-empty">没有检索到结果，可尝试更换检索词或文献源。</li>
          )}
        </ul>}
        <p className="tool-footnote">
          证据类型标签由出版类型映射而来，仅为提示，不构成质量结论；「导入为材料」只导入题录与摘要（含 MeSH 主题词），不下载全文。
        </p>
      </section>
    </div>
  );
}
