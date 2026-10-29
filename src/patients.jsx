import { followupDate } from "../shared/followup-display.mjs";
import { patientPhone, PATIENT_PHONE_HINT } from "../shared/patient-phone.mjs";
import { useClinicalDraft } from "./clinical-drafts";
import { parsePastedMessages } from "../shared/message-import.mjs";
import { messageChannelLabel, messageSpeakerLabel } from "../shared/message-provenance.mjs";
import { CampaignPanel } from "./care-inbox";
import { ChatFollowupsPanel } from "./chat-followups";
import { WeComPanel } from "./wecom-panel";
import { PatientDashboard } from "./patient-dashboard";
import { patientAgeLabel, patientIdentityLabel, patientOptionLabel } from "./patient-labels";
import { FollowupRecords } from "./followup-records";
import { SurveyPanel } from "./followup-surveys-panel";
import { QuestionnaireEditor, emptyQuestionnaire, buildQuestionnaire } from "./questionnaire-editor";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  CalendarClock,
  FolderOpen,
  Inbox,
  Loader2,
  Search,
  Stethoscope,
  UserPlus,
} from "lucide-react";
import { api, PENDING_REFRESH_EVENT } from "./agent-runtime";
import { Modal } from "./components";
import { RiskList } from "./ui";
import { ClinicalAssistance } from "./clinical-assistance";
import { PatientIdentityModal } from "./patient-identity";
import { PatientProposalModal } from "./patient-proposal";
import { PatientIntakeModal } from "./patient-intake";
import { PatientImportModal } from "./patient-import";
import { LabImportModal } from "./lab-import";
import { CareTasksPanel } from "./care-tasks";
import { AppointmentsPanel, NewLabsNotice } from "./appointments";
import { SlotItem, findPatientTab, mergePatientTabs, useSlot } from "./plugin-slots";

const RECORD_TABS = [["overview", "概览"], ["diagnoses", "诊断与病史"], ["medications", "治疗与预后"], ["labs", "检验结果"], ["visits", "就诊经过"], ["library", "资料库"]];
const isRecordTab = tab => RECORD_TABS.some(([id]) => id === tab) || tab === "clinical";

