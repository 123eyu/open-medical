import { useEffect, useRef, useState } from "react";
import { Plus, RotateCw, ArrowRight } from "lucide-react";
import { api } from "./agent-runtime";
import { Modal } from "./components";

const states = { waiting_result: "等待结果", awaiting_review: "待医生核对", awaiting_communication: "待告知患者", completed: "已闭环", cancelled: "已取消" };
const kinds = { test: "检查复查", referral: "转诊", other: "其他" };
const actions = { receive: "登记已收到结果", review: "保存医生核对", complete: "登记告知并结束", cancel: "取消事项", reopen: "重新跟进", reschedule: "调整跟进时间" };
const primary = { waiting_result: "receive", awaiting_review: "review", awaiting_communication: "complete" };
const format = (value) => new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const localTime = (value) => { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

function ResultFile({ sourceFile, patient, onNavigate, onSession }) {
  const [error, setError] = useState(""), [missing, setMissing] = useState(false), [busy, setBusy] = useState(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  if (!sourceFile) return null;
  const open = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const session = await api(`/api/sessions/${patient.sessionId}`);
      if (!active.current) return;
      onSession?.(session);
      if (sourceFile.sessionId !== patient.sessionId || !session.files.some(file => file.id === sourceFile.fileId)) { setMissing(true); return; }
      onNavigate("library", { focusFile: sourceFile.fileId });
    } catch (err) { if (active.current) setError(`资料读取失败：${err.message}`); }
    finally { if (active.current) setBusy(false); }
  };
  return <div className="care-result-file"><small>关联资料：{sourceFile.name}</small> {missing
    ? <><p role="status">原文件不可用，历史来源记录仍保留。</p><button className="text-button" onClick={() => onNavigate("library", { focusFile: null })}>打开资料库</button></>
    : <button className="text-button" disabled={busy} onClick={open}>{busy ? "正在核对资料…" : "查看结果资料"}</button>}
    {error && <p role="alert" className="error-text">{error}</p>}
  </div>;
}

