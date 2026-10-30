import { LearningChanges } from "./learning-loop";
import { useCallback, useEffect, useState } from "react";
import { History, MessageSquarePlus, Sparkles, Undo2 } from "lucide-react";
import { api } from "./agent-runtime";
import "./care.css";

const SOURCE = { chat: "对话中建立", evolution: "采纳进化建议", manual: "手动建立", rollback: "恢复历史版本", import: "外部安装" };
export const EXAMPLES = [
  ["出院小结按我院模板写", "我们医院的出院小结有固定格式，我把模板发给你，帮我建立一个技能，以后生成出院小结都按这个格式，并放到首页快捷任务里。"],
  ["HbA1c 高的糖尿病患者提醒我", "糖尿病患者出现糖化血红蛋白 > 8% 的新结果时，在今日待办提醒我考虑调整方案。先试算给我看。"],
  ["复诊前一天起草提醒消息", "患者复诊前一天，自动起草一条提醒消息（写明时间和事项），我核对后再发。"],
  ["每周一生成术后患者周报", "每周一早上 8 点，把标签为「术后」的患者汇总成一份周报。"],
];
const SKILL_EXAMPLES = [
  ["按医院模板自建技能", EXAMPLES[0][1]],
  ["安装外部技能包", "帮我安装这个技能包：https://github.com/用户名/仓库。先核实仓库内容和许可，再给我预览确认。"],
];
const fmt = (value) => value ? new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
const SETTINGS_TAB_KEY = "omw-settings-tab";
// Lets the agenda open settings on this section.
export function requestSettingsTab(tab) { try { sessionStorage.setItem(SETTINGS_TAB_KEY, tab); } catch { /* storage unavailable */ } }
export function takeSettingsTab() { try { const tab = sessionStorage.getItem(SETTINGS_TAB_KEY); sessionStorage.removeItem(SETTINGS_TAB_KEY); return tab; } catch { return null; } }

