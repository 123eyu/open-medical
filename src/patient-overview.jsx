import {
  ArrowUpRight,
  Activity,
  CalendarDays,
  ClipboardList,
  Pill,
} from "lucide-react";
import {
  groupDiagnoses,
} from "../shared/diagnoses.mjs";
import "./patient-overview.css";

function OverviewLink({ children, onClick }) {
  return (
    <button className="text-button overview-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={14} aria-hidden="true" />
    </button>
  );
}

export function PatientOverview({ patient, session, groups, onNavigate }) {
  const diagnosisGroups = groupDiagnoses(patient.diagnoses);
  const diagnosisCount = diagnosisGroups.reduce((total, group) => total + group.items.length, 0);
  const visits = [...(patient.visits || [])].sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || "")),
  );
  const labs = groups
    .slice()
    .sort((a, b) =>
      String(b.records.at(-1)?.date || "").localeCompare(
        String(a.records.at(-1)?.date || ""),
      ),
    )
    .slice(0, 3);
  const medications = patient.medications || [];
  const activeMeds = medications.filter((m) => m.status === "active");
  const plan = patient.treatmentPlan;
  const counts = patient.counts || {};
  const pending = [
    ["到期随访", counts.dueFollowups, "followups"],
    ["未处理消息", counts.unprocessedMessages, "messages"],
  ].filter(([, count]) => count > 0);

  return (
    <div className="patient-overview">
      {pending.length > 0 && (
        <aside className="overview-attention" aria-label="待处理事项">
          <h3>需要处理</h3>
          {pending.map(([label, count, tab]) => (
            <button key={tab} onClick={() => onNavigate(tab)}>
              <span>{label}</span>
              <b>{count}</b>
              <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          ))}
        </aside>
      )}

      <div className="patient-overview-grid">
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
                  <h4>{group.label} · {group.items.length} 项</h4>
                  <ul className="overview-diagnosis-list">
                    {group.items.slice(0, 2).map((d, i) => (
                      <li key={i}><strong>{d.name}</strong></li>
                    ))}
                  </ul>
                  {group.items.length > 2 && (
                    <p className="overview-meta">另有 {group.items.length - 2} 项{group.label}记录</p>
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
                <p>
                  {activeMeds
                    .slice(0, 4)
                    .map((m) => [m.name || m.drug || "未命名用药", m.dose, m.frequency].filter(Boolean).join(" · "))
                    .join("、")}
                  {activeMeds.length > 4 ? ` 等 ${activeMeds.length} 项` : ""}
                </p>
              </div>
            ) : (
              <p className="overview-empty">
                {medications.length
                  ? `已保存 ${medications.length} 项用药记录，暂无标记为正在使用的用药。`
                  : "尚无用药记录"}
              </p>
            )}
            {!plan && <p className="overview-meta">尚未建立治疗方案</p>}
          </div>
          <OverviewLink onClick={() => onNavigate("medications")}>
            查看用药记录与预后
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

        <section className="overview-card overview-labs" aria-label="最近检验">
          <header className="overview-card-heading">
            <h3>
              <Activity size={18} aria-hidden="true" />
              最近检验
            </h3>
            <span>{labs.length ? `最近 ${labs.length} 项` : "暂无记录"}</span>
          </header>
          <div className="overview-card-body">
            {labs.length ? (
              <ul className="overview-lab-list">
                {labs.map((g) => {
                  const latest = g.records.at(-1);
                  const latestValues = [
                    ...new Set(
                      g.records
                        .filter((r) => r.date === latest?.date)
                        .map((r) => r.value),
                    ),
                  ];
                  return (
                    <li key={g.key}>
                      <div>
                        <b>{g.item}</b>
                        <small>
                          {latest?.date || "日期未记录"}
                          {g.conflict && " · 含同日不同结果"}
                        </small>
                      </div>
                      <div className="overview-lab-value">
                        <strong>{latestValues.join(" / ")}</strong>
                        <small>{g.unit || "单位未记录"}</small>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="overview-empty">
                补充检验资料后，在这里查看最近结果。
              </p>
            )}
          </div>
          <OverviewLink onClick={() => onNavigate("labs")}>
            查看全部检验与趋势
          </OverviewLink>
        </section>
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
