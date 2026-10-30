import { useEffect, useState } from "react";
import { api } from "../../../src/agent-runtime";
import "../../../src/tools-clarity.css";
import "./clinical-ref.css";
import { Loader2, Search, Calculator, FlaskConical, FileCode2, ShieldAlert } from "lucide-react";

const TABS = [
  ["scales", "量表计算", Calculator, "评分量表与临床计算器，结果即时给出解读。"],
  ["labs", "检验速查", FlaskConical, "常见检验指标的参考范围与升高、降低的常见原因。"],
  ["codes", "手术编码", FileCode2, "ICD-9-CM-3 常用手术操作编码。"],
  ["adr", "不良反应筛查", ShieldAlert, "按当前用药与可疑表现，提示可能相关的药物不良反应。"],
];

// Clinical quick-reference: scale calculators, lab item interpretations,
// ICD-9-CM-3 procedure lookup, and adverse-reaction screening. All results
// are deterministic local outputs for clinician review.
export function ClinicalRefView() {
  const [tab, setTab] = useState("scales");
  const [initialScale, setInitialScale] = useState("");
  return (
    <div className="module-view tool-page">
      <section className="module-card clinical-ref-view">
        <div className="module-head">
          <div>
            <h1>临床速查</h1>
            <p className="module-phase">{TABS.find(([id]) => id === tab)?.[3]} 均在本机计算，无需模型。</p>
          </div>
        </div>
        <nav className="tool-tabs" aria-label="速查分类">
          {TABS.map(([id, label, Icon]) => (
            <button key={id} aria-pressed={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </nav>
        {tab === "scales" && <ScalesTab initialScale={initialScale} />}
        {tab === "labs" && <LabsTab />}
        {tab === "codes" && <CodesTab />}
        {tab === "adr" && <AdrTab onGoScales={() => { setInitialScale("naranjo"); setTab("scales"); }} />}
      </section>
    </div>
  );
}

function ScalesTab({ initialScale = "" }) {
  const [scales, setScales] = useState([]);
  const [scaleQuery, setScaleQuery] = useState("");
  const [scaleId, setScaleId] = useState(initialScale);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/api/scales")
      .then((value) => setScales(value.scales))
      .catch((err) => setError(err.message));
  }, []);
  useEffect(() => { setResult(null); }, [answers]);
  const scale = scales.find((s) => s.id === scaleId);
  const run = async (event) => {
    event?.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const value = await api(`/api/scales/${scaleId}/calculate`, "POST", { answers });
      setResult(value);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const visibleScales = scales.filter(
    (s) => !scaleQuery || s.name.includes(scaleQuery) || s.category.includes(scaleQuery),
  );
  return (
    <section className="tool-section">
      <div className="tool-section-head">
        <div>
          <h2>量表与计算器</h2>
          <p>{scales.length ? `内置 ${scales.length} 个量表，可按名称或科室筛选。` : "正在读取量表…"}</p>
        </div>
        <button className="om-link" disabled={busy} onClick={() => { setScaleQuery(""); setScaleId("bmi"); setAnswers({ weight: 68, height: 170 }); setResult(null); }}>填入 BMI 示例（68 kg / 170 cm）</button>
      </div>
      <div className="tool-row">
        <input
          aria-label="筛选量表"
          placeholder="按名称或科室筛选"
          value={scaleQuery}
          onChange={(e) => setScaleQuery(e.target.value)}
          style={{ flex: "0 1 240px" }}
        />
        <select className="grow" disabled={busy} aria-label="选择量表" value={scaleId} onChange={(e) => { setScaleId(e.target.value); setAnswers({}); setResult(null); }}>
          <option value="">{scaleQuery ? `选择量表…（匹配 ${visibleScales.length} 个）` : "选择量表…"}</option>
          {visibleScales.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}（{s.category}）
            </option>
          ))}
        </select>
      </div>
      {scale && (
        <form onSubmit={run} className="scale-panel">
          {scale.desc && <p className="om-meta">{scale.desc}</p>}
          <div className="scale-form tool-grid">
            {scale.items.map((item) => (
              <label key={item.key} className="scale-item tool-field">
                <span>{item.label}</span>
                {item.type === "select" ? (
                  <select
                    disabled={busy}
                    value={answers[item.key] || ""}
                    onChange={(e) => setAnswers({ ...answers, [item.key]: e.target.value })}
                  >
                    <option value="">请选择…</option>
                    {item.choices.map((c) => (
                      <option key={c.label} value={c.label}>
                        {c.label}
                        {c.points ? `（${c.points > 0 ? "+" : ""}${c.points}）` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    step="any"
                    min={item.min}
                    max={item.max}
                    disabled={busy}
                    value={answers[item.key] ?? ""}
                    onChange={(e) =>
                      setAnswers({ ...answers, [item.key]: e.target.value === "" ? "" : Number(e.target.value) })
                    }
                  />
                )}
              </label>
            ))}
          </div>
          <div className="tool-actions">
            <button className="primary" onClick={run} disabled={busy || !scaleId}>
              {busy ? <Loader2 className="spin" size={14} /> : <Calculator size={14} />}
              计算
            </button>
          </div>
        </form>
      )}
      {!scale && scales.length > 0 && <p className="tool-list-empty">选择一个量表后填写各项，计算结果和解读会显示在这里。</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="tool-result" role="status">
          <div className="tool-result-headline">
            <span className="tool-result-value">{result.score}</span>
            <span className="tool-result-label">{result.scaleName}</span>
          </div>
          <p>{result.interpretation}</p>
          {result.note && <p className="om-source">{result.note}</p>}
        </div>
      )}
    </section>
  );
}

function LabsTab() {
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (event) => {
    event?.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setError("");
    try {
      const value = await api(`/api/lab-knowledge?q=${encodeURIComponent(query)}`);
      setEntries(value.entries);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="tool-section">
      <div className="tool-section-head">
        <div>
          <h2>检验指标速查</h2>
          <p>覆盖血常规、肝肾功能、电解质、血脂、凝血、心肌、甲状腺、炎症等常见指标。</p>
        </div>
        <button className="om-link" disabled={busy} onClick={() => { setQuery("血钾"); setEntries(null); }}>填入检验示例</button>
      </div>
      <form className="tool-row" onSubmit={run}>
        <input
          className="grow"
          value={query}
          aria-label="检验指标名称或缩写" placeholder="指标名/缩写，如 血钾、WBC、肌钙蛋白"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="primary" type="submit" disabled={busy || !query.trim()}>
          {busy ? <Loader2 className="spin" size={15} /> : <Search size={15} />}
          查询
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}
      {entries && (
        <ul className="tool-list lab-ref-list">
          {entries.map((item) => (
            <li key={item.name}>
              <div className="tool-list-title">
                <b>{item.name}</b>
                <span>{item.category}</span>
              </div>
              <p className="lab-ref-range">参考范围 <strong>{item.ref}</strong> {item.unit}</p>
              <div className="lab-ref-dirs">
                <p><span className="om-chip is-danger">升高 ↑</span>{item.high}</p>
                <p><span className="om-chip is-info">降低 ↓</span>{item.low}</p>
              </div>
            </li>
          ))}
          {!entries.length && <li className="tool-list-empty">内置条目中没有该指标。</li>}
        </ul>
      )}
      <p className="tool-footnote">参考范围因实验室方法与人群而异，以报告单打印范围为准；解读为提示，需结合临床判断。</p>
    </section>
  );
}

function CodesTab() {
  const [query, setQuery] = useState("");
  const [codes, setCodes] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async (event) => {
    event?.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    try {
      const value = await api(`/api/icd9?q=${encodeURIComponent(query)}`);
      setCodes(value.codes);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const [error, setError] = useState("");
  return (
    <section className="tool-section">
      <div className="tool-section-head">
        <div>
          <h2>手术操作编码（ICD-9-CM-3 常用速查）</h2>
          <p>按术式名称或编码查询，结果以本院编码库为准。</p>
        </div>
        <button className="om-link" disabled={busy} onClick={() => { setQuery("胆囊"); setCodes(null); }}>填入手术示例</button>
      </div>
      <form className="tool-row" onSubmit={run}>
        <input
          className="grow"
          value={query}
          aria-label="手术名称或编码" placeholder="术式名或编码，如 胆囊、51.23"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="primary" type="submit" disabled={busy || !query.trim()}>
          {busy ? <Loader2 className="spin" size={15} /> : <Search size={15} />}
          查询
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}
      {codes && (
        <ul className="tool-list code-list">
          {codes.map((item) => (
            <li key={item.code}>
              <div className="tool-list-title code-row">
                <b>{item.name}</b>
                <code>{item.code}</code>
              </div>
            </li>
          ))}
          {!codes.length && <li className="tool-list-empty">常用编码表中没有匹配，请以本院编码库为准。</li>}
        </ul>
      )}
      {codes?.length > 0 && <p className="om-meta code-count">共 {codes.length} 条匹配</p>}
    </section>
  );
}

function AdrTab({ onGoScales }) {
  const [meds, setMeds] = useState("");
  const [findings, setFindings] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (event) => {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const value = await api("/api/adr-assess", "POST", {
        medications: meds.split(/[\n,，;；]/).map((s) => s.trim()).filter(Boolean),
        findings,
      });
      setResult(value);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="tool-section">
      <div className="tool-section-head">
        <div>
          <h2>不良反应筛查</h2>
          <p>输入当前用药与可疑临床表现，按内置药物不良反应知识表匹配。</p>
        </div>
        <button className="om-link" disabled={busy} onClick={() => { setMeds("依那普利"); setFindings("干咳"); setResult(null); }}>填入虚构筛查示例</button>
      </div>
      <div className="tool-grid">
        <label className="tool-field">
          当前用药
          <textarea
            rows={3}
            aria-label="当前用药" value={meds}
            placeholder={"每行一个或逗号分隔，如：\n依那普利, 美托洛尔"}
            onChange={(e) => setMeds(e.target.value)}
          />
        </label>
        <label className="tool-field">
          可疑临床表现
          <textarea
            rows={3}
            aria-label="可疑临床表现" value={findings}
            placeholder="如：干咳、血钾升高、肌痛"
            onChange={(e) => setFindings(e.target.value)}
          />
        </label>
      </div>
      <div className="tool-actions">
        <button className="primary" onClick={run} disabled={busy || !meds.trim() || !findings.trim()}>
          {busy ? <Loader2 className="spin" size={14} /> : <ShieldAlert size={14} />}
          筛查
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {result && (
        <div className={`tool-result ${result.suspected.length ? "" : "is-empty"}`} role="status">
          <div className="tool-result-headline">
            <span className={`tool-result-value ${result.suspected.length ? "is-alert" : ""}`}>{result.suspected.length}</span>
            <span className="tool-result-label">{result.suspected.length ? "项可能相关的不良反应，需医生核实" : "内置知识表中没有匹配到与该表现相关的不良反应"}</span>
          </div>
          {result.suspected.length > 0 && (
            <ul className="tool-list adr-list">
              {result.suspected.map((s, index) => (
                <li key={index}>
                  <div className="tool-list-title"><b>{s.medication}</b><span>{s.drugClass}</span></div>
                  <p>{s.message}</p>
                  {s.monitoring && (
                    <p>
                      <b>建议核查：</b>
                      {s.monitoring.join("、")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {result.drugProfiles.length > 0 && (
            <p className="om-meta">
              <b>用药组已知不良反应：</b>
              {result.drugProfiles
                .map((p) => `${p.drugClass}（${p.knownReactions.join("、")}）`)
                .join("；")}
            </p>
          )}
          <div className="tool-actions">
            <button className="om-link" onClick={onGoScales}>
              用 Naranjo 量表评估因果关系 →
            </button>
          </div>
          {result.note && <p className="om-source">{result.note}</p>}
        </div>
      )}
      <p className="tool-footnote">提示性筛查，不构成因果判定；请结合用药时间线与临床表现核实。</p>
    </section>
  );
}
