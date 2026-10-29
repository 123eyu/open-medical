import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { api } from "./agent-runtime";
import { requestPluginIntent } from "./plugin-navigation";
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
  const [actionError, setActionError] = useState("");
  const [opening, setOpening] = useState("");
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    (async () => {
      const items = [];
      let result;
      for (let page = 0; page < pages; page++) {
        result = await api(
          `/api/doctor/overview?patientId=${encodeURIComponent(patient.id)}&excludeRiskAlerts=1&offset=${page * 6}&limit=6`,
        );
        if (!live) return;
        items.push(...result.items);
        if (!result.hasMore) break;
      }
      if (live) setData({ ...result, items, receivedAt: Date.now() });
    })()
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [patient.id, patient.revision, pages, refresh]);

  async function open(item) {
    setOpening(item.id);
    setActionError("");
    const action = item.action;
    try {
      if (action.type === "patient") await onNavigate(action.tab || "overview");
      else if (action.type === "task")
        await onOpenWorkspace(action.sessionId, {
          tab: action.tab || "materials",
        });
      else if (action.view) {
        if (action.view === "care")
          requestPluginIntent("followup", "care-tab", {
            tab: action.tab || "alerts",
            patientId: patient.id,
            patientName: patient.name,
          });
        if (action.view === "research" && action.trialId)
          requestTrial(action.trialId);
        if (action.view === "settings" && action.settingsTab)
          requestSettingsTab(action.settingsTab);
        await onView(action.view);
      }
    } catch (e) {
      setActionError(`无法${item.action.label}：${e.message}`);
    } finally {
      setOpening("");
    }
  }

  const critical = data?.items.filter(item => item.severity === "critical") || [];
  const routine = data?.items.filter(item => item.severity !== "critical") || [];
  const routineCount = data ? data.total - data.criticalCount : 0;
  const row = item => <button
    type="button"
    className={`agenda-item${item.severity === "critical" ? " attention-critical" : ""}`}
    key={item.id}
    disabled={Boolean(opening) || loading}
    onClick={() => open(item)}
  >
    <span className="agenda-content"><b>{item.title}</b><small>{item.detail}</small></span>
    <span className="attention-action-group">
      {item.at > 0 && <time>{new Date(item.at).toLocaleDateString("zh-CN")}</time>}
      <span className="agenda-action">{opening === item.id ? "打开中…" : item.action.label}<ArrowUpRight size={14} aria-hidden="true" /></span>
    </span>
  </button>;
  const more = data?.hasMore && <button type="button" className="text-button" disabled={loading} onClick={() => setPages(value => value + 1)}>加载更多事项 · 已显示 {data.items.length} / {data.total}</button>;

  return <section className="overview-card patient-attention" aria-label="待处理事项" aria-busy={loading}>
    {error && <p role="alert" className="form-error">待处理事项读取失败：{error}{data && <span>仍显示上次读取的内容，可能不是最新状态。</span>}<button type="button" className="text-button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>重试</button></p>}
    {actionError && <p role="alert" className="form-error">{actionError}，可重新打开。</p>}
    {loading && <p role="status">{data ? "正在刷新…" : "正在读取患者事项…"}</p>}
    {data?.criticalCount > 0 && <div className="attention-urgent"><h3>优先查看 · {data.criticalCount} 项</h3><div className="agenda-items">{critical.map(row)}</div>{data.criticalCount > critical.length && more}</div>}
    {routineCount > 0 && <details className="attention-routine"><summary>后续事项 <span>{routineCount}</span><small>随访、检验与消息</small></summary><div className="agenda-items">{routine.map(row)}</div>{more}</details>}
    {!loading && !error && data?.total === 0 && <span className="overview-meta">暂无后续事项</span>}
    {data && <div className="attention-refresh"><span className="overview-meta">更新于 <time dateTime={new Date(data.receivedAt).toISOString()}>{new Date(data.receivedAt).toLocaleTimeString("zh-CN", {hour: "2-digit", minute: "2-digit"})}</time></span><button type="button" className="text-button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>刷新</button></div>}
  </section>;
}
