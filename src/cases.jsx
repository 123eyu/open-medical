import { useEffect, useRef, useState } from "react";
import { api } from "./agent-runtime";
import { useClinicalDraft } from "./clinical-drafts";
import { mutateCase } from "./case-mutation";
import { CuratedCaseSources } from "./curated-case-sources";
import { ChevronDown, ChevronRight, Loader2, Plus, Search, Star, Trash2, UserPlus, X } from "lucide-react";
import "./tools-clarity.css";
import "./cases.css";

// Case library view: browse/search local cases, run similar-case search,
// and snapshot patients into the library for future reference. Curated
// cases (starred + lessons) are the doctor's own experience layer.
export function CasesView() {
  const [cases, setCases] = useState([]);
  const [focusId, setFocusId] = useState(() => new URLSearchParams(window.location.search).get("case") || "");
  const [focused, setFocused] = useState(null), [focusError, setFocusError] = useState("");
  const focusRef = useRef(null), focusGeneration = useRef(0);
  useEffect(() => {
    const restore = () => setFocusId(new URLSearchParams(window.location.search).get("case") || "");
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const [patients, setPatients] = useState([]);
  const [query, setQuery] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [editing, setEditing] = useClinicalDraft("case-library", "editing", null);
  const [actionConflict, setActionConflict] = useState(null);
  const mutationLock = useRef(false);
  const [similarText, setSimilarText] = useState("");
  const [similarDiagnosis, setSimilarDiagnosis] = useState("");
  const [similarMatches, setSimilarMatches] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  const [newCase, setNewCase] = useState({
    patientId: "",
    summary: "",
    diagnosis: "",
    lessons: "",
    tags: "",
  });
  const [expanded, setExpanded] = useState(() => editing ? { [editing.id]: true } : {});
  const [findMode, setFindMode] = useState("keyword");

  const refreshFocused = async (id = focusId, signal) => {
    const generation = ++focusGeneration.current;
    if (!id) return;
    try {
      const item = await api(`/api/cases/${encodeURIComponent(id)}`, { signal });
      if (signal?.aborted || generation !== focusGeneration.current) return;
      setFocused(item); setFocusError(""); setExpanded(value => ({ ...value, [item.id]: true }));
    } catch (err) {
      if (signal?.aborted || generation !== focusGeneration.current) return;
      setFocused(null);
      setFocusError(err.status === 404 || err.code === "NOT_FOUND" ? "此案例已不存在或不可读取。" : `此案例暂不可读取：${err.message}`);
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    setFocused(null); setFocusError("");
    refreshFocused(focusId, controller.signal);
    return () => { controller.abort(); focusGeneration.current++; };
  }, [focusId]);
  useEffect(() => { if (focused?.id === focusId) focusRef.current?.scrollIntoView({ block: "start" }); }, [focused, focusId]);

  const refresh = async () => {
    const [list, people] = await Promise.all([
      api(`/api/cases${starredOnly ? "?starred=1" : ""}`),
      api("/api/patients?summary=1"),
      refreshFocused(),
    ]);
    setCases(list.cases);
    setPatients(people.patients.filter((p) => !p.archived));
  };
  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, [starredOnly]);

  const runSearch = async (event) => {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const value = await api(
        `/api/cases${query ? `?query=${encodeURIComponent(query)}` : ""}`,
      );
      setCases(value.cases);
      await refreshFocused();
      setSimilarMatches(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const runSimilar = async (event) => {
    event?.preventDefault();
    if (!similarText.trim()) return;
    setBusy(true);
    setError("");
    try {
      const value = await api("/api/cases/similar", "POST", {
        caseText: similarText,
        diagnosis: similarDiagnosis || undefined,
        limit: 6,
      });
      setSimilarMatches(value.matches);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const addCase = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/api/cases", "POST", {
        ...(newCase.patientId ? { patientId: newCase.patientId } : {}),
        ...(newCase.patientId
          ? { summary: newCase.summary || undefined }
          : { diagnosis: newCase.diagnosis, summary: newCase.summary || undefined }),
        lessons: newCase.lessons || undefined,
        tags: newCase.tags.split(/[,，、\s]+/).filter(Boolean),
        starred: true,
      });
      setAdding(false);
      setNewCase({ patientId: "", summary: "", diagnosis: "", lessons: "", tags: "" });
      setNotice("病例已收入案例库（精选）。下次遇到相似患者，检索会优先翻出它。");
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const toggleStar = async (item) => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    setError("");
    try {
      await mutateCase(item, "PATCH", { starred: !item.starred });
      await refresh();
    } catch (err) {
      setError(err.message);
      if (err.code === "REVISION_CONFLICT") setActionConflict(item);
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  };
  const saveCuration = async () => {
    if (!editing || editing.conflict || mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    setError("");
    try {
      await mutateCase(editing, "PATCH", {
        lessons: editing.lessons,
        tags: editing.tags.split(/[,，、\s]+/).filter(Boolean),
      });
      setEditing(null);
      await refresh();
    } catch (err) {
      setError(err.message);
      if (err.code === "REVISION_CONFLICT") {
        try {
          const current = await api(`/api/cases/${editing.id}`);
          setEditing({ ...editing, conflict: current });
        } catch (readError) { setError(readError.message); }
      }
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  };
  const removeCase = async (item) => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    setError("");
    try {
      await mutateCase(item, "DELETE");
      if (editing?.id === item.id) setEditing(null);
      if (item.id === focusId) { setFocused(null); setFocusError("此案例已不存在或不可读取。"); }
      await refresh();
    } catch (err) {
      setError(err.message);
      if (err.code === "REVISION_CONFLICT") setActionConflict(item);
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  };

  const genderText = (g) => (g === "male" ? "男" : g === "female" ? "女" : "");
  const starredCount = cases.filter((item) => item.starred).length;
  return (
    <div className="module-view tool-page">
      <section className="module-card cases-view">
        <div className="module-head">
          <div>
            <h1>案例库</h1>
            <p className="module-phase">保存有价值的病例与经验，遇到相似患者时可快速翻出参考。</p>
          </div>
          <div className="tool-head-actions">
            <button className={adding ? "secondary" : "primary"} onClick={() => setAdding((v) => !v)}>
              {adding ? <X size={14} /> : <Plus size={14} />}
              {adding ? "取消" : "收入病例"}
            </button>
          </div>
        </div>
        {focusId && <div className="case-location tool-caution" role="status">
          <span>{focusError || (focused?.id === focusId ? "已定位从病例线索打开的案例。" : "正在读取指定案例…")}</span>
          <button className="om-link" onClick={() => {
            const url = new URL(window.location.href); url.searchParams.delete("case"); window.history.replaceState(window.history.state, "", url); setFocusId("");
          }}>取消定位</button>
        </div>}
        {actionConflict && <div role="alert" className="tool-caution">
          <span>案例已变化，精选或删除未执行。请查看最新内容后重新决定。</span>
          <button className="secondary" onClick={async () => { try { await refresh(); setActionConflict(null); setError(""); } catch (e) { setError(e.message); } }}>查看最新案例</button>
        </div>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && <p className="form-notice">{notice}</p>}

        {adding && (
          <section className="tool-section caselib-add">
            <div className="tool-section-head">
              <div>
                <h3>收入新病例</h3>
                <p>可从患者档案生成快照，或手动填写诊断与摘要。</p>
              </div>
            </div>
            <div className="tool-row">
              <select
                className="grow"
                aria-label="选择来源患者" value={newCase.patientId}
                onChange={(e) =>
                  setNewCase({ ...newCase, patientId: e.target.value })
                }
              >
                <option value="">手动填写（不选患者）</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    从患者快照：{p.name}
                  </option>
                ))}
              </select>
              {!newCase.patientId && (
                <input
                  className="grow"
                  value={newCase.diagnosis}
                  aria-label="主要诊断" placeholder="主要诊断（手动填写时必填）"
                  onChange={(e) =>
                    setNewCase({ ...newCase, diagnosis: e.target.value })
                  }
                />
              )}
            </div>
            <div className="tool-grid caselib-add-fields">
              <textarea
                rows={3}
                value={newCase.summary}
                aria-label="病例摘要" placeholder="病例摘要：病史要点、处理经过与转归（可选）"
                onChange={(e) => setNewCase({ ...newCase, summary: e.target.value })}
              />
              <textarea
                rows={3}
                value={newCase.lessons}
                aria-label="经验教训" placeholder="经验教训：这次最有价值的点、下次遇到类似患者怎么用（可选）"
                onChange={(e) => setNewCase({ ...newCase, lessons: e.target.value })}
              />
              <input
                className="wide"
                value={newCase.tags}
                aria-label="病例标签" placeholder="标签（如：糖尿病、胰岛素方案），逗号分隔（可选）"
                onChange={(e) => setNewCase({ ...newCase, tags: e.target.value })}
              />
            </div>
            <div className="tool-actions">
              <button className="primary" onClick={addCase} disabled={busy || (!newCase.patientId && !newCase.diagnosis.trim())}>
                <UserPlus size={14} /> 收入案例库
              </button>
            </div>
          </section>
        )}

        <section className="tool-section caselib-find">
          <div className="tool-section-head">
            <div className="tool-segment" role="group" aria-label="查找方式">
              <button aria-pressed={findMode === "keyword"} onClick={() => setFindMode("keyword")}>关键词检索</button>
              <button aria-pressed={findMode === "similar"} onClick={() => setFindMode("similar")}>相似病例</button>
            </div>
          </div>
          {findMode === "keyword" ? (
            <form className="tool-row" onSubmit={runSearch}>
              <input
                className="grow"
                value={query}
                aria-label="检索病例" placeholder="诊断、治疗或摘要关键词；留空查看全部"
                onChange={(e) => setQuery(e.target.value)}
              />
              <button className="primary" type="submit" disabled={busy}>
                <Search size={15} /> 检索
              </button>
            </form>
          ) : (
            <form className="tool-row" onSubmit={runSimilar}>
              <input
                className="grow"
                value={similarText}
                aria-label="相似病例描述" placeholder="粘贴当前病例描述（诊断、表现、检验）"
                onChange={(e) => setSimilarText(e.target.value)}
              />
              <input
                style={{ flex: "0 1 180px" }}
                value={similarDiagnosis}
                aria-label="诊断加权（可选）" placeholder="诊断加权（可选）"
                onChange={(e) => setSimilarDiagnosis(e.target.value)}
              />
              <button className="primary" type="submit" disabled={busy || !similarText.trim()}>
                {busy ? <Loader2 className="spin" size={15} /> : <Search size={15} />}
                相似搜索
              </button>
            </form>
          )}

          {similarMatches && (
            <div className="caselib-similar">
              <h3 className="caselib-subhead">相似病例（按匹配度） <span className="om-meta">{similarMatches.length} 份</span></h3>
              <ul className="tool-list">
                {similarMatches.map((match) => (
                  <li key={match.caseId}>
                    <div className="tool-list-title">
                      <b>{match.diagnosis}</b>
                      <span>
                        {[
                          match.age !== null && match.age !== undefined ? `${match.age} 岁` : "",
                          genderText(match.gender),
                          match.outcome,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    {match.summary && <p>{match.summary}</p>}
                    <CuratedCaseSources sources={match.curatedSources} />
                    <div className="caselib-chips">
                      {match.reasons.map((reason) => (
                        <span className="om-chip is-info" key={reason}>
                          {reason}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
                {!similarMatches.length && (
                  <li className="tool-list-empty">没有找到相似病例。</li>
                )}
              </ul>
            </div>
          )}
        </section>

        <section className="tool-section caselib-list-section">
        <div className="tool-section-head">
          <h3 className="guidelines-list-title">
            病例列表 <span className="om-count">{cases.length} 份{!starredOnly && starredCount ? ` · ${starredCount} 份精选` : ""}</span>
          </h3>
          <div className="tool-segment" role="group" aria-label="病例范围">
            <button aria-pressed={!starredOnly} onClick={() => setStarredOnly(false)}>全部</button>
            <button aria-pressed={starredOnly} onClick={() => setStarredOnly(true)}>只看我的精选</button>
          </div>
        </div>
        <ul className="tool-list caselib-list">
          {(focused?.id === focusId ? [focused, ...cases.filter(item => item.id !== focusId)] : cases).map((item) => (
            <li className={`caselib-row${item.id === focusId ? " is-focused" : ""}`} key={item.id} ref={item.id === focusId ? focusRef : null} data-case-id={item.id}>
              <div className="caselib-row-head">
                <button
                  className="caselib-toggle"
                  aria-expanded={Boolean(expanded[item.id])}
                  onClick={() =>
                    setExpanded((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                  }
                >
                  {expanded[item.id] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span className="caselib-title">{item.diagnosis}</span>
                  {item.icd10 && <span className="om-chip">{item.icd10}</span>}
                  {item.starred && <span className="om-chip is-caution"><Star size={12} fill="currentColor" /> 精选</span>}
                </button>
                <span className="caselib-meta">
                  {[
                    item.age !== null && item.age !== undefined ? `${item.age} 岁` : "",
                    genderText(item.gender),
                    item.patientName || "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <div className="caselib-actions">
                  <button
                    className="icon-button"
                    title={item.starred ? "取消精选" : "标记为精选案例"}
                    aria-label={item.starred ? "取消精选" : "标记为精选案例"}
                    aria-pressed={item.starred}
                    disabled={busy || Boolean(actionConflict)}
                    onClick={() => toggleStar(item)}
                  >
                    <Star size={15} fill={item.starred ? "currentColor" : "none"} />
                  </button>
                  <button className="icon-button danger" title="删除病例" aria-label="删除病例" disabled={busy || Boolean(actionConflict)} onClick={() => removeCase(item)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              {!expanded[item.id] && (item.lessons || item.summary || item.outcome) && (
                <p className="caselib-preview">{item.lessons ? <><b>经验：</b>{item.lessons}</> : item.summary || <><b>结局：</b>{item.outcome}</>}</p>
              )}
              {expanded[item.id] && (
                <div className="caselib-detail">
                  {item.summary && <p>{item.summary}</p>}
                  {item.treatments?.length > 0 && (
                    <p>
                      <b>治疗：</b>
                      {item.treatments.join("；")}
                    </p>
                  )}
                  {item.keyLabs?.length > 0 && (
                    <p>
                      <b>关键检验：</b>
                      {item.keyLabs
                        .map((lab) => `${lab.item} ${lab.value}${lab.unit || ""}`)
                        .join("；")}
                    </p>
                  )}
                  {item.outcome && (
                    <p>
                      <b>结局：</b>
                      {item.outcome}
                    </p>
                  )}
                  {item.lessons && (
                    <p>
                      <b>经验教训：</b>
                      {item.lessons}
                    </p>
                  )}
                  {item.tags?.length > 0 && (
                    <p>
                      <b>标签：</b>
                      {item.tags.join("、")}
                    </p>
                  )}
                  {editing?.id === item.id ? (
                    <div className="caselib-edit">
                      {editing.conflict && <div role="alert">
                        <p>案例已被其他操作修改。请对照最新经验与标签，合并后明确核对再保存。</p>
                        <textarea aria-label="服务器最新经验" readOnly value={editing.conflict.lessons || ""} />
                        <p>最新标签：{(editing.conflict.tags || []).join("、") || "无"}；精选：{editing.conflict.starred ? "是" : "否"}</p>
                        <button className="secondary" onClick={() => { setEditing({ ...editing, revision: editing.conflict.revision || 0, conflict: null }); setError(""); }}>已核对最新版本，保留输入继续保存</button>
                      </div>}
                      <textarea
                        rows={2}
                        aria-label="经验教训"
                        disabled={busy}
                        placeholder="这次最有价值的点、下次遇到类似患者怎么用"
                        value={editing.lessons}
                        onChange={(e) =>
                          setEditing({ ...editing, lessons: e.target.value })
                        }
                      />
                      <input
                        aria-label="标签"
                        disabled={busy}
                        placeholder="标签，逗号分隔"
                        value={editing.tags}
                        onChange={(e) =>
                          setEditing({ ...editing, tags: e.target.value })
                        }
                      />
                      <div className="tool-actions">
                        <button className="primary" onClick={saveCuration} disabled={busy || Boolean(editing.conflict)}>
                          保存
                        </button>
                        <button className="secondary" disabled={busy} onClick={() => setEditing(null)}>
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="om-link"
                      disabled={busy || Boolean(editing)}
                      onClick={() =>
                        setEditing({
                          id: item.id,
                          revision: item.revision || 0,
                          lessons: item.lessons || "",
                          tags: (item.tags || []).join("、"),
                        })
                      }
                    >
                      补经验教训 / 标签
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
          {!cases.length && !focused && (
            <li className="tool-list-empty">
              {starredOnly ? "还没有精选案例。展开一份病例，补上经验教训并点星标，它就会在相似患者出现时优先被翻出来。" : "案例库为空。可在患者档案点「收进案例库」，把有价值的病例连同经验一起留下。"}
            </li>
          )}
        </ul>
        </section>
        <p className="tool-footnote">
          相似病例检索为本地确定性匹配（诊断加权 + 术语重合），结果仅作临床参考，不构成诊疗建议。
        </p>
      </section>
    </div>
  );
}