export function CareTasksPanel({ patient, files = [], onChanged, onNavigate, onSession }) {
  const [data, setData] = useState(null), [status, setStatus] = useState("active"), [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    let live = true;
    api(`/api/patients/${patient.id}/care-tasks?status=${status}&offset=${offset}`).then((result) => {
      if (!live) return;
      if (offset && offset >= result.total) { setOffset(Math.max(0, Math.floor((result.total - 1) / 20) * 20)); return; }
      setData(result); setError("");
    }).catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [patient.id, status, offset, refresh]);
  const saved = async () => {
    const result = await api(`/api/patients/${patient.id}/care-tasks?status=${status}&offset=${offset}`);
    if (!active.current) return;
    await onChanged?.();
    if (!active.current) return;
    setData(result); setEditing(null); setRefresh(n => n + 1); setNotice("跟进记录已保存");
  };
  return <section className="detail-panel care-tracking" aria-label="检查与转诊跟进">
    <header className="care-tracking-header"><div><h3>检查与转诊跟进</h3><p className="muted">记下何时跟进，收到结果后核对，再登记告知情况。这里记录实际处理，不会自动发送消息。</p></div>
      <button className="primary" disabled={patient.archived} onClick={() => setEditing({ action: "create" })}><Plus size={14} /> 新增待跟进</button></header>
    <div className="toolbar-actions"><button className={`chip ${status === "active" ? "active" : ""}`} onClick={() => { setStatus("active"); setOffset(0); }}>进行中</button><button className={`chip ${status === "closed" ? "active" : ""}`} onClick={() => { setStatus("closed"); setOffset(0); }}>已结束</button><button className="text-button" onClick={() => setRefresh((n) => n + 1)} aria-label="刷新跟进事项"><RotateCw size={14} /></button></div>
    {error && <p className="error-text" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    {!data && !error && <p className="muted">正在读取跟进事项…</p>}
    {data?.items.map((task) => <article className="care-tracking-card" key={task.id}>
      <div className="care-tracking-title"><span className="pill">{states[task.status]}</span><small>{kinds[task.kind]}</small><span className={task.dueAt < Date.now() && primary[task.status] ? "care-due" : "muted"}>跟进时间 {format(task.dueAt)}</span></div>
      <h4>{task.title}</h4>{task.note && <p>{task.note}</p>}
      {task.resultSource && <p className="muted">结果来源：{task.resultSource}</p>}
      {task.sourceFile && <ResultFile sourceFile={task.sourceFile} patient={patient} onNavigate={onNavigate} onSession={onSession}/>}
      {task.reviewNote && <p>医生核对：{task.reviewNote}</p>}
      {task.nextDueAt && <p className="notice">已安排下次随访：{format(task.nextDueAt)}</p>}
      <div className="toolbar-actions">{primary[task.status] ? <>
        <button className="secondary" disabled={patient.archived} onClick={() => setEditing({ task, action: primary[task.status] })}>{actions[primary[task.status]]}<ArrowRight size={13} /></button>
        <button className="text-button" disabled={patient.archived} onClick={() => setEditing({ task, action: "reschedule" })}>调整时间</button>
        <button className="text-button" disabled={patient.archived} onClick={() => setEditing({ task, action: "cancel" })}>取消事项</button>
      </> : <button className="text-button" disabled={patient.archived} onClick={() => setEditing({ task, action: "reopen" })}>重新跟进</button>}</div>
      <details><summary>处理记录 · {task.history.length}</summary>{task.history.slice().reverse().map((entry, i) => <div className="care-history" key={i}><small>{format(entry.at)} · {entry.action === "created" ? "建立事项" : actions[entry.action]}</small><p>{entry.note || "已建立待跟进事项"}</p>{entry.source && <small>来源：{entry.source}</small>}{entry.sourceFile && <ResultFile sourceFile={entry.sourceFile} patient={patient} onNavigate={onNavigate} onSession={onSession}/>}{entry.communication && <small>{entry.communication === "communicated" ? "已告知患者" : "无需告知，原因见处理记录"}</small>}{entry.dueAt && <small>调整至 {format(entry.dueAt)}</small>}</div>)}</details>
    </article>)}
    {data && !data.total && <p className="care-empty">{status === "active" ? "暂时没有待跟进事项。复查报告还没收到、转诊尚无反馈时，在这里记一笔。" : "已结束的检查和转诊会保留在这里。"}</p>}
    {data && data.total > 20 && <nav className="patient-pagination" aria-label="跟进事项分页"><small>共 {data.total} 项</small><button className="secondary" disabled={!offset} onClick={() => setOffset(offset - 20)}>上一页</button><button className="secondary" disabled={!data.hasMore} onClick={() => setOffset(offset + 20)}>下一页</button></nav>}
    {editing && <CareTaskModal patient={patient} files={files} {...editing} onClose={() => setEditing(null)} onSaved={saved} />}
  </section>;
}

function CareTaskModal({ patient, files, task, action, onClose, onSaved }) {
  const creating = action === "create";
  const [form, setForm] = useState({ title: "", kind: "test", dueAt: localTime(action === "reschedule" ? task.dueAt : Date.now() + 86400000), note: "", source: "", sourceFileId: "", communication: "communicated", nextDueAt: "", nextName: "" });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const inFlight = useRef(false), requestId = useRef(crypto.randomUUID());
  const active = useRef(true), savedTask = useRef(null);
  const [committed, setCommitted] = useState(false);
  const [availableFiles, setAvailableFiles] = useState(files), [filesLoading, setFilesLoading] = useState(action === "receive"), [filesError, setFilesError] = useState("");
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const loadFiles = async () => {
    setFilesLoading(true); setFilesError("");
    try { const session = await api(`/api/sessions/${patient.sessionId}`); if (active.current) setAvailableFiles(session.files); }
    catch (err) { if (active.current) setFilesError(`资料列表读取失败：${err.message}`); }
    finally { if (active.current) setFilesLoading(false); }
  };
  useEffect(() => { if (action === "receive") loadFiles(); }, []);
  const field = (name) => ({ value: form[name], onChange: (e) => setForm((prev) => ({ ...prev, [name]: e.target.value })) });
  const submit = async (event) => {
    event.preventDefault(); if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const values = { ...form, ...(creating || ["reopen", "reschedule"].includes(action) ? { dueAt: new Date(form.dueAt).toISOString() } : {}), ...(form.nextDueAt ? { nextDueAt: new Date(form.nextDueAt).toISOString() } : {}) };
      if (!savedTask.current) {
        savedTask.current = await api(`/api/patients/${patient.id}/care-tasks${creating ? "" : `/${task.id}`}`, creating ? "POST" : "PATCH", { ...values, ...(action === "receive" && form.sourceFileId ? { sourceFile: { fileId: form.sourceFileId } } : {}), requestId: requestId.current, action, expectedRevision: task?.revision });
        if (!active.current) return;
        setCommitted(true);
      }
      if (active.current) await onSaved();
    } catch (err) { if (active.current) setError(savedTask.current ? `记录已保存，但列表刷新失败：${err.message}。输入已保留，可重试刷新。` : err.message); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  return <Modal title={creating ? "新增待跟进" : actions[action]} onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={submit} className="care-task-form"><p className="muted">{patient.name}{task ? ` · ${task.title}` : " · 记录需要接着处理的事"}</p><fieldset disabled={busy || committed}>
      {creating && <><label htmlFor="care-kind">跟进类型</label><select id="care-kind" {...field("kind")}>{Object.entries(kinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><label>跟进内容<input required maxLength={100} placeholder="例如：复查报告返回后核对" {...field("title")} /></label></>}
      {(creating || ["reschedule", "reopen"].includes(action)) && <label>跟进时间<input type="datetime-local" required {...field("dueAt")} /></label>}
      {action === "receive" && <>
        <label htmlFor="care-source-file">选择本患者资料（可选）</label>
        <select id="care-source-file" value={form.sourceFileId} disabled={filesLoading || !!filesError} onChange={event => { const file = availableFiles.find(item => item.id === event.target.value); setForm(prev => ({ ...prev, sourceFileId: event.target.value, ...(file ? { source: file.name } : {}) })); }}>
          <option value="">不关联附件（纸质或院外来源）</option>
          {availableFiles.map(file => <option key={file.id} value={file.id}>{file.name} · {file.documentDate || "日期未记录"} · {file.size ?? file.bytes ?? "大小未记录"}{typeof (file.size ?? file.bytes) === "number" ? " 字节" : ""} · {file.id.slice(0, 8)}</option>)}
        </select>
        {filesLoading && <p role="status">正在读取患者资料…</p>}{filesError && <p role="alert">{filesError} <button type="button" onClick={loadFiles}>重试读取资料</button></p>}
        <label htmlFor="care-source">结果来源（必填）</label><input id="care-source" required maxLength={500} placeholder="例如：9 月 22 日患者上传的复查报告" {...field("source")} />
        <p className="muted">附件关联只记录来源，收到结果后仍需医生核对。</p>
      </>}
      {action === "complete" && <><label htmlFor="care-communication">告知情况</label><select id="care-communication" {...field("communication")}><option value="communicated">已告知患者</option><option value="not_required">无需告知（请说明原因）</option></select></>}
      <label>{creating ? "跟进说明（可选）" : "处理记录（必填）"}<textarea required={!creating} maxLength={2000} rows={4} placeholder={action === "review" ? "记录已核对的内容和下一步安排" : action === "complete" ? "记录告知方式、内容和后续安排；无需告知时写明原因" : action === "cancel" ? "说明取消原因，原始记录仍会保留" : "简要记录实际情况"} {...field("note")} /></label>
      {action === "complete" && <><label>下次随访时间（可选）<input type="datetime-local" {...field("nextDueAt")} /></label>{form.nextDueAt && <label>下次随访名称<input maxLength={100} placeholder={task.title} {...field("nextName")} /></label>}</>}
    </fieldset>{error && <p role="alert" className="error-text">{error}</p>}<div className="modal-actions"><button type="button" className="secondary" disabled={busy} onClick={onClose}>返回</button><button className="primary" type="submit" disabled={busy}>{busy ? "保存中…" : committed ? "重试刷新列表" : creating ? "保存跟进事项" : actions[action]}</button></div></form>
  </Modal>;
}
