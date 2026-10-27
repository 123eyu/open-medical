import { useEffect, useRef, useState } from "react";
import { api } from "./agent-runtime";
import { Modal } from "./components";
import { Download, FileText, Loader2 } from "lucide-react";
import { SHARE_SECTIONS, FINDING_LABELS, REDACT_MARK, buildShareSections } from "../shared/share-report.mjs";
import "./share-wizard.css";

// The preview record is the only input to either local export format.
export function ShareWizard(props) {
  return <PatientShareWizard key={props.patientId} {...props}/>;
}
function PatientShareWizard({ patientId, patientName, onClose }) {
  const active = useRef(false), inFlight = useRef(false), nativeSave = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [error, setError] = useState("");
  const close = () => { if (!nativeSave.current) { active.current = false; onClose(); } };
  const [step, setStep] = useState(1);
  const [sections, setSections] = useState(() => new Set(SHARE_SECTIONS.map(([key]) => key)));
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const toggleSection = (key) => {
    setSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const runPreview = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = await api(`/api/patients/${patientId}/share`, "POST", { sections: [...sections] });
      if (!active.current) return;
      setPreview(result);
      setStep(2);
    } catch (err) {
      if (active.current) setError(err.message);
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  };
  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(preview.record, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${preview.record.pseudoId}-脱敏.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("已发起 JSON 下载，内容与当前预览一致；保存位置以浏览器设置为准。");
  };
  const shareReport = () => ({
    title: "脱敏病历摘要",
    subtitle: `${preview.record.pseudoId} · ${preview.record.gender === "male" ? "男" : preview.record.gender === "female" ? "女" : "性别未登记"} · ${preview.record.ageBand ? `${preview.record.ageBand} 岁` : "年龄未登记"}`,
    sections: buildShareSections(preview.record).filter((section) => section.rows.length),
    note: preview.record.note,
    footer: `生成时间：${new Date(preview.record.exportedAt).toLocaleString("zh-CN")}`,
    fileName: `${preview.record.pseudoId}-脱敏病历`,
  });
  const exportPdf = async () => {
    if (inFlight.current) return;
    inFlight.current = true; nativeSave.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const report = shareReport();
      if (window.omwDesktop?.shareReport) {
        const result = await window.omwDesktop.shareReport(report);
        if (!active.current) return;
        if (result?.ok && result.path) setNotice(`PDF 已保存：${result.path}`);
        else if (result?.canceled) setNotice("已取消 PDF 保存，未保存文件。");
        else throw new Error(result?.error || "导出失败");
      } else {
        throw new Error("PDF 导出需要桌面应用，请在 Open Medical 中打开此病历。");
      }
    } catch (err) {
      if (active.current) setError(err.message);
    } finally {
      inFlight.current = false; nativeSave.current = false;
      if (active.current) setBusy(false);
    }
  };
  const highlighted = (text) => {
    const parts = String(text).split(REDACT_MARK);
    return parts.map((part, index) => (
      <span key={index}>
        {part}
        {index < parts.length - 1 && <mark className="share-mark">［已脱敏］</mark>}
      </span>
    ));
  };
  return <Modal title="脱敏分享" onClose={close} wide>
    <div className="share-wizard">
      <p className="share-hint">{patientName ? `${patientName} · ` : ""}选择内容，核对脱敏预览，再导出本机文件。导出后可自行分享。</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    {step === 1 && <div className="share-step">
      <h3>这份分享要包含哪些内容？</h3>
      <div className="share-sections">
        {SHARE_SECTIONS.map(([key, label]) => (
          <label key={key}>
            <input type="checkbox" disabled={busy} checked={sections.has(key)} onChange={() => toggleSection(key)} />
            {label}
          </label>
        ))}
      </div>
      <p className="share-hint">无论怎么选，姓名、电话、病历号都不会出现；出生年只会以年龄段呈现。自由文本里的证件号、手机号、住院号会自动打码。</p>
      <div className="toolbar-actions">
        <button className="secondary" onClick={close}>取消</button>
        <button onClick={runPreview} disabled={busy || !sections.size}>
          {busy ? <Loader2 className="spin" size={14} /> : <FileText size={14} />} 生成脱敏预览
        </button>
      </div>
    </div>}
    {step === 2 && preview && <div className="share-step">
      <h3>预览将导出的内容</h3>
      {preview.findings.length > 0 ? <p className="share-findings" role="status">
        已自动抹掉：{preview.findings.map((finding) => `${FINDING_LABELS.find(([key]) => key === finding.category)?.[1] || finding.category} ${finding.count} 处`).join("、")}（预览中标黄部分）。
      </p> : <p className="share-findings" role="status">这次内容里没有扫到需要打码的号码，身份字段也已移除。</p>}
      <div className="share-preview">
        {buildShareSections(preview.record).filter((section) => section.rows.length).map((section) => (
          <section key={section.heading}>
            <h4>{section.heading}</h4>
            <ul>
              {section.rows.map(([label, value], index) => (
                <li key={index}><span>{label}</span><strong>{highlighted(value)}</strong></li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="share-hint">已处理常见身份字段和号码。请核对昵称、住址等间接身份信息；导出的文件与这份预览一致。</p>
      {notice && <p className="form-notice" role="status">{notice}</p>}
      <div className="toolbar-actions">
        <button className="secondary" disabled={busy} onClick={() => { setStep(1); setPreview(null); setNotice(""); setError(""); }}>上一步</button>
        <button className="secondary" onClick={downloadJson} disabled={busy}><Download size={14} /> 保存 JSON</button>
        <button onClick={exportPdf} disabled={busy}>
          {busy ? <Loader2 className="spin" size={14} /> : <FileText size={14} />}
           导出 PDF
        </button>
      </div>
    </div>}
    </div>
  </Modal>;
}
