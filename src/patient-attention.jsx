import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { api } from "./agent-runtime";
import { requestCareTab } from "./care-inbox";
import { requestTrial } from "./trial-screening";
import { requestSettingsTab } from "./extension-center";
import "./patient-attention.css";

export function PatientAttention(props) {
  // A new patient must never render the previous patient's rows, even before
  // effects run; the keyed queue also cancels its outstanding requests.
  return <AttentionQueue key={props.patient.id} {...props} />;
}

function AttentionQueue({ patient, onNavigate, onOpenWorkspace, onView }) {
  const [data, setData] = useState(null);
  const [pages, setPages] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState("");
  useEffect(() => {
    let live = true;
    setLoading(true); setError("");
    (async () => {
      const items = [];
      let result;
      for (let page = 0; page < pages; page++) {
        result = await api(`/api/doctor/overview?patientId=${encodeURIComponent(patient.id)}&offset=${page * 6}&limit=6`);
        if (!live) return;
        items.push(...result.items);
        if (!result.hasMore) break;
      }
      if (live) setData({ ...result, items });
    })().catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [patient.id, patient.revision, pages, refresh]);

  async function open(item) {
    setOpening(item.id); setError("");
    const action = item.action;
    try {
      if (action.type === "patient") await onNavigate(action.tab || "overview");
      else if (action.type === "task") await onOpenWorkspace(action.sessionId, { tab: action.tab || "materials" });
      else if (action.view) {
        if (action.view === "care") requestCareTab({ tab: action.tab || "alerts", patientId: patient.id, patientName: patient.name });
        if (action.view === "research" && action.trialId) requestTrial(action.trialId);
        if (action.view === "settings" && action.settingsTab) requestSettingsTab(action.settingsTab);
        await onView(action.view);
      }
    } catch (e) { setError(e.message); }
    finally { setOpening(""); }
  }

  return <section className="overview-card patient-attention" aria-label="待处理事项" aria-busy={loading}>
    <header className="overview-card-heading"><h3>需要处理 {data && !error ? `· ${data.total} 项` : ""}</h3><button type="button" className="text-button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>刷新</button></header>
    {error && <p role="alert" className="form-error">待处理事项读取失败：{error}<button type="button" className="text-button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>重试</button></p>}
    {loading && <p role="status">正在读取待处理事项…</p>}
    {!loading && !error && data?.total === 0 && <p className="overview-empty">当前没有待处理的患者事项。</p>}
    <div className="agenda-items">{data?.items.map(item => <button type="button" className="agenda-item" key={item.id} disabled={loading || Boolean(opening)} onClick={() => open(item)}>
      <span className="agenda-content"><b>{item.title}</b><small>{item.detail}</small>{item.at > 0 && <small><time>{new Date(item.at).toLocaleDateString("zh-CN")}</time></small>}</span>
      <span className="agenda-action">{opening === item.id ? "打开中…" : item.action.label}<ArrowUpRight size={14} /></span>
    </button>)}</div>
    {data?.total > 0 && <p className="overview-meta">已展示 {data.items.length} / 共 {data.total} 项{data.hasMore && <button type="button" className="text-button" disabled={loading} onClick={() => setPages(value => value + 1)}>加载更多事项</button>}</p>}
  </section>;
}
