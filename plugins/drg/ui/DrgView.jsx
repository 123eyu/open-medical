import { DEMO_DRG, DEMO_DRG_CSV } from "../../../shared/demo-experience.mjs";
import { useEffect, useState } from "react";
import { api } from "../../../src/agent-runtime";
import { AlertTriangle, Calculator, FileSpreadsheet, Loader2, Settings2 } from "lucide-react";
import "../../../src/tools-clarity.css";
import "./drg.css";

const fmt = (value) =>
  typeof value === "number" ? value.toLocaleString("zh-CN") : value == null ? "—" : String(value);

// DRG estimator: single-case grouping, batch CSV analysis, and local
// weight/rate configuration over the bundled (or imported) scheme.
export function DrgView() {
  const [caseForm, setCaseForm] = useState({
    principalDx: "",
    secondaryDx: "",
    procedures: "",
    totalCost: "",
  });
  const [caseResult, setCaseResult] = useState(null);
  const [csvText, setCsvText] = useState("");
  const [batchResult, setBatchResult] = useState(null);
  const [settings, setSettings] = useState(null);
  const [rateInput, setRateInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setCaseResult(null); }, [caseForm]);
  useEffect(() => { setBatchResult(null); }, [csvText]);
  useEffect(() => { setCaseResult(null); setBatchResult(null); }, [settings]);

  const refreshSettings = async () => {
    const value = await api("/api/drg/settings");
    setSettings(value);
    setRateInput(String(value.rate));
    return value;
  };
  useEffect(() => {
    refreshSettings().catch((err) => setError(err.message));
  }, []);

  const run = (action) => {
    setBusy(true);
    setError("");
    return action()
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };
  const splitList = (text) =>
    text
      .split(/[;；|]/)
      .map((item) => item.trim())
      .filter(Boolean);
  const groupCase = () =>
    run(async () => {
      const value = await api("/api/drg/group", "POST", {
        principalDx: caseForm.principalDx,
        secondaryDx: splitList(caseForm.secondaryDx),
        procedures: splitList(caseForm.procedures),
        totalCost: caseForm.totalCost ? Number(caseForm.totalCost) : undefined,
      });
      setCaseResult(value);
    });
  const runBatch = () =>
    run(async () => {
      const value = await api("/api/drg/batch", "POST", { csvText });
      setBatchResult(value);
    });
  const saveRate = () =>
    run(async () => {
      const value = await api("/api/drg/settings", "POST", {
        rate: Number(rateInput),
      });
      setSettings(value);
    });
  const importFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    run(async () => {
      const text = await file.text();
      let weights;
      try {
        weights = JSON.parse(text);
      } catch {
        throw new Error(`「${file.name}」不是有效的 JSON 文件。导入格式须为 {"DRG码": 权重} 对象，如 {"ER15": 0.62}。`);
      }
      const value = await api("/api/drg/import", "POST", { weights });
      setSettings(value);
    });
  };

  return (
    <div className="module-view tool-page">
      <section className="module-card drg-view">
        <div className="module-head">
          <div>
            <h1>DRG 示例测算</h1>
            <p className="module-phase">
              {settings?.schemeVersion || "加载方案…"} · 费率 {fmt(settings?.rate)} 元/权重
            </p>
          </div>
          <div className="tool-head-actions">
            <button className="secondary" disabled={busy} onClick={() => { setCaseForm({ ...DEMO_DRG }); setCsvText(DEMO_DRG_CSV); setError(""); }}>填入示例病例（单例与批量）</button>
          </div>
        </div>
        <p role="note" className="tool-caution"><AlertTriangle size={16} aria-hidden="true" />此页面仅用于演示简化分组，不是完整的本院医保分组器。导入权重也不会补齐分组规则，不能用于实际医保结算。</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <section className="tool-section">
          <div className="tool-section-head">
            <div>
              <h3>
                <Calculator size={16} /> 单例分组
              </h3>
              <p>填写主要诊断即可分组；其他诊断影响并发症分级，填写总费用可对比预估。示例为虚构数据。</p>
            </div>
          </div>
          <div className="drg-form tool-grid">
            <label className="tool-field wide">主要诊断（ICD-10）
              <input disabled={busy}
                value={caseForm.principalDx}
                aria-label="主要诊断" placeholder="如 J18.9 社区获得性肺炎"
                onChange={(e) => setCaseForm({ ...caseForm, principalDx: e.target.value })}
              />
            </label>
            <label className="tool-field">其他诊断
              <input disabled={busy}
                value={caseForm.secondaryDx}
                aria-label="其他诊断" placeholder="多个用 ; 分隔，如 I50.9;E11.9"
                onChange={(e) => setCaseForm({ ...caseForm, secondaryDx: e.target.value })}
              />
            </label>
            <label className="tool-field">手术操作（ICD-9-CM-3）
              <input disabled={busy}
                value={caseForm.procedures}
                aria-label="手术操作" placeholder="多个用 ; 分隔，可留空"
                onChange={(e) => setCaseForm({ ...caseForm, procedures: e.target.value })}
              />
            </label>
            <label className="tool-field">实际总费用（元，可选）
              <input disabled={busy}
                value={caseForm.totalCost}
                inputMode="decimal"
                aria-label="实际总费用（元，可选）" placeholder="如 18000"
                onChange={(e) =>
                  setCaseForm({ ...caseForm, totalCost: e.target.value.replace(/[^\d.]/g, "") })
                }
              />
            </label>
          </div>
          <div className="tool-actions">
            <button className="primary" onClick={groupCase} disabled={busy || !caseForm.principalDx.trim()}>
              {busy ? <Loader2 className="spin" size={14} /> : null}
              分组
            </button>
          </div>
          {caseResult && (
            <div className={`tool-result ${caseResult.drgCode ? "" : "is-empty"}`} role="status">
              {caseResult.drgCode ? (
                <>
                  <div className="tool-result-headline">
                    <span className="tool-result-value">{caseResult.drgCode}</span>
                    <span className="tool-result-label">
                      {caseResult.adrg} · {caseResult.mdc} · {caseResult.complication.label}
                    </span>
                  </div>
                  <dl className="tool-kv">
                    <div><dt>相对权重 RW（{caseResult.rwSource === "imported" ? "导入数据" : "内置示例"}）</dt><dd>{fmt(caseResult.rw)}</dd></div>
                    <div><dt>预估费用</dt><dd>{fmt(caseResult.estimatedCost)} 元</dd></div>
                    {caseResult.actualCost !== undefined && <div><dt>实际费用</dt><dd>{fmt(caseResult.actualCost)} 元</dd></div>}
                    {caseResult.actualCost !== undefined && <div><dt>偏差</dt><dd className={caseResult.costDeviation > 0 ? "drg-over" : ""}>{caseResult.costDeviation > 0 ? "+" : ""}{fmt(caseResult.costDeviation)} 元</dd></div>}
                  </dl>
                </>
              ) : (
                <p>未能分组：{caseResult.ungroupedReason}</p>
              )}
            </div>
          )}
        </section>

        <section className="tool-section">
          <div className="tool-section-head">
            <div>
              <h3>批量分析</h3>
              <p>粘贴 CSV，列为 principal_dx, secondary_dx, procedures, total_cost，列之间用英文逗号分隔，同一列内多个编码用 ; 分隔；输出每例分组与 CMI。</p>
            </div>
          </div>
          <textarea aria-label="批量分组 CSV" disabled={busy}
            className="drg-csv"
            rows={4}
            value={csvText}
            placeholder={"principal_dx,secondary_dx,procedures,total_cost\nJ18.9,I50.9,,\nI20.0,E11.9;I10,36.07,58000"}
            onChange={(e) => setCsvText(e.target.value)}
          />
          <div className="tool-actions">
            <button className="primary" onClick={runBatch} disabled={busy || !csvText.trim()}>
              批量分组并统计 CMI
            </button>
          </div>
          {batchResult && (
            <div className="tool-result" role="status">
              <div className="tool-result-headline">
                <span className="tool-result-value">CMI {fmt(batchResult.cmi)}</span>
                <span className="tool-result-label">共 {batchResult.rows} 例 · 成功分组 {batchResult.grouped} · 未分组 {batchResult.ungrouped}</span>
              </div>
              <dl className="tool-kv">
                <div><dt>预估总额</dt><dd>{fmt(batchResult.totalEstimated)} 元</dd></div>
                {batchResult.totalActual ? <div><dt>实际总额</dt><dd>{fmt(batchResult.totalActual)} 元</dd></div> : null}
              </dl>
              <table className="om-table research-table">
                <thead>
                  <tr>
                    <th>主诊断</th>
                    <th>DRG</th>
                    <th className="num">RW</th>
                    <th className="num">预估费用</th>
                  </tr>
                </thead>
                <tbody>
                  {batchResult.results.map((row, index) => (
                    <tr key={index}>
                      <td>{row.principalDx}</td>
                      <td>{row.drgCode || <span className="om-chip is-caution" title={row.ungroupedReason}>未分组（{row.ungroupedReason?.slice(0, 18)}…）</span>}</td>
                      <td className="num">{fmt(row.rw)}</td>
                      <td className="num">{fmt(row.estimatedCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <details className="tool-section drg-settings-panel om-disclosure">
          <summary><Settings2 size={15} /> 方案与费率设置 · 当前 {fmt(settings?.rate)} 元/权重{settings?.overriddenCodes ? ` · 已导入 ${settings.overriddenCodes} 个病组权重` : ""}</summary>
          <div className="drg-settings">
            <label className="tool-field">费率（元/权重）
              <input disabled={busy}
                value={rateInput}
                inputMode="decimal"
                aria-label="费率（元/权重）"
                onChange={(e) => setRateInput(e.target.value.replace(/[^\d.]/g, ""))}
              />
            </label>
            <button className="secondary" onClick={saveRate} disabled={busy}>
              保存费率
            </button>
            <label className="drg-import secondary">
              <FileSpreadsheet size={14} /> 导入权重（JSON）
              <input type="file" accept=".json" hidden onChange={importFile} />
            </label>
          </div>
        </details>
      </section>
    </div>
  );
}
