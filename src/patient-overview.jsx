import { ArrowUpRight } from "lucide-react";
import {
  clinicalDiagnoses,
  diagnosisStatus,
  DIAGNOSIS_STATUS_SHORT,
} from "../shared/diagnoses.mjs";
import "./patient-overview.css";

export function PatientOverview({
  patient,
  session,
  groups,
  onNavigate,
}) {
  const diagnoses = clinicalDiagnoses(patient.diagnoses);
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
  const counts = patient.counts || {};
  const plan = patient.treatmentPlan;
  const pending = [
    ["到期随访", counts.dueFollowups, "followups"],
    ["未处理消息", counts.unprocessedMessages, "messages"],
  ].filter(([, count]) => count > 0);
  return (
    <>
      <div className="overview-brief patient-overview-grid">
        <div className="overview-story">
          <section className="overview-diagnoses">
            <h3>诊断摘要 <small>确诊与疑似 · 显示 {diagnoses.length} 项</small></h3>
            {diagnoses.length ? (
              <ul>
                {diagnoses.map((d, i) => (
                  <li key={i}>
                    <span>{typeof d === "string" ? d : d.name}</span>
                    <small>{DIAGNOSIS_STATUS_SHORT[diagnosisStatus(d)]}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p>尚未登记诊断</p>
            )}
            <button
              className="text-button"
              onClick={() => onNavigate("diagnoses")}
            >
              查看完整诊断与病史 <ArrowUpRight size={14} />
            </button>
          </section>
          <section className="overview-recent">
            <h3>近期记录</h3>
            {visits[0] ? (
              <p>
                <time>{visits[0].date || "日期未记录"}</time>
                {visits[0].reason}
              </p>
            ) : (
              <p>尚无就诊记录</p>
            )}
            <button
              className="text-button"
              onClick={() => onNavigate("visits")}
            >
              查看就诊经过 <ArrowUpRight size={14} />
            </button>
          </section>
        </div>
        {pending.length > 0 && <aside className="overview-attention" aria-label="待处理事项">
          <header>
            <h3>需要处理</h3>
            <span>按已记录事项</span>
          </header>
          {pending.length ? (
            <ul>
              {pending.map(([label, count, tab]) => (
                <li key={label}>
                  <button onClick={() => onNavigate(tab)}>
                    <span>{label}</span>
                    <b>
                      {count}
                      <ArrowUpRight size={14} />
                    </b>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>暂无以上类型的待处理事项。</p>
          )}
        </aside>}
        <section className="overview-treatment">
          <h3>当前用药与方案</h3>
          {(() => {
            const meds = patient.medications || [];
            const active = meds.filter((m) => m.status === "active");
            const names = (active.length ? active : meds)
              .map((m) => m.name || m.drug || "")
              .filter(Boolean)
              .slice(0, 4)
              .join(" · ");
            if (!meds.length)
              return <p>暂无用药记录；已保存的方案会显示在这里。</p>;
            return (
              <p>
                {names || "已保存用药记录"}
                {meds.length > 4 ? ` 等 ${meds.length} 条` : ""}
                {plan?.title ? `（方案：${plan.title}）` : ""}
              </p>
            );
          })()}
          {plan && (
            <div className="overview-plan-meta">
              <span>
                {
                  { active: "进行中", paused: "已暂停", completed: "已完成" }[
                    plan.status
                  ]
                }
              </span>
              {plan.reviewDate && <span>下次复评 · {plan.reviewDate}</span>}
            </div>
          )}
          <div className="overview-med-summary">
            {
              (patient.medications || []).filter((m) => m.status === "active")
                .length
            }{" "}
            项用药记录标为正在使用
          </div>
          <button
            className="text-button"
            onClick={() => onNavigate("medications")}
          >
            查看用药记录与预后 <ArrowUpRight size={14} />
          </button>
        </section>
        <section className="overview-labs">
          <h3>最近检验</h3>
          {labs.length ? (
            <ul>
              {labs.map((g) => (
                <li key={g.key}>
                  <div>
                    <b>{g.item}</b>
                    <small>{g.records.at(-1)?.date || "日期未记录"}</small>
                  </div>
                  <span>
                    {g.conflict
                      ? `${g.records.slice(-3).map((r) => r.value).join(" / ")}${g.records.length > 3 ? " 等" : ""} ${g.unit || ""}（同日多值）`
                      : `${g.records.at(-1)?.value} ${g.unit || "单位未记录"}`}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>尚无检验记录</p>
          )}
          <button className="text-button" onClick={() => onNavigate("labs")}>
            查看全部检验与趋势 <ArrowUpRight size={14} />
          </button>
          <small
            className="muted"
            title="风险提示仅覆盖内置规则；检验名称、单位不匹配时不套用阈值，未提示不代表无风险。"
          >
            ⓘ 异常提示范围说明
          </small>
        </section>
      </div>
      <nav className="overview-record-links" aria-label="档案内容导航">
        {[
          ["诊断", diagnoses.length, "diagnoses"],
          ["用药记录", patient.medications?.length || 0, "medications"],
          ["就诊记录", visits.length, "visits"],
          ["资料文件", session.files?.length || 0, "library"],
        ].map(([label, count, tab]) => (
          <button
            className="text-button"
            key={tab}
            onClick={() => onNavigate(tab)}
          >
            {label}
            <b>{count}</b>
          </button>
        ))}
      </nav>
    </>
  );
}
