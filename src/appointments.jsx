import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { useClinicalDraft } from "./clinical-drafts";
import { api } from "./agent-runtime";
import "./care.css";

const STATUS = { scheduled: "已预约", attended: "已到诊", missed: "未到诊", cancelled: "已取消" };
const localToday = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

// Return-visit appointments; the day before and the day itself show up in 今日待办.
export function AppointmentsPanel({ patient }) {
  const [data, setData] = useState(null), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [form, setForm] = useClinicalDraft(patient.id, "appointment", null);
  const inFlight = useRef(false);
  // Keep only an opaque submission key across reloads, never clinical text.
  const requestKey = `appointment-request:${patient.id}`;
  const clearRequest = () => { try { sessionStorage.removeItem(requestKey); } catch {} };
  const requestId = () => {
    let id;
    try { id = sessionStorage.getItem(requestKey); } catch {}
    id ||= crypto.randomUUID();
    try { sessionStorage.setItem(requestKey, id); } catch {}
    return id;
  };
  const [draft, setDraft] = useState(null), [draftText, setDraftText] = useState("");
  const [drafts, setDrafts] = useState([]);
  const openDraft = (reply) => { setDraft(reply); setDraftText(reply.text); };
  const load = useCallback(() => api(`/api/patients/${patient.id}/appointments`).then(async value => { setData(value); setDrafts((await api(`/api/care/replies?status=draft&patientId=${patient.id}`)).replies || []); }).catch((e) => setError(e.message)), [patient.id]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn, message) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(""); setNotice("");
    try { await fn(); setNotice(message); setForm(null); await load(); } catch (e) { setError(e.message); } finally { inFlight.current = false; setBusy(false); }
  };
  const today = data?.today || localToday();
  const upcoming = (data?.appointments || []).filter((a) => a.status === "scheduled");
  const past = (data?.appointments || []).filter((a) => a.status !== "scheduled").reverse();
  const draftReminder = (a) => act(async () => {
    const reply = await api("/api/care/replies", "POST", { patientId: patient.id,
      text: `您好，提醒您 ${a.date}${a.time ? ` ${a.time}` : ""} 复诊${a.place ? `（${a.place}）` : ""}${a.reason ? `，主要是${a.reason}` : ""}。如需改期请提前告诉我们。` });
    openDraft(reply);
  }, "已生成复诊提醒草稿，请在下方核对；尚未发送。");
  const update = (a, changes, message) => act(() => api(`/api/appointments/${a.id}`, "PATCH", { expectedRevision: a.revision || 0, ...changes }), message);
  const edit = a => setForm({ ...a, expectedRevision: a.revision || 0, correctionReason: "" });
  const history = a => a.history?.length > 0 && <details><summary>修改记录 · {a.history.length}</summary>{a.history.map((h, i) => <p key={i}>{new Date(h.at).toLocaleString("zh-CN")} · 修改前：{h.date} {h.time} · {STATUS[h.status]} · {h.place || "地点未记录"} · {h.reason}{h.correctionReason ? ` · 更正原因：${h.correctionReason}` : ""}</p>)}</details>;


  return <section className="detail-panel appointments" aria-label="复诊预约">
    <header className="care-tracking-header"><div><h3>复诊预约</h3><p className="muted">登记下次复诊。前一天和当天会出现在今日待办；过了日期没登记结果也会提醒。这里不会自动通知患者。</p></div>
      <button className="primary" disabled={patient.archived || busy} onClick={() => setForm({ date: "", time: "", reason: "", place: "", requestId: requestId() })}><CalendarPlus size={14} /> 预约复诊</button></header>
    {error && <p className="error-text" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    {form && <form className="appointment-form" onSubmit={(e) => { e.preventDefault(); const submission = form.id ? form : { ...form, requestId: form.requestId || requestId() }; setForm(submission); act(async () => { await api(form.id ? `/api/appointments/${form.id}` : `/api/patients/${patient.id}/appointments`, form.id ? "PATCH" : "POST", submission); if (!form.id) clearRequest(); }, form.id ? "预约已更正，修改记录已保留。" : "复诊已预约。"); }}>
      <fieldset disabled={busy || patient.archived}>
      <label>日期<input type="date" required min={form.id ? undefined : today} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
      <label>时间（可选）<input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></label>
      <label>复诊事项<input value={form.reason} maxLength={200} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="如：术后一月复查、调整降压药" /></label>
      <label>地点（可选）<input value={form.place} maxLength={100} onChange={(e) => setForm({ ...form, place: e.target.value })} placeholder="如：周三上午专家门诊" /></label>
      {form.id && <><label>预约状态<select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>更正原因<input required value={form.correctionReason} maxLength={500} onChange={e => setForm({ ...form, correctionReason: e.target.value })} /></label></>}
      <div className="toolbar-actions"><button type="button" className="secondary" onClick={() => { if (!form.id) clearRequest(); setForm(null); }}>取消</button><button className="primary" disabled={busy || !form.date}>保存预约</button></div></fieldset>
    </form>}
    {!data && !error && <p className="muted">正在读取预约…</p>}
    {data && !upcoming.length && !form && <p className="care-empty">还没有待到的复诊。看完诊约好下次时间后在这里登记，系统会按时提醒。</p>}
    {upcoming.map((a) => {
      const due = a.date < today ? "past" : a.date === today ? "today" : null;
      return <article className={`care-tracking-card ${due === "past" ? "overdue" : ""}`} key={a.id} aria-label={`复诊 ${a.date}`}>
        <div className="care-tracking-title"><span className="pill">{due === "past" ? "待登记结果" : due === "today" ? "今天" : STATUS[a.status]}</span><b>{a.date}{a.time ? ` ${a.time}` : ""}</b>{a.place && <small>{a.place}</small>}</div>
        {a.reason && <h4>{a.reason}</h4>}
        <div className="toolbar-actions">
          {a.date <= today && <><button className="secondary" disabled={busy || patient.archived} onClick={() => update(a, { status: "attended" }, "已登记到诊。")}>已到诊</button>
            <button className="secondary" disabled={busy || patient.archived} onClick={() => update(a, { status: "missed" }, "已登记未到诊，可以重新预约。")}>未到诊</button></>}
          {a.date >= today && <button className="text-button" disabled={busy || patient.archived} onClick={() => draftReminder(a)}>起草提醒消息</button>}
          <button className="text-button" disabled={busy || patient.archived} onClick={() => edit(a)}>改期或更正</button>
          <button className="text-button" disabled={busy || patient.archived} onClick={() => { if (window.confirm(`取消 ${a.date} 的复诊预约？`)) update(a, { status: "cancelled" }, "已取消预约。"); }}>取消预约</button>
        </div>{history(a)}
      </article>;
    })}
    {past.length > 0 && <details><summary>历史预约 · {past.length}</summary>{past.map((a) => <article key={a.id} className="care-tracking-card"><p>{a.date} {a.time} · {STATUS[a.status]} · {a.place || "地点未记录"} · {a.reason}{a.note ? ` · ${a.note}` : ""}</p><button className="secondary" disabled={busy || patient.archived} onClick={() => edit(a)}>更正预约结果</button>{history(a)}</article>)}</details>}
    {drafts.length > 0 && <details open={Boolean(draft)}><summary>待核对消息草稿 · {drafts.length}</summary>{drafts.map(reply => <p key={reply.id}>{reply.text}<button className="text-button" onClick={() => openDraft(reply)}>核对此草稿</button></p>)}</details>}
    {draft && <form className="appointment-draft" aria-label="核对提醒草稿" onSubmit={e => { e.preventDefault(); act(async () => { const saved = await api(`/api/care/replies/${draft.id}`, "PUT", { text: draftText }); openDraft(saved); }, "草稿修改已保存，尚未发送。"); }}><h4>核对提醒草稿 · {patient.name}</h4><p className="muted">请核对预约日期、时间与地点；改期后需同步核对先前草稿。尚未发送</p><label>提醒草稿内容<textarea rows={4} required maxLength={2000} value={draftText} onChange={e => setDraftText(e.target.value)} /></label><div className="toolbar-actions"><button className="primary" disabled={busy || patient.archived}>保存草稿修改</button><button type="button" className="secondary" onClick={() => setDraft(null)}>返回预约</button></div></form>}

  </section>;
}

// Lab values added since the doctor last marked them read.
export function NewLabsNotice({ patientId, onOpenLabs }) {
  const [labs, setLabs] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const load = useCallback(() => api(`/api/patients/${patientId}/labs/new`).then((v) => setLabs(v.labs)).catch(() => setLabs([])), [patientId]);
  useEffect(() => { load(); }, [load]);
  if (!labs?.length) return null;
  return <div className="new-labs" role="status" aria-label="待阅检验结果">
    <div><b>待阅检验结果 {labs.length} 项</b><span>{labs.slice(0, 6).map((l) => `${l.item} ${l.value}${l.unit || ""}（${l.date}）`).join("、")}{labs.length > 6 ? " 等" : ""}</span></div>
    {onOpenLabs && <button className="text-button" onClick={onOpenLabs}>看趋势</button>}
    <button className="secondary" disabled={busy} onClick={async () => { setBusy(true); try { await api(`/api/patients/${patientId}/labs/reviewed`, "POST", {}); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } }}>标记已阅</button>
    {error && <p className="error-text">{error}</p>}
  </div>;
}