const GENDER = { male: "男", female: "女", unknown: "" };
const fmtDate = followupDate;
// 提案卡明细：渲染结构化字段而非原始 JSON
const proposalDetail = (type, payload = {}) => {
  const parts = [];
  if (payload.name)
    parts.push(
      type === "followup-create"
        ? `计划 ${payload.name}`
        : `姓名 ${payload.name}`,
    );
  if (payload.gender === "male") parts.push("男");
  if (payload.gender === "female") parts.push("女");
  if (payload.birthYear) parts.push(`${payload.birthYear} 年生`);
  if (payload.phone) parts.push(payload.phone);
  if (payload.diagnoses?.length)
    parts.push(
      `诊断 ${payload.diagnoses
        .map((d) => d.name)
        .filter(Boolean)
        .join("、")}`,
    );
  if (payload.diagnosis) parts.push(`诊断 ${payload.diagnosis}`);
  if (payload.medications?.length)
    parts.push(
      `用药 ${payload.medications
        .map((m) => m.name)
        .filter(Boolean)
        .join("、")}`,
    );
  if (payload.allergies?.length)
    parts.push(`过敏 ${payload.allergies.join("、")}`);
  if (payload.labs?.length) parts.push(`检验 ${payload.labs.length} 项待录入`);
  if (payload.visits?.length)
    parts.push(`就诊 ${payload.visits.length} 次待录入`);
  return parts.join(" · ");
};
export { parsePastedMessages };
export function PatientsView({
  config,
  onOpenWorkspace,
  onView,
  onSwitchCurrent,
  onChanged,
  onLocationChange,
  initialPatientId,
  initialTab = "overview",
  initialCreate = false,
  initialImport = false,
}) {
  const panelRoot = useRef(null);
  const listScroll = useRef(window.history.state?.patientListScroll || 0);
  const [patients, setPatients] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listFailed, setListFailed] = useState(false);
  const patientGeneration = useRef(0);
  const [reminders, setReminders] = useState([]);
  const [inbox, setInbox] = useState([]);
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState("overview");
  const pluginTabs = useSlot("patient.tabs");
  const pluginActions = useSlot("patient.actions");
  const activePluginTab = findPatientTab(pluginTabs, tab);
  const [clinicalEditRequest, setClinicalEditRequest] = useState(null);
  useEffect(() => { setClinicalEditRequest(null); }, [detail?.id]);
  // 时间轴「查看原文」跨标签跳转的目标材料：状态放在父级，因为按 tab 切换
  // 会重挂载 PatientDashboard，组件内的 state 活不过那次重挂。
  const [sourceFocus, setSourceFocus] = useState(null);
  const [labFocus, setLabFocus] = useState(null);
  useEffect(() => { if (tab !== "labs") setLabFocus(null); }, [tab]);
  const openRecordTab = (nextTab, opts = {}) => {
    setTab(nextTab);
    setClinicalEditRequest(opts.edit ? { patientId: detail.id, tab: nextTab } : null);
    if ("focusFile" in opts) setSourceFocus(opts.focusFile);
    if (nextTab === "labs") setLabFocus(opts.focusLab ? { patientId: detail.id, key: opts.focusLab } : null);
    if (nextTab === "followups" && opts.patientId === detail?.id && opts.reviewDate) {
      setFollowupSource({ patientId: detail.id, reviewDate: opts.reviewDate, title: opts.title });
      setEditingFollowup(null); setModal("followup");
    }
    if (nextTab === "followups" && opts.focusFollowupId) setFollowupFocus({ id: opts.focusFollowupId, token: Date.now() });
  };
  const [patientLoading, setPatientLoading] = useState(false);
  useEffect(() => { if (detail) onLocationChange?.(detail.id, tab); }, [detail?.id, tab]);
  useEffect(() => {
    if (detail || !listLoading) panelRoot.current?.scrollTo({ top: detail ? 0 : listScroll.current });
  }, [detail?.id, listLoading]);
  const rememberListScroll = () => {
    if (detail || listLoading || patientLoading || new URLSearchParams(window.location.search).has("patient")) return;
    listScroll.current = panelRoot.current?.scrollTop || 0;
    window.history.replaceState({ ...window.history.state, patientListScroll: listScroll.current }, "", window.location.href);
  };
  const [messages, setMessages] = useState([]);
  const [followups, setFollowups] = useState([]);
  const [followupRefresh, setFollowupRefresh] = useState(0);
  const refreshFollowupPanels = () => setFollowupRefresh(value => value + 1);
  const [risks, setRisks] = useState([]);
  const [createProposals, setCreateProposals] = useState([]);
  const [proposalBusy, setProposalBusy] = useState(false);
  const [reviewProposal, setReviewProposal] = useState(null);
  const proposalInFlight = useRef(false);
  const [session, setSession] = useState(null);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("updated");
  const [editingFollowup, setEditingFollowup] = useState(null);
  const [followupSource, setFollowupSource] = useState(null);
  const [followupFocus, setFollowupFocus] = useState(null);
  const [surveyFocus, setSurveyFocus] = useState(null);
  useEffect(() => { setFollowupSource(null); setFollowupFocus(null); setSurveyFocus(null); }, [detail?.id]);
  useEffect(() => {
    if (tab !== "followups" || !followupFocus) return;
    const element = document.getElementById(`followup-${followupFocus.id}`);
    element?.scrollIntoView({ block: "center" }); element?.focus({ preventScroll: true });
  }, [tab, followupFocus, followups]);
  const [patientPage, setPatientPage] = useState(0);
  const [group, setGroup] = useState("");
  const [archiveFilter, setArchiveFilter] = useState("active");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState(initialCreate ? "new-patient" : initialImport ? "import-patients" : null);
  const [consent, setConsent] = useState(false);
  useEffect(() => {
    // 患者级授权开关的初始值取全局默认（默认关闭=每次询问）。
    api("/api/learning/settings")
      .then((prefs) => setConsent(Boolean(prefs.defaultExternalConsent)))
      .catch(() => {});
  }, []);
  const [paste, setPaste] = useState("");
  const groups = [...new Set(patients.flatMap((p) => p.groups || []))].sort();
  const filtered = patients
    .filter((p) => archiveFilter === "archived" ? p.archived : !p.archived)
    .filter((p) => !group || p.groups?.includes(group))
    .filter((p) => [p.name, p.patientNumber, p.id, p.phone, ...(p.tags || []), p.diagnosisSummary]
      .some((value) => String(value || "").toLowerCase().includes(query.trim().toLowerCase())));
  const sortedFiltered = [...filtered].sort((a, b) => {
    if (sortBy === "name") return String(a.name).localeCompare(String(b.name), "zh-Hans-CN");
    if (sortBy === "visit") return String(b.lastVisitAt || "").localeCompare(String(a.lastVisitAt || ""));
    if (sortBy === "followup")
      return (b.counts.dueFollowups || 0) - (a.counts.dueFollowups || 0);
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / 24));
  const visiblePage = Math.min(patientPage, pageCount - 1);
  const refresh = async () => {
    setListLoading(true);
    try {
      const [list, todo, box, pending] = await Promise.all([
        api("/api/patients?summary=1&archived=1"),
        api("/api/reminders"),
        api("/api/inbox"),
        api("/api/pending-actions?status=pending").catch(() => ({ actions: [] })),
      ]);
      setPatients(list.patients);
      setReminders(todo.reminders);
      setInbox(box.messages);
      setCreateProposals(
        (pending.actions || []).filter((a) => a.type === "patient-create"),
      );
      onChanged?.();
      setListFailed(false);
      return list.patients;
    } catch (err) {
      setListFailed(true);
      throw err;
    } finally { setListLoading(false); }
  };
  const openPatient = async (id, nextTab = "overview") => {
    if (!detail) listScroll.current = panelRoot.current?.scrollTop || 0;
    const version = ++patientGeneration.current;
    setError("");
    setNotice("");
    setPatientLoading(true);
    setReviewProposal(null);
    setConsent(false);
    setPaste("");
    try {
      const [one, msgs, jobs, risks] = await Promise.all([
        api(`/api/patients/${encodeURIComponent(id)}`),
        api(`/api/patients/${id}/messages`),
        api(`/api/patients/${id}/followups`),
        api(`/api/risk-alerts?patientId=${id}`),
      ]);
      const work = await api(`/api/sessions/${one.sessionId}`);
      if (version !== patientGeneration.current) return;
      setTab(nextTab);
      onSwitchCurrent?.(id);
      setDetail(one);
      setMessages(msgs.messages);
      setFollowups(jobs.jobs);
      setRisks(risks.alerts);
      setSession(work);
    } finally {
      if (version === patientGeneration.current) setPatientLoading(false);
    }
  };
  const refreshPatient = async () => {
    if (!detail) return;
    await openPatient(detail.id, tab);
    await refresh();
  };
  const resolveProposal = async (proposal, decision) => {
    if (proposalInFlight.current) return;
    proposalInFlight.current = true;
    setProposalBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`/api/pending-actions/${proposal.id}/${decision}`, "POST", {});
      setReviewProposal(null);
      if (detail) await refreshPatient();
      else await refresh();
      setNotice(
        decision === "reject"
          ? "提案已忽略。"
          : proposal.type === "patient-create"
            ? "建档提案已确认，患者已创建。"
            : "提案已确认写入。",
      );
    } catch (err) {
      // A revision conflict leaves the proposal pending and the doctor's edits
      // intact; display the server's recovery instruction instead of dropping it.
      setError(err.message);
    } finally {
      proposalInFlight.current = false;
      setProposalBusy(false);
    }
  };
  useEffect(() => {
    refresh().catch((err) => setError(err.message));
    if (initialPatientId)
      openPatient(initialPatientId, initialTab).catch((err) =>
        setError(err.message),
      );
    return () => { patientGeneration.current++; };
  }, []);
  const digest = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const run = await api(
        `/api/patients/${detail.id}/messages/digest`,
        "POST",
        { externalConsent: true },
      );
      setNotice(
        run.status === "completed"
          ? "消息已整理完成，可在本次任务中查看结果。"
          : `摘要未完成：${run.error || "请查看执行记录"}`,
      );
      await refreshPatient();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setConsent(false);
    }
  };
  const importMessages = async () => {
    const parsed = parsePastedMessages(paste);
    if (!parsed.length) return;
    try {
      const result = await api(`/api/patients/${detail.id}/messages`, "POST", {
        messages: parsed,
      });
      setPaste("");
      await refreshPatient();
      setNotice(`已导入 ${result.stored} 条消息。${result.duplicates ? `跳过 ${result.duplicates} 条重复消息。` : ""}`);
    } catch (err) {
      setError(err.message);
    }
  };
  const assign = async (messageId, patientId) => {
    if (!patientId) return;
    try {
      await api(`/api/inbox/${messageId}/assign`, "POST", { patientId });
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };
  const archive = async () => {
    try {
      await api(`/api/patients/${detail.id}`, "PATCH", {
        expectedRevision: detail.revision,
        archived: !detail.archived,
      });
      await refresh();
      onLocationChange?.();
      setDetail(null);
      setSession(null);
      setNotice(detail.archived ? "患者已恢复到在管列表。" : "患者已归档，可在已归档列表中恢复。");
    } catch (err) {
      setError(err.message);
    }
  };
  const remove = async () => {
    if (
      !window.confirm(
        `确认删除患者「${detail.name}」？\n将同时删除问诊工作台、消息与随访记录，且不可恢复。`,
      )
    )
      return;
    try {
      await api(`/api/patients/${detail.id}`, "DELETE");
      onLocationChange?.();
      setDetail(null);
      setSession(null);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };
  const patientCards = (
    <div className="patient-grid">
      {sortedFiltered.slice(visiblePage * 24, (visiblePage + 1) * 24).map((p) => (
        <button
          className="patient-card"
          disabled={patientLoading}
          key={p.id}
          onClick={() => {
            openPatient(p.id).catch((err) => setError(err.message));
          }}
        >
          <span className="patient-avatar">
            <Stethoscope size={17} />
          </span>
          <span className="patient-line">
            <b>{p.name}</b>
            <small>
              {[GENDER[p.gender], patientIdentityLabel(p)]
                .filter(Boolean)
                .join(" · ") || "未补充基础信息"}
            </small>
            {(p.diagnosisSummary || p.lastVisitAt) && (
              <small className="patient-card-brief">
                {p.diagnosisSummary && <span>诊断：{p.diagnosisSummary}</span>}
                {p.lastVisitAt && (
                  <span>末次就诊 {p.lastVisitAt}</span>
                )}
              </small>
            )}
          </span>
          <span className="patient-counts">
            {p.counts.dueFollowups > 0 && (
              <em className="pill warn">{p.counts.dueFollowups} 项随访到期</em>
            )}
            {p.counts.unprocessedMessages > 0 && (
              <em className="pill warn">
                {p.counts.unprocessedMessages} 条新消息
              </em>
            )}
            {p.counts.pendingReminders > 0 && (
              <em className="pill">{p.counts.pendingReminders} 条提醒</em>
            )}
            {Boolean(p.archived) && <em className="pill">已归档</em>}
          </span>
          {(p.tags || []).length > 0 && (
            <span className="patient-tags">
              {p.tags.slice(0, 4).map((t) => (
                <em key={t}>{t}</em>
              ))}
            </span>
          )}
        </button>
      ))}
      {!filtered.length && !listLoading && !listFailed && (
        <div className="patient-empty-state">
          <Stethoscope size={28} />
          <h3>{query || group ? "没有匹配的患者" : archiveFilter === "archived" ? "暂无已归档患者" : "建立第一份患者档案"}</h3>
          <p>{query || group ? "试试其他姓名、编号或标签，也可以清除筛选查看全部患者。" : archiveFilter === "archived" ? "归档后的患者会保留在这里，随时可以恢复到在管列表。" : "上传病例材料并核对整理结果，或直接填写基本信息。"}</p>
          {query || group ? <button className="secondary" onClick={() => {setQuery(""); setGroup(""); setPatientPage(0);}}>清除筛选</button> : archiveFilter === "archived" ? <button className="secondary" onClick={() => setArchiveFilter("active")}>查看在管患者</button> : <div className="toolbar-actions"><button className="primary" onClick={() => setModal("new-patient")}>上传第一份病例</button><button className="secondary" onClick={() => setModal("manual-patient")}>手动填写基本信息</button></div>}
        </div>
      )}
    </div>
  );
  const activeArea =
    activePluginTab?.area === "communication" ||
    ["messages", "appointments", "followups", "tracking"].includes(tab)
      ? "communication"
      : "record";
  const recordTabs = mergePatientTabs(pluginTabs, {
    area: "record",
    builtin: RECORD_TABS,
  });
  const communicationTabs = mergePatientTabs(pluginTabs, {
    area: "communication",
    builtin: [
      ["messages", `消息记录${detail?.counts?.unprocessedMessages ? ` · ${detail.counts.unprocessedMessages} 待整理` : ""}`, 10],
      ["appointments", "复诊预约", 20],
      ["followups", "随访计划", 30],
      ["tracking", "检查与转诊", 40],
    ],
  });
  const patientSectionTabs =
    activeArea === "communication" ? communicationTabs : recordTabs;
  return (
    <section ref={panelRoot} onScroll={rememberListScroll} id="main" className={`patients-view ${detail ? "has-patient" : ""}`} aria-label="患者档案">
      {!detail && <div className="patients-toolbar">
        <div><h2>患者管理</h2><span className="muted">{patients.filter(p => !p.archived).length} 位在管患者</span></div>
        <div className="toolbar-actions">
          <button className="secondary" onClick={() => setModal("import-labs")}>导入检验结果</button>
          <button className="secondary" onClick={() => setModal("group-suggest")}>生成分组建议</button>
          <button className="secondary" onClick={() => setModal("manual-patient")}>手动建档</button>
          <button className="secondary" onClick={() => setModal("import-patients")}>导入患者表格</button>
          <button className="primary" onClick={() => setModal("new-patient")}><UserPlus size={15}/> 上传资料建档</button>
        </div>
      </div>}
      {listLoading && !detail && <p className="patient-loading" role="status"><Loader2 size={16} className="spin" />正在读取患者列表…</p>}
      {listFailed && <p className="navigation-notice" role="alert">患者列表读取失败，已保留此前读取的数据。<button className="secondary" onClick={() => refresh().then(() => setError("")).catch(err => setError(err.message))}>重新加载患者</button></p>}
      {patientLoading && <p className="patient-loading" role="status"><Loader2 size={16} className="spin" />正在打开患者档案…</p>}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="notice">{notice}</p>}
      {!detail && createProposals.length > 0 && (
        <div className="patient-risk-list" style={{ marginBottom: 14 }}>
          <p className="muted" style={{ fontSize: 12 }}>
            AI 建档提案（从对话材料中识别的新患者，确认后才真正建档）：
          </p>
          {createProposals.map((proposal) => {
            // 不同任务提出的同名/互含姓名提案提示疑似同一患者，避免建出重复档案；
            // 同一任务的重复提案已由服务端取代机制合并，这里兜住跨任务的。
            const name = String(proposal.payload?.name || "").trim();
            const twin = name
              ? createProposals.find(p => p.id !== proposal.id && String(p.payload?.name || "").trim() &&
                  (String(p.payload.name).trim().includes(name) || name.includes(String(p.payload.name).trim())))
              : null;
            return <div className="hub-risk" key={proposal.id}>
              <div className="hub-risk-main">
                <b>{proposal.summary}</b>
                <small>
                  {proposalDetail(proposal.type, proposal.payload) ||
                    (proposal.payload?.note || "").slice(0, 160)}
                </small>
                {twin && <small className="error-text">与「{twin.payload?.name}」的另一份提案疑似同一患者，请核对后只确认一份。</small>}
              </div>
              <div className="hub-risk-actions">
                <button
                  className="text-button"
                  disabled={proposalBusy}
                  onClick={() => resolveProposal(proposal, "confirm")}
                >
                  确认建档
                </button>
                <button
                  className="text-button"
                  disabled={proposalBusy}
                  onClick={() => resolveProposal(proposal, "reject")}
                >
                  忽略
                </button>
              </div>
            </div>;
          })}
        </div>
      )}
      {busy && (
        <p className="notice running">
          <Loader2 className="spin" size={14} /> 执行中
        </p>
      )}
      {!detail && (
        <>
          {reminders.length > 0 && <button className="patient-list-activity" onClick={() => onView("agenda")}><Bell size={15}/>随访事项已汇总到今日待办<span>查看待办 →</span></button>}
          {inbox.length > 0 && (
            <details className="todo-panel patient-inbox"><summary><Inbox size={15} /> 消息归属 · {inbox.length} 条</summary>
              {inbox.map((m) => (
                <div className="todo-row" key={m.id}>
                  <span>
                    <small>
                      {messageChannelLabel(m.channel)} · {fmtDate(m.time)}
                      {m.patientHint ? ` · 线索：${m.patientHint}` : ""}
                    </small>
                    {m.text.slice(0, 80)}
                  </span>
                  <select
                    defaultValue=""
                    onChange={(e) => assign(m.id, e.target.value)}
                    aria-label="认领到患者"
                  >
                    <option value="">认领到…</option>
                    {patients.filter((p) => !p.archived).map((p) => (
                      <option key={p.id} value={p.id}>
                        {patientOptionLabel(p, patients)}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </details>
          )}
          <div className="patients-filter">
            <select aria-label="患者档案状态" title="切换显示在管患者或已归档患者" value={archiveFilter} onChange={(e) => { setArchiveFilter(e.target.value); setPatientPage(0); }}><option value="active">在管患者</option><option value="archived">已归档患者</option></select>
            <select aria-label="排序方式" title="患者列表排序" value={sortBy} onChange={(e) => { setSortBy(e.target.value); setPatientPage(0); }}>
              <option value="updated">最近更新</option>
              <option value="visit">最近就诊</option>
              <option value="followup">随访到期优先</option>
              <option value="name">按姓名</option>
            </select>
            <label className="search">
              <Search size={14} />
              <input
                aria-label="搜索患者"
                placeholder="搜索姓名、编号、电话、标签或诊断"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPatientPage(0); }}
              />
            </label>
            <button
              className={`chip ${group === "" ? "active" : ""}`}
              onClick={() => { setGroup(""); setPatientPage(0); }}
            >
              全部
            </button>
            {groups.map((g) => (
              <button
                key={g}
                className={`chip ${group === g ? "active" : ""}`}
                onClick={() => { setGroup(g); setPatientPage(0); }}
              >
                {g}
              </button>
            ))}
          </div>
          {patientCards}
          {pageCount > 1 && <nav className="patient-pagination" aria-label="患者分页">
            <small>共 {filtered.length} 位 · 第 {visiblePage + 1} / {pageCount} 页</small>
            <button className="secondary" disabled={visiblePage === 0} onClick={() => setPatientPage(visiblePage - 1)}>上一页</button>
            <button className="secondary" disabled={visiblePage + 1 >= pageCount} onClick={() => setPatientPage(visiblePage + 1)}>下一页</button>
          </nav>}
        </>
      )}
      {detail && session && (
        <>
          <div className="patient-mobile-identity" aria-label="当前患者身份"><b>{detail.name}</b><span>{detail.patientNumber || '未编号'}{detail.archived ? ' · 已归档' : ''}</span></div>
          <div className="detail-head">
            <div className="patient-line"><button className="text-button patient-back" onClick={()=>{patientGeneration.current++;setPatientLoading(false);onLocationChange?.();setDetail(null);setSession(null);}}>← 返回列表</button>
              <b>
                {detail.name}
                {detail.archived && "（已归档）"}
              </b>
              <small>
                {[
                  detail.patientNumber || "未编号",
                  GENDER[detail.gender],
                  patientAgeLabel(detail),
                  detail.phone,
                  ...(detail.groups || []),
                ]
                  .filter(Boolean)
                  .join(" · ") || "未补充基础信息"}
              </small>
              {(detail.allergies || []).length > 0 && (
                <em className="pill warn">
                  过敏：
                  {detail.allergies
                    .map((a) =>
                      typeof a === "string"
                        ? a
                        : [a.substance, a.reaction].filter(Boolean).join("（") +
                          (a.reaction ? "）" : ""),
                    )
                    .join("、")}
                </em>
              )}
            </div>
            <div className="toolbar-actions">
              <button
              className="primary"
              disabled={!session}
              title="可先选中病历中的文字，再提问或要求修改"
              onMouseDown={event => event.preventDefault()}
              onClick={() => {
                const selection = window.getSelection();
                const quote = selection && panelRoot.current?.contains(selection.anchorNode) && panelRoot.current?.contains(selection.focusNode) ? selection.toString().trim() : '';
                onOpenWorkspace(detail.sessionId, quote ? { draft: `关于患者记录中的这段内容：\n${quote}\n\n` } : {});
              }}
            >
              <FolderOpen size={15} /> 问 AI
            </button>
              <button className="secondary" onClick={() => setModal("edit-patient")}>编辑信息</button>

              <details className="patient-more"><summary>更多</summary><div>
                <button className="text-button" onClick={archive}>{detail.archived ? "恢复患者" : "归档患者"}</button>
                <button className="text-button danger" onClick={remove}>删除患者档案</button>
                {pluginActions.map((action) => <button key={`${action.pluginId}:${action.id}`} className="text-button" onClick={async () => {
                  try { setError(""); await action.run(detail, api); }
                  catch (err) { setError(err.message); }
                }}>{action.label}</button>)}
              </div></details>
            </div>
          </div>
          {config?.modelConfigured && !activePluginTab && tab === "messages" && (
            <label className="consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              允许把该患者的材料与消息原文发送给所配置的模型服务（评估治疗方案、AI
              总结均需勾选）。
            </label>
          )}
          <nav className="tab-row patient-area-tabs" aria-label="患者工作内容">
            <button className={isRecordTab(tab) || activePluginTab?.area === "record" ? "active" : ""} onClick={() => setTab("overview")}>病历</button>
            <button className={tab === "assistance" ? "active" : ""} onClick={() => setTab("assistance")}>诊疗辅助</button>
            <button className={["messages", "followups", "tracking", "appointments"].includes(tab) || activePluginTab?.area === "communication" ? "active" : ""} onClick={() => setTab("messages")}>沟通与随访</button>
          </nav>
          {tab !== "assistance" && <nav className="tab-row patient-section-tabs" aria-label="患者栏目">
            {patientSectionTabs.map((entry) => {
              const current = tab === entry.key || (tab === "clinical" && entry.id === "diagnoses");
              return <button key={entry.key} aria-current={current ? "page" : undefined} className={current ? "active" : ""} onClick={() => openRecordTab(entry.key)}>{entry.label}</button>;
            })}
          </nav>}
          {activePluginTab && <SlotItem key={`${activePluginTab.pluginId}:${activePluginTab.id}`} contribution={activePluginTab} patient={detail} onChanged={refreshPatient} onNavigate={openRecordTab} />}
          {!activePluginTab && tab === "tracking" && <CareTasksPanel key={detail.id} patient={detail} files={session?.files || []} onChanged={onChanged} onNavigate={openRecordTab} onSession={value => { if (value.id === detail.sessionId) setSession(value); }} />}
          {!activePluginTab && tab === "appointments" && <AppointmentsPanel key={detail.id} patient={detail} />}
          {!activePluginTab && tab === "labs" && <NewLabsNotice key={`${detail.id}-${detail.revision}`} patientId={detail.id} onOpenLabs={null} />}
          {!activePluginTab && isRecordTab(tab) && <div className="detail-panel"><PatientDashboard key={`${detail.id}-${tab}`} patient={detail} session={session} followups={followups} view={tab === "clinical" ? "diagnoses" : tab} focusFile={sourceFocus} focusLab={labFocus?.patientId === detail.id ? labFocus : null} editRequest={clinicalEditRequest} onEditRequestHandled={() => setClinicalEditRequest(null)} onClinical={openRecordTab} onChanged={refreshPatient} onError={setError} onOpenWorkspace={onOpenWorkspace} onView={onView} riskPanel={<RiskList
                alerts={[...risks].sort(
                  (a, b) =>
                    (a.status === "active" ? 0 : 1) -
                      (b.status === "active" ? 0 : 1) ||
                    { critical: 0, warning: 1, info: 2 }[a.severity] -
                      { critical: 0, warning: 1, info: 2 }[b.severity],
                )}
                busy={busy}
                onDraft={(r) =>
                  onOpenWorkspace(session.id, {
                    draft: `请针对风险「${r.title}」生成处理建议草稿：${r.message} 只使用本病例材料内信息并保留来源，结论待医生复核。`,
                  })
                }
                onAck={async (r) => {
                  await api(`/api/risk-alerts/${r.id}/ack`, "POST", {});
                  await refreshPatient();
                }}
                onResolve={async (r, reopen = false) => {
                  await api(
                    `/api/risk-alerts/${r.id}/${reopen ? "reopen" : "resolve"}`,
                    "POST",
                    {},
                  );
                  await refreshPatient();
                }}
              />}/></div>}
          {!activePluginTab && tab === "assistance" && <ClinicalAssistance key={detail.id} patient={detail} onOpenTask={onOpenWorkspace}/>}
          {!activePluginTab && tab === "messages" && (
            <div className="detail-panel">
              <WeComPanel key={detail.id} patientId={detail.id} />
              <div className="digest-row">
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !config?.modelConfigured ||
                    !detail.counts.unprocessedMessages ||
                    !consent
                  }
                  onClick={digest}
                >
                  AI 总结
                </button>
                <small className="muted">
                  {detail.counts.unprocessedMessages
                    ? `现有 ${detail.counts.unprocessedMessages} 条待整理消息。`
                    : "暂无待整理消息。"}{" "}
                  总结保存在任务记录，仅将本次摘要包含的消息标记为已整理。整理不等于已回复或已完成联系；回复草稿单独核对。
                </small>
              </div>
              <ChatFollowupsPanel key={detail.id} patients={[detail]} initialPatientId={detail.id} />
              <label className="paste-box">
                <b>粘贴消息记录</b>
                <small className="muted">
                  直接粘贴聊天记录即可（支持整段文本）；也可以用「时间 | 患者/医生 | 内容」格式逐行粘贴，更精确。
                </small>
                <textarea
                  rows={4}
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder="2026-09-07 09:12 | 患者 | 今天血压 150/95，偶有头晕"
                />
                <button
                  className="secondary"
                  disabled={!paste.trim() || busy}
                  onClick={importMessages}
                >
                  导入到该患者
                </button>
              </label>
              <div className="msg-list">
                {messages.map((m) => (
                  <div className="msg-row" key={m.id}>
                    <span className={`msg-dir ${m.direction}`}>
                      {messageSpeakerLabel(m)}
                    </span>
                    <span>
                      {m.text}
                      <small>
                        {m.timeUnknown ? `时间待核对（原文：${m.rawTime || "未提供"}；导入于 ${fmtDate(m.collectedAt)}）` : fmtDate(m.time)} · {messageChannelLabel(m.channel)}
                        {m.processed ? " · 已整理" : ""}
                        {messageSpeakerLabel(m) === "身份待核对" ? " · 原记录未核实说话人" : ""}
                      </small>
                    </span>
                    {!m.processed && <em className="pill warn">待整理</em>}
                  </div>
                ))}
                {!messages.length && (
                  <p className="muted">
                    还没有消息。可以直接粘贴聊天记录导入；连接微信后，新消息也会自动同步到这里。
                  </p>
                )}
              </div>
            </div>
          )}
          {!activePluginTab && tab === "followups" && (
            <div className="detail-panel patient-followup-workspace">
              <div className="digest-row"><div><h2>随访计划</h2><p className="muted">先处理到期事项，再安排下一次联系。</p></div>
                <button
                  className="primary"
                  onClick={() => { setFollowupSource(null); setEditingFollowup(null); setModal("followup"); }}
                  disabled={detail.archived}
                >
                  <CalendarClock size={14} /> 新建随访计划
                </button>
              </div>
              {/* 四个子页合并为单页滚动，减少一层嵌套；企微自动随访折叠到底部。 */}
              <div>
              <FollowupRecords
                key={detail.id}
                patientId={detail.id}
                refreshKey={followupRefresh}
                onRefresh={refreshFollowupPanels}
                onChanged={refreshPatient}
                onOpenTask={onOpenWorkspace}
                onViewSurvey={target => setSurveyFocus({ ...target, token: Date.now() })}
              />
              </div>
              <div>
              <SurveyPanel
                key={`surveys-${detail.id}`}
                focus={surveyFocus}
                onClearFocus={() => setSurveyFocus(null)}
                patientId={detail.id}
                refreshKey={followupRefresh}
                onRefresh={refreshFollowupPanels}
                onChanged={refreshPatient}
              />
              </div>
              <h3 className="followup-merged-title">提醒计划（{followups.length}）</h3>
              <div><p className="muted">到期后在本机生成提醒；实际联系结果请在「随访待办与记录」登记。</p>
              {followups.map((job) => (
                <div className="followup-card" role="article" aria-label={`提醒计划：${job.name}`} id={`followup-${job.id}`} tabIndex={-1} key={job.id}>
                  <div className="followup-head">
                    <b>{job.name}</b>
                    <span className="badge">{{ active: "计划中", running: "提醒生成中", paused: "已暂停", completed: "提醒已生成" }[job.status] || job.status}</span>
                    {job.questionnaire && <span className="badge">含问卷</span>}
                  </div>
                  <small className="muted">
                    {job.once ? "单次提醒" : `每 ${job.intervalDays} 天`} ·{" "}
                    {job.status === "completed" ? "提醒已触发" : "下次"}{" "}
                    {fmtDate(job.nextDue)}
                    {job.externalConsent
                      ? " · 已授权到期时自动总结新消息"
                      : " · 仅本机提醒，不会发送给患者"}
                    {job.lastError ? ` · 上次错误：${job.lastError}` : ""}
                  </small>
                  {job.source?.kind === "treatment-review" && <p className="muted">来自复评日期 {job.source.reviewDate}{job.source.reviewDate !== detail.treatmentPlan?.reviewDate ? " · 治疗方案复评日期已变更，此提醒仍按原计划执行" : ""}</p>}
                  {job.checklist.length > 0 && (
                    <ul>
                      {job.checklist.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  )}
                  <div className="toolbar-actions">
                    {job.status !== "running" && job.status !== "completed" && (
                      <button
                        className="secondary"
                        onClick={() => { setFollowupSource(null); setEditingFollowup(job); setModal("followup"); }}
                      >
                        编辑
                      </button>
                    )}
                    {job.status !== "running" && job.status !== "completed" && (
                      <button
                        className="secondary"
                        onClick={async () => {
                          try { setError(""); await api(
                            `/api/patients/${detail.id}/followups/${job.id}`,
                            "PATCH",
                            {
                              revision: job.revision,
                              status:
                                job.status === "active" ? "paused" : "active",
                            },
                          );
                          await refreshPatient(); } catch (err) { setError(err.message); }
                        }}
                      >
                        {job.status === "active" ? "暂停" : "恢复"}
                      </button>
                    )}
                    <button
                      className="secondary"
                      onClick={async () => {
                        if (!window.confirm(`删除 ${detail.name} 的「${job.name}」随访计划？`)) return;
                        try { setError(""); await api(
                          `/api/patients/${detail.id}/followups/${job.id}`,
                          "DELETE",
                          { revision: job.revision },
                        );
                        await refreshPatient(); } catch (err) { setError(err.message); }
                      }}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
              {!followups.length && <p className="muted">还没有本机提醒计划。</p>}
              </div>
              <details className="followup-auto-collapsed">
                <summary>自动随访（企业微信发送并收集回复）—— 可选，默认收起</summary>
                <CampaignPanel key={`campaigns-${detail.id}`} patientId={detail.id} />
              </details>
            </div>
          )}
        </>
      )}
      {modal === "new-patient" && <PatientIntakeModal configured={config?.modelConfigured} onClose={() => setModal(null)} onManual={() => setModal("manual-patient")} onOpenWorkspace={(id) => { setModal(null); onOpenWorkspace(id); }} onCreated={async (patient) => { setModal(null); await refresh(); await openPatient(patient.id); }} />}
      {modal === "manual-patient" && (
        <NewPatientModal
          existingGroups={groups}
          existingTags={[...new Set(patients.flatMap((x) => x.tags || []))]}
          onClose={() => setModal(null)}
          onCreated={async (patient) => {
            setModal(null);
            await refresh();
            await openPatient(patient.id);
          }}
        />
      )}
      {reviewProposal && detail && <PatientProposalModal patient={detail} proposal={reviewProposal} busy={proposalBusy} error={error} onClose={() => setReviewProposal(null)} onConfirm={() => resolveProposal(reviewProposal, "confirm")} />}
      {modal === "import-patients" && <PatientImportModal onClose={() => setModal(null)} onImported={async (result) => { await refresh(); setModal(null); setNotice(`已导入 ${result.count} 位患者，打开档案即可继续补充病例材料。`); }} onOpenPatient={(id) => { setModal(null); openPatient(id).catch((err) => setError(err.message)); }} />}
      {modal === "import-labs" && <LabImportModal onClose={() => setModal(null)} onImported={async (result) => { await refresh(); setNotice(`已为 ${result.proposals.length} 位患者生成检验提案，请在患者档案查看本次变更并保存。`); }} />}
      {modal === "edit-patient" && detail && <PatientIdentityModal patient={detail} onClose={() => setModal(null)} onSaved={async () => { await refreshPatient(); setModal(null); setNotice("基本信息已保存"); }} />}
      {modal === "followup" && detail && (
        <FollowupModal
          key={`${detail.id}:${editingFollowup?.id || followupSource?.reviewDate || "new"}`}
          source={followupSource?.patientId === detail.id ? followupSource : null}
          existingSourceJob={followupSource && followups.find(job => job.source?.kind === "treatment-review" && job.source.reviewDate === followupSource.reviewDate)}
          onViewExisting={job => { setModal(null); setFollowupFocus({ id: job.id, token: Date.now() }); }}
          patientId={detail.id}
          job={editingFollowup}
          onClose={() => { setModal(null); setEditingFollowup(null); }}
          onCreated={async job => {
            setModal(null); setEditingFollowup(null); setFollowupSource(null);
            await refreshPatient();
            if (job) { setFollowupFocus({ id: job.id, token: Date.now() }); setNotice(job.reused ? "该复评日期已有提醒，已定位现有计划。" : "随访计划已保存。"); }
          }}
        />
      )}
      {modal === "group-suggest" && (
        <GroupSuggestModal
          onClose={() => setModal(null)}
          onProposed={async (message) => {
            setModal(null);
            setNotice(message);
          }}
        />
      )}
    </section>
  );
}
function NewPatientModal({ existingGroups = [], existingTags = [], onClose, onCreated }) {
  const [form, setForm] = useState({
    name: "",
    patientNumber: "",
    confirmDistinctPatient: false,
    gender: "",
    birthYear: "",
    phone: "",
    groups: "",
    tags: "",
  });
  const inFlight = useRef(false);
  const requestId = useRef(crypto.randomUUID());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [matches, setMatches] = useState([]);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const phone = patientPhone(form.phone);
  useEffect(() => {
    let live = true;
    setMatches([]);
    const timer = setTimeout(() => {
      if (form.name.trim()) api(`/api/patients?summary=1&archived=1&q=${encodeURIComponent(form.name.trim())}`)
        .then((value) => { if (live) setMatches(value.patients.filter((p) => p.name === form.name.trim())); })
        .catch((err) => { if (live) setError(err.message); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [form.name]);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value, ...(key === "name" ? { confirmDistinctPatient: false } : {}) });
  const submit = async (e) => {
    e.preventDefault();
    if (inFlight.current) return;
    setPhoneTouched(true);
    if (phone.error) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const patient = await api("/api/patients", "POST", {
        requestId: requestId.current,
        name: form.name,
        patientNumber: form.patientNumber.trim() || undefined,
        confirmDistinctPatient: form.confirmDistinctPatient,
        gender: form.gender || undefined,
        birthYear: form.birthYear ? Number(form.birthYear) : undefined,
        phone: phone.value || undefined,
        groups: form.groups
          ? form.groups
              .split(/[，,]/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        tags: form.tags
          ? form.tags
              .split(/[，,]/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      });
      await onCreated(patient);
    } catch (err) {
      setError(err.message);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  return (
    <Modal title="新建患者" onClose={() => { if (!saving) onClose(); }}>
      <form className="modal-form" onSubmit={submit}>
        <fieldset disabled={saving} className="patient-create-fields">
        <label>
          姓名 *
          <input value={form.name} onChange={set("name")} required autoFocus />
        </label>
        {matches.length > 0 && <section className="identity-matches" aria-label="同名患者核对">
          <b>找到 {matches.length} 位同名患者</b>
          <p>先核对已有档案，避免重复建档。</p>
          {matches.map((patient) => <button key={patient.id} className="secondary" type="button" onClick={() => onCreated(patient)} disabled={saving}>
            {patient.name} · {patient.patientNumber || "未编号"} · {patientAgeLabel(patient) || "出生年未填"} · {patient.phone ? `尾号 ${patient.phone.slice(-4)}` : "电话未填"} · {patient.archived ? "已归档 · 打开并恢复档案" : "打开已有档案"}
          </button>)}
          <label><input type="checkbox" checked={form.confirmDistinctPatient} onChange={(e) => setForm({ ...form, confirmDistinctPatient: e.target.checked })} />已核对，这是另一位同名患者</label>
        </section>}
        <label>患者编号（可选）<input maxLength={40} value={form.patientNumber} onChange={set("patientNumber")} placeholder="院内编号或自己的患者编号" /></label>
        <div className="form-grid">
          <label>
            性别
            <select value={form.gender} onChange={set("gender")}>
              <option value="">未填</option>
              <option value="male">男</option>
              <option value="female">女</option>
            </select>
          </label>
          <label>
            出生年份
            <input
              type="number"
              min="1900"
              max={new Date().getFullYear()}
              value={form.birthYear}
              onChange={(e) => setForm({ ...form, birthYear: e.target.value, ageText: "" })}
            />
          </label>
          <label>
            按年龄估算出生年（岁）
            <input
              type="number"
              min="0"
              max="150"
              value={form.ageText || ""}
              onChange={(e) => {
                const age = e.target.value;
                const year = age
                  ? new Date().getFullYear() - Number(age)
                  : "";
                setForm({
                  ...form,
                  ageText: age,
                  birthYear: year === "" ? "" : year,
                });
              }}
              placeholder="填写年龄，估算出生年"
            />
          </label>
          <label>
            联系电话
            <input type="tel" aria-label="联系电话" autoComplete="tel" maxLength={20} aria-invalid={phoneTouched && !!phone.error} aria-describedby="create-phone-help" value={form.phone} onBlur={() => setPhoneTouched(true)} onChange={set("phone")} />
            <small id="create-phone-help" className={phoneTouched && phone.error ? "error-text" : "muted"}>{phoneTouched && phone.error ? phone.error : PATIENT_PHONE_HINT}</small>
          </label>
        </div>
        {form.ageText !== undefined && form.ageText !== "" && <p className="muted">按{form.ageText}岁估算为{form.birthYear}年，请核对出生年。</p>}
        <label>
          分组（逗号分隔，输入时可参考已有分组）
          <input value={form.groups} onChange={set("groups")} list="existing-group-options" />
        </label>
        <label>
          标签（逗号分隔）
          <input value={form.tags} onChange={set("tags")} list="existing-tag-options" />
        </label>
        <datalist id="existing-group-options">
          {existingGroups.map((g) => <option key={g} value={g} />)}
        </datalist>
        <datalist id="existing-tag-options">
          {existingTags.map((t) => <option key={t} value={t} />)}
        </datalist>
        </fieldset>
        {error && <p className="error-text">{error}</p>}
        <div className="toolbar-actions">
          <button className="primary" disabled={!form.name.trim() || saving || (matches.length > 0 && !form.confirmDistinctPatient)}>
            创建患者档案
          </button>
        </div>
        <small className="muted">
          保存后打开患者档案，可继续补充资料或进入问诊工作台。
        </small>
      </form>
    </Modal>
  );
}
function FollowupModal({ patientId, job, source, existingSourceJob, onViewExisting, onClose, onCreated }) {
  const editing = Boolean(job);
  const toLocal = (iso) => {
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  };
  const defaultDue = () => {
    const date = new Date(Date.now() + 86400000);
    // 提醒默认落在工作时段（次日上午 9 点），避免午夜 00:00 的无效提醒。
    date.setHours(9, 0, 0, 0);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  };
  const [storedDraft, setStoredDraft] = useClinicalDraft(patientId, `followupPlan:${job?.id || (source ? `review:${source.reviewDate}` : "new")}`, null);
  const [initialDraft] = useState(() => ({
    form: (
    editing
      ? {
          name: job.name,
          once: job.once === true,
          intervalDays: job.intervalDays || 14,
          firstDueAt: toLocal(job.nextDue),
          checklist: (job.checklist || []).join("\n"),
          externalConsent: Boolean(job.externalConsent),
        }
      : {
          name: source ? `复评：${source.title || "治疗方案"}`.slice(0, 100) : "常规随访",
          once: Boolean(source),
          intervalDays: 14,
          firstDueAt: source ? `${source.reviewDate}T09:00` : defaultDue(),
          checklist: "",
          externalConsent: false,
        }
    ),
    withSurvey: false,
    questionnaire: emptyQuestionnaire(),
    requestId: crypto.randomUUID(),
    revision: job?.revision,
  }));
  const currentDraft = storedDraft || initialDraft;
  const { form, withSurvey, questionnaire } = currentDraft;
  const setForm = value => setStoredDraft({ ...currentDraft, form: value });
  const setWithSurvey = value => setStoredDraft({ ...currentDraft, withSurvey: value });
  const setQuestionnaire = value => setStoredDraft({ ...currentDraft, questionnaire: value });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const set = (key) => (e) =>
    setForm({
      ...form,
      [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    });
  const submit = async (e) => {
    e.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setStoredDraft(currentDraft);
    setSaving(true);
    setError("");
    try {
    if (dueError) throw new Error(dueError);
    const payload = {
      name: form.name,
      ...(form.once ? {} : { intervalDays: Number(form.intervalDays) }),
      firstDueAt: new Date(form.firstDueAt).toISOString(),
      checklist: form.checklist
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean),
    };
      let saved;
      if (editing) {
        saved = await api(
          `/api/patients/${patientId}/followups/${job.id}`,
          "PATCH",
          { ...payload, revision: currentDraft.revision },
        );
      } else {
        saved = await api(`/api/patients/${patientId}/followups`, "POST", {
          once: form.once === true,
          ...(source ? { source: { kind: "treatment-review", reviewDate: source.reviewDate } } : {}),
          ...payload,
          requestId: currentDraft.requestId,
          externalConsent: form.externalConsent,
          ...(withSurvey
            ? { questionnaire: buildQuestionnaire(questionnaire) }
            : {}),
        });
      }
      setStoredDraft(null);
      await onCreated(saved);
    } catch (err) {
      setError(err.message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  if (existingSourceJob && !editing) return <Modal title="已有复评提醒" onClose={onClose}>
    <p>复评日期 {source.reviewDate} 已有「{existingSourceJob.name}」{existingSourceJob.status === "completed" ? "，提醒已触发" : "的提醒安排"}。如需另一次联系，可返回使用普通新建随访。</p>
    <p>{followupDate(existingSourceJob.nextDue)}</p><button className="primary" onClick={() => onViewExisting(existingSourceJob)}>查看现有计划</button>
  </Modal>;
  const due = Date.parse(form.firstDueAt), latestDue = Date.now() + 366 * 86400000;
  const dueError = !Number.isFinite(due) || due <= Date.now() || (!editing && due > latestDue)
    ? `首次随访须晚于当前时间${!editing ? `，且不晚于 ${followupDate(latestDue)}` : ""}；请核对 ${form.firstDueAt || "未填写的时间"}。` : "";
  return (
    <Modal
      title={editing ? "编辑随访计划" : "新建随访计划"}
      onClose={() => { if (!savingRef.current) onClose(); }}
    >
      <form className="modal-form" onSubmit={submit}>
        <fieldset disabled={saving}>
        {source && <p className="muted">来自已保存复评日期 {source.reviewDate}；09:00 为可修改的工作时段默认值。</p>}
        <label>提醒类型<select aria-label="提醒类型" value={form.once ? "once" : "repeat"} disabled={editing || Boolean(source)} onChange={event => setForm({ ...form, once: event.target.value === "once" })}><option value="once">单次提醒</option><option value="repeat">周期提醒</option></select></label>
        <label>
          计划名称
          <input value={form.name} onChange={set("name")} required autoFocus />
        </label>
        <div className="form-grid">
          {!form.once && <label>
            间隔天数
            <input
              type="number"
              min="1"
              max="3650"
              value={form.intervalDays}
              onChange={set("intervalDays")}
            />
          </label>}
          <label>
            首次随访时间
            <input
              type="datetime-local"
              required
              value={form.firstDueAt}
              onChange={set("firstDueAt")}
            />
          </label>
        </div>
        <label>
          随访要点（每行一条，如：血压记录、用药依从性、不良反应）
          <textarea
            rows={3}
            value={form.checklist}
            onChange={set("checklist")}
          />
        </label>
        {!editing && (
          <label className="consent">
            <input
              type="checkbox"
              checked={form.externalConsent}
              onChange={set("externalConsent")}
            />
            授权本计划到期时，自动把该患者待整理的消息原文发送给当前模型服务生成摘要（仅本次随访计划生效）
          </label>
        )}
        {!editing && (
          <label className="consent">
            <input
              type="checkbox"
              checked={withSurvey}
              onChange={(e) => setWithSurvey(e.target.checked)}
            />
            附带结构化随访问卷（到期生成，患者按题号回复自动计分，越界进今日待办）
          </label>
        )}
        {!editing && withSurvey && (
          <QuestionnaireEditor value={questionnaire} onChange={setQuestionnaire} />
        )}
        {dueError && <p role="alert" className="error-text">{dueError}</p>}
        {error && <p role="alert" className="error-text">{error}</p>}
        <button className="primary" disabled={saving}>
          {editing ? "保存修改" : "创建随访计划"}
        </button>
        <button type="button" className="secondary" onClick={() => { if (window.confirm("放弃本次输入与重试？已经保存的随访计划不会删除，请先核对已有计划。")) { setStoredDraft(null); onClose(); } }}>放弃本次输入与重试</button>
        </fieldset>
      </form>
    </Modal>
  );
}

// 患者分组建议:按结构化诊断(ICD-10/名称)与常用药名确定性派生,
// 生成待确认提案;确认前不改任何档案,确认时逐患者乐观更新并报告冲突。
function GroupSuggestModal({ onClose, onProposed }) {
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState([]);
  const [checked, setChecked] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/api/patients/group-suggestions", "POST", {})
      .then((data) => {
        setSuggestions(data.suggestions || []);
        setChecked(Object.fromEntries((data.suggestions || []).map((s) => [s.patientId, true])));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  const selected = suggestions.filter((s) => checked[s.patientId]);
  const propose = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/api/patients/group-suggestions/propose", "POST", {
        assignments: selected.map((s) => ({ patientId: s.patientId, addTags: s.addTags })),
      });
      window.dispatchEvent(new Event(PENDING_REFRESH_EVENT));
      await onProposed(`已创建分组建议提案（${selected.length} 位患者），请到「待确认」托盘核对后确认执行。`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="生成分组建议" onClose={onClose}>
      <p className="muted">本机按诊断与用药规则生成，不调用模型。核对依据后可创建待确认提案。</p>
      {loading && <p role="status">正在按诊断与用药扫描全部在管患者…</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {!loading && !error && !suggestions.length && <p className="muted">没有可建议的分组：全部患者都没有可推断的诊断依据，或已有对应分组。</p>}
      {!!suggestions.length && (
        <>
          <p className="muted">依据结构化诊断（ICD-10 编码或诊断名称）推断；无诊断命中的患者按常用药给出「待核对」分组。确认前不会修改任何档案。</p>
          <table className="group-suggest-table">
            <thead>
              <tr><th aria-label="选择"></th><th>患者</th><th>建议分组</th><th>依据</th></tr>
            </thead>
            <tbody>
              {suggestions.map((s) => (
                <tr key={s.patientId}>
                  <td><input type="checkbox" checked={Boolean(checked[s.patientId])} onChange={(e) => setChecked({ ...checked, [s.patientId]: e.target.checked })} aria-label={`选择 ${s.name}`} /></td>
                  <td><b>{s.name}</b>{s.currentGroups?.length ? <small className="muted"> 现有：{s.currentGroups.join("、")}</small> : null}</td>
                  <td>{s.addTags.join("、")}</td>
                  <td><small className="muted">{s.matched.map((m) => `${m.name || m.code || "诊断"}→${m.tag}`).join("；")}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="toolbar-actions">
            <button className="primary" disabled={busy || !selected.length} onClick={propose}>{busy ? "创建中…" : `创建提案（${selected.length} 位患者）`}</button>
            <button className="secondary" onClick={onClose}>取消</button>
          </div>
        </>
      )}
    </Modal>
  );
}
