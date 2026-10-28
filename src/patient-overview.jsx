import {
  ArrowUpRight,
  Activity,
  CalendarDays,
  ClipboardList,
  Pill,
} from "lucide-react";
import { diagnosisSources, groupDiagnoses } from "../shared/diagnoses.mjs";
import { dashboardLabSummary } from "../shared/patient-dashboard.mjs";
import "./patient-overview.css";
import { PatientAttention } from "./patient-attention";

function OverviewLink({ children, onClick }) {
  return (
    <button className="text-button overview-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={14} aria-hidden="true" />
    </button>
  );
}

export function PatientOverview({
  patient,
  session,
  groups,
  onNavigate,
  onOpenWorkspace,
  onView,
}) {
  const diagnosisGroups = groupDiagnoses(patient.diagnoses);
  const diagnosisCount = diagnosisGroups.reduce(
    (total, group) => total + group.items.length,
    0,
  );
  const visits = [...(patient.visits || [])].sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || "")),
  );
  const summaries = groups.map(dashboardLabSummary);
  const labs = summaries
    .toSorted((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3);
  const undatedLabs = summaries.reduce(
    (total, group) => total + group.undatedCount,
    0,
  );
  const medications = patient.medications || [];
  const activeMeds = medications.filter((m) => m.status === "active");
  const unknownMeds = medications.filter(
    (m) => !m.status || m.status === "unknown",
  );
  const plan = patient.treatmentPlan;

  return (
    <div className="patient-overview">
      <PatientAttention
        patient={patient}
        onNavigate={onNavigate}
        onOpenWorkspace={onOpenWorkspace}
        onView={onView}
      />

      <div className="patient-overview-grid">
        <div className="overview-column">
          <section
            className="overview-card overview-diagnoses"
            aria-label="诊断摘要"
          >
            <header className="overview-card-heading">
              <h3>
                <ClipboardList size={18} aria-hidden="true" />
                诊断摘要
              </h3>
              <span>已保存 {diagnosisCount} 项</span>
            </header>
            <div className="overview-card-body">
              {diagnosisCount ? (
                diagnosisGroups.map((group) => (
                  <div className="overview-diagnosis-group" key={group.status}>
                    <h4>
                      {group.label} · {group.items.length} 项
                    </h4>
                    <ul className="overview-diagnosis-list">
                      {group.items.slice(0, 2).map((d, i) => (
                        <li key={i}>
                          <strong>{d.name}</strong>
                        </li>
                      ))}
                    </ul>
                    {group.items.length > 2 && (
                      <p className="overview-meta">
                        另有 {group.items.length - 2} 项{group.label}记录
                      </p>
                    )}
                  </div>
                ))
              ) : (
                <p className="overview-empty">
                  尚未登记诊断，可在诊断与病史中补充。
                </p>
              )}
            </div>
            <OverviewLink onClick={() => onNavigate("diagnoses")}>
              查看完整诊断与病史
            </OverviewLink>
          </section>

          <section
            className="overview-card overview-treatment"
            aria-label="当前用药与方案"
          >
            <header className="overview-card-heading">
              <h3>
                <Pill size={18} aria-hidden="true" />
                当前用药与方案
              </h3>
              {plan && (
                <span className="overview-status">
                  {{ active: "进行中", paused: "已暂停", completed: "已完成" }[
                    plan.status
                  ] || "状态未记录"}
                </span>
              )}
            </header>
            <div className="overview-card-body">
              {plan && (
                <div className="overview-plan">
                  <h4>{plan.title || "已保存治疗方案"}</h4>
                  {plan.reviewDate && (
                    <p className="overview-meta">
                      下次复评 <time>{plan.reviewDate}</time>
                    </p>
                  )}
                </div>
              )}
              {activeMeds.length ? (
                <div className="overview-medications">
                  <span className="overview-meta">
                    正在使用 · {activeMeds.length} 项
                  </span>
                  <ul className="overview-medication-list">
                    {activeMeds.slice(0, 4).map((m, i) => (
                      <li key={m.id || i}>
                        <strong>{m.name || m.drug || "未命名用药"}</strong>
                        <dl className="overview-medication-details">
                          <div>
                            <dt>剂量</dt>
                            <dd>{m.dose || "未记录"}</dd>
                          </div>
                          <div>
                            <dt>频次 / 用法</dt>
                            <dd>{m.frequency || "未记录"}</dd>
                          </div>
                        </dl>
                      </li>
                    ))}
                  </ul>
                  {activeMeds.length > 4 && (
                    <p className="overview-meta">
                      另有 {activeMeds.length - 4}{" "}
                      项在用药物，查看完整用药记录。
                    </p>
                  )}
                </div>
              ) : (
                <p className="overview-empty">
                  {medications.length
                    ? `已保存 ${medications.length} 项用药记录，暂无标记为正在使用的用药。`
                    : "尚无用药记录"}
                </p>
              )}
              {unknownMeds.length > 0 && (
                <button
                  className="text-button overview-review-link"
                  disabled={patient.archived}
                  onClick={() => onNavigate("medications", { edit: true })}
                >
                  核对 {unknownMeds.length} 项未记录状态的用药
                  <ArrowUpRight size={14} aria-hidden="true" />
                </button>
              )}
              {!plan && <p className="overview-meta">尚未建立治疗方案</p>}
            </div>
            <OverviewLink onClick={() => onNavigate("medications")}>
              核对用药与资料来源
            </OverviewLink>
          </section>
        </div>
        <div className="overview-column">
          <section
            className="overview-card overview-labs"
            aria-label="最近检验"
          >
            <header className="overview-card-heading">
              <h3>
                <Activity size={18} aria-hidden="true" />
                最近检验
              </h3>
              <span>
                {labs.length
                  ? `展示 ${labs.length} / 共 ${groups.length} 项指标`
                  : "暂无记录"}
              </span>
            </header>
            <div className="overview-card-body">
              {labs.length ? (
                <ul className="overview-lab-list">
                  {labs.map((g) => {
                    return (
                      <li key={g.key}>
                        <div className="overview-lab-main">
                          <div className="overview-lab-identity">
                            <button
                              className="text-button overview-lab-name"
                              aria-label={`核对${g.item} ${g.unit || "单位未记录"}的记录与来源`}
                              onClick={() =>
                                onNavigate("labs", { focusLab: g.key })
                              }
                            >
                              <b>{g.item}</b>
                              <ArrowUpRight size={14} aria-hidden="true" />
                            </button>
                            <small>
                              {g.date || "日期待核对"}
                              {g.conflict && " · 含同日不同结果"}
                            </small>
                          </div>
                          <div className="overview-lab-value">
                            <strong>{g.values.join(" / ")}</strong>
                            <small>{g.unit || "单位未记录"}</small>
                          </div>
                        </div>
                        <details className="overview-lab-evidence">
                          <summary>参考范围与来源</summary>
                          {g.latestRecords.map((record, index) => (
                            <div
                              className="overview-lab-evidence-record"
                              key={index}
                            >
                              {g.latestRecords.length > 1 && (
                                <b>
                                  {record.value ?? "结果未记录"}{" "}
                                  {g.unit || "单位未记录"}
                                </b>
                              )}
                              <dl>
                                <div>
                                  <dt>报告参考范围</dt>
                                  <dd>
                                    {record.referenceRange ||
                                      "未记录，需核对原报告"}
                                  </dd>
                                </div>
                                <div>
                                  <dt>来源</dt>
                                  <dd>
                                    {diagnosisSources(record).join("；") ||
                                      "来源未记录"}
                                  </dd>
                                </div>
                              </dl>
                              {record.note && <p>{record.note}</p>}
                            </div>
                          ))}
                          <button
                            className="text-button"
                            onClick={() =>
                              onNavigate("labs", { focusLab: g.key })
                            }
                          >
                            查看这项的全部记录与原文入口{" "}
                            <ArrowUpRight size={14} aria-hidden="true" />
                          </button>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="overview-empty">
                  补充检验资料后，在这里查看最近结果。
                </p>
              )}
              {undatedLabs > 0 && (
                <p className="overview-meta">
                  有 {undatedLabs} 条检验日期待核对，未用于判断最近日期。
                </p>
              )}
            </div>
            <OverviewLink onClick={() => onNavigate("labs")}>
              查看全部检验与趋势
            </OverviewLink>
          </section>

          <section
            className="overview-card overview-recent"
            aria-label="最近就诊"
          >
            <header className="overview-card-heading">
              <h3>
                <CalendarDays size={18} aria-hidden="true" />
                最近就诊
              </h3>
              <span>{visits.length} 次记录</span>
            </header>
            <div className="overview-card-body">
              {visits[0] ? (
                <div className="overview-visit">
                  <time>{visits[0].date || "日期未记录"}</time>
                  <p>{visits[0].reason || "就诊原因未记录"}</p>
                </div>
              ) : (
                <p className="overview-empty">
                  尚无就诊记录，可在就诊经过中补充。
                </p>
              )}
            </div>
            <OverviewLink onClick={() => onNavigate("visits")}>
              查看就诊经过
            </OverviewLink>
          </section>
        </div>
      </div>

      <nav className="overview-record-links" aria-label="档案内容导航">
        <span>档案资料</span>
        {[
          ["诊断相关记录", diagnosisCount, "diagnoses"],
          ["用药记录", medications.length, "medications"],
          ["就诊记录", visits.length, "visits"],
          ["资料文件", session.files?.length || 0, "library"],
        ].map(([label, count, tab]) => (
          <button key={tab} onClick={() => onNavigate(tab)}>
            {label}
            <b>{count}</b>
            {tab === "library" && <ArrowUpRight size={14} aria-hidden="true" />}
          </button>
        ))}
      </nav>
    </div>
  );
}