// Skills and automation rules share a settings category, with separate views.
export function ExtensionCenter({ onAsk, view = "workbench" }) {
  const [data, setData] = useState(null), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState("");
  const [open, setOpen] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [builtinSkills, setBuiltinSkills] = useState([]);
  useEffect(() => { api("/api/skills").then((v) => setBuiltinSkills(v.skills || [])).catch(() => {}); }, []);
  const load = useCallback(() => api("/api/extensions").then((v) => { setData(v); setError(""); }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const act = async (key, fn, message) => {
    setBusy(key); setError(""); setNotice("");
    try { await fn(); if (message) setNotice(message); await load(); } catch (e) { setError(e.message); } finally { setBusy(""); }
  };
  if (!data) return error ? <p role="alert" className="form-error">{error}</p> : <p role="status">正在读取…</p>;
  const skills = data.extensions.filter((e) => e.kind === "skill"), rules = data.extensions.filter((e) => e.kind === "automation");
  const applied = data.changes.filter((c) => c.status === "applied");
  const notices = <>{error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status" className="form-notice">{notice}</p>}</>;

  const card = (e) => <article key={e.id} className={`ext-card ${e.status}`} aria-label={e.name}>
    <header><b>{e.name}</b><span className={`ext-status ${e.status}`}>{e.status === "active" ? "生效中" : "已停用"}</span><small>第 {e.version} 版 · {SOURCE[e.source?.via] || "手动建立"} · {fmt(e.updatedAt)}</small></header>
    <p>{e.kind === "skill" ? e.description : e.summary}</p>
    {e.origin?.url && <p className="muted">来源：<a href={e.origin.url} target="_blank" rel="noreferrer">{e.origin.url}</a>{e.origin.repo ? ` · ${e.origin.repo}` : ""}</p>}
    {e.kind === "skill" && (e.appliesTo?.length > 0 || e.quickTask) && <p className="muted">{[e.appliesTo?.length && `适用：${e.appliesTo.join("、")}`, e.quickTask && `首页快捷任务「${e.quickTask.title}」`].filter(Boolean).join(" · ")}</p>}
    {e.stats && <p className="muted">已产生 {e.stats.produced} 条{e.stats.produced ? `：完成 ${e.stats.done}、忽略 ${e.stats.dismissed}、待处理 ${e.stats.open}` : ""}{e.stats.lastAt ? ` · 最近 ${fmt(e.stats.lastAt)}` : ""}{e.stats.failures ? ` · 失败 ${e.stats.failures} 次` : ""}</p>}
    <footer className="toolbar-actions">
      {!e.imported && <button className="secondary" onClick={() => onAsk?.(`请帮我修改${e.kind === "skill" ? "技能" : "规则"}「${e.name}」：`, [{ kind: "workbench-extension", label: `${e.kind === "skill" ? "技能" : "规则"}：${e.name}`, scope: { extensionKind: e.kind === "skill" ? "skill" : "automation", extensionId: e.id } }])}><MessageSquarePlus size={14} />在对话中修改</button>}
      <button className="text-button" disabled={Boolean(busy)} onClick={() => act(e.id, () => api(`/api/extensions/${e.id}/status`, "POST", { status: e.status === "active" ? "disabled" : "active" }), e.status === "active" ? `已停用「${e.name}」，随时可以重新启用。` : `已重新启用「${e.name}」。`)}>{e.status === "active" ? "停用" : "启用"}</button>
      {e.kind === "skill" && (confirmDelete === e.id
        ? <span className="toolbar-actions"><button className="text-button" disabled={Boolean(busy)} onClick={() => act(`del-${e.id}`, async () => { await api(`/api/extensions/${e.id}`, "DELETE"); setConfirmDelete(null); }, `已删除「${e.name}」及其历史版本。`)}>确认删除</button><button className="text-button" onClick={() => setConfirmDelete(null)}>再想想</button></span>
        : <button className="text-button" onClick={() => setConfirmDelete(e.id)}>删除</button>)}
      <button className="text-button" onClick={() => open?.id === e.id ? setOpen(null) : api(`/api/extensions/${e.id}`).then(setOpen).catch((x) => setError(x.message))}><History size={14} />历史版本</button>
    </footer>
    {open?.id === e.id && <ol className="ext-versions">{open.versions.map((v) => <li key={v.version}>
      <span>第 {v.version} 版 · {SOURCE[v.source?.via] || ""}{v.source?.reason ? ` · ${v.source.reason}` : ""} · {fmt(v.createdAt)}</span>
      <small>{e.kind === "skill" ? v.spec.body?.slice(0, 120) : v.spec.summary}</small>
      {v.version !== e.version && <button className="text-button" disabled={Boolean(busy)} onClick={() => act(e.id, async () => { setOpen(null); await api(`/api/extensions/${e.id}/rollback`, "POST", { version: v.version }); }, `已恢复到第 ${v.version} 版的内容。`)}>恢复此版本</button>}
    </li>)}</ol>}
  </article>;

  if (view === "skills") return <section className="ext-center" aria-label="技能">
    <h2>技能</h2>
    <p className="muted">在对话中描述医院模板或提供技能仓库地址，核对后启用。技能中的脚本不会执行。</p>
    {notices}
    <div className="ext-block">
      <h3>新建或安装</h3>
      <div className="ext-examples">{SKILL_EXAMPLES.map(([label, prompt]) => <button key={label} className="secondary" onClick={() => onAsk?.(prompt)}>{label}</button>)}</div>
    </div>
    <div className="ext-block">
      <h3>我的技能 <small>{skills.length}</small></h3>
      {skills.length ? skills.map(card) : <p className="muted">还没有技能，可从上方新建或安装。</p>}
    </div>
    <div className="ext-block">
      <h3>内置技能 <small>{builtinSkills.length}</small></h3>
      <p className="muted">随应用内置、始终可用，对话中会按需自动调用；无需安装，也不能删除。</p>
      <ul className="ext-builtin-skills">{builtinSkills.map((s) => <li key={s.id}><b>{s.title || s.name || s.id}</b><details><summary>技能标识</summary><code>{s.id}</code></details><p className="muted">{s.description}</p></li>)}</ul>
    </div>
    <p className="muted">安全规则不会被定制改变：红旗症状提醒、发给患者前的确认、知情同意和引用出处始终有效。</p>
  </section>;

  return <section className="ext-center" aria-label="自动化规则">
    <h2>自动化规则</h2>
    <p className="muted">在对话中建立提醒与自动整理规则，确认后生效。</p>
    {notices}

    {data.suggestions.length > 0 && <div className="ext-block">
      <h3><Sparkles size={16} />进化建议</h3>
      {data.suggestions.map((s) => <article key={s.id} className="ext-suggestion">
        <div><b>{s.title}</b><p className="muted">{s.evidence}</p></div>
        <div className="toolbar-actions">
          <button className="primary" onClick={() => onAsk?.(s.prompt, [{ kind: "workbench-extension", label: `进化建议：${s.title}`, scope: { extensionKind: s.kind === "skill" ? "skill" : "automation", suggestionId: s.id } }])}>在对话中完善</button>
          <button className="text-button" disabled={Boolean(busy)} onClick={() => act(s.id, () => api(`/api/extensions/suggestions/${s.id}`, "POST", { status: "dismissed" }), "已忽略这条建议。")}>不需要</button>
        </div>
      </article>)}
    </div>}

    <div className="ext-block">
      <h3>系统自动做的调整</h3><LearningChanges />
      {applied.map((c) => <p key={c.id} className="ext-change"><span>{fmt(c.createdAt)} · {c.title}{c.detail ? `（${c.detail}）` : ""}</span>
        <button className="text-button" disabled={Boolean(busy)} onClick={() => act(c.id, () => api(`/api/extensions/changes/${c.id}/undo`, "POST", {}), "已撤销，并停止自动调整这一项。")}><Undo2 size={14} />撤销</button></p>)}
    </div>

    <div className="ext-block">
      <h3>新建</h3>
      <p className="muted">在对话里说出你的要求，比如：</p>
      <div className="ext-examples">{EXAMPLES.map(([label, prompt]) => <button key={label} className="secondary" onClick={() => onAsk?.(prompt)}>{label}</button>)}</div>
    </div>

    <div className="ext-block">
      <h3>我的规则 <small>{rules.length}</small></h3>
      {rules.length ? rules.map(card) : <p className="muted">还没有自动化规则。定时提醒、检验阈值提醒、复诊前起草消息、定期汇总都可以做成规则。</p>}
    </div>
    <p className="muted">安全规则不会被定制改变：红旗症状提醒、发给患者前的确认、知情同意和引用出处始终有效。</p>
  </section>;
}
