import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { api } from "./agent-runtime";
import { Modal } from "./components";

const TEMPLATE = "姓名,患者编号,项目,数值,单位,日期\n";
const STATUS_LABEL = { ready: "可导入", "no-patient": "未匹配患者", "same-name": "同名待核对", invalid: "需修正" };
// 检验结果导入：从 LIS/Excel 导出的 CSV 逐行匹配患者，生成档案更新提案；
// 确认仍走患者档案，与「AI 不直写」同一复核轨。
export function LabImportModal({ onClose, onImported }) {
  const [text, setText] = useState(""), [preview, setPreview] = useState(null), [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [result, setResult] = useState(null);
  const inFlight = useRef(false), fileInput = useRef(null);
  const loadFile = async (file) => {
    if (!file) return;
    try {
      if (file.size > 200000) throw new Error("表格超过 200KB，请分批导入");
      setText(await file.text()); setPreview(null); setResult(null); setError("");
    } catch (err) { setError(err.message); }
  };
  const run = async (commit) => {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError("");
    try {
      if (commit) {
        const outcome = await api("/api/patients/lab-import/commit", "POST", { text, selectedRows: selected });
        setResult(outcome); setPreview(null);
        await onImported(outcome);
      } else {
        const outcome = await api("/api/patients/lab-import/preview", "POST", { text });
        setPreview(outcome); setSelected(outcome.rows.filter((row) => row.status === "ready").map((row) => row.row));
      }
    } catch (err) { setError(err.message); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <Modal title="导入检验结果" wide onClose={() => { if (!busy) onClose(); }}>
    <div className="patient-import">
      {result ? <>
        <p role="status">已为 {result.proposals.length} 位患者生成检验结果提案，共 {result.proposals.reduce((sum, p) => sum + p.labs, 0)} 项。</p>
        <ul className="care-list">{result.proposals.map((p) => <li key={p.id} className="care-card"><b>{p.patientName}</b><span>{p.labs} 项待确认</span></li>)}</ul>
        <p className="muted">{result.note}未导入 {result.skipped} 行（未匹配或需修正）。</p>
        <div className="modal-actions"><button className="primary" onClick={onClose}>完成</button></div>
      </> : !preview ? <>
        <p className="muted">支持 CSV 文件或从 Excel 复制表格（LIS 导出亦可）。先预览匹配患者，再生成待确认提案；每次最多 500 行。表头须含「项目」「数值」，以及「姓名」或「患者编号」。</p>
        <div className="toolbar-actions"><button className="secondary" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={14} /> 选择表格文件</button><input ref={fileInput} type="file" accept=".csv,.tsv,.txt" hidden onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ""; }} /></div>
        <label>检验表格文本<textarea rows={10} maxLength={200000} disabled={busy} value={text} onChange={(e) => setText(e.target.value)} placeholder={`${TEMPLATE}可直接粘贴包含表头的 Excel 单元格`} /></label>
        <small className="muted">将按姓名与患者编号匹配现有患者；日期为 YYYY-MM-DD，数值须为数字。同名患者需补充编号区分。提案确认前不会写入档案。</small>
      </> : <>
        <div className="import-summary"><b>{preview.stats.total} 条记录</b><span>{preview.stats.ready} 条可导入</span><span>{preview.stats.noPatient} 条未匹配患者</span><span>{preview.stats.sameName} 条同名待核对</span><span>{preview.stats.invalid} 条需修正</span></div>
        <p className="muted">匹配不到患者的行请先建档或补充编号；确认后按患者生成档案更新提案。</p>
        <div className="import-table"><table><thead><tr><th>选择</th><th>行</th><th>患者</th><th>检验</th><th>核对结果</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.row}>
          <td><input type="checkbox" aria-label={`选择第 ${row.row} 行`} disabled={busy || row.status !== "ready"} checked={selected.includes(row.row)} onChange={(e) => setSelected((prev) => e.target.checked ? [...prev, row.row] : prev.filter((number) => number !== row.row))} /></td>
          <td>{row.row}</td>
          <td><b>{row.patientName || row.name || "未填姓名"}</b><small>{row.patientNumber || ""}</small></td>
          <td>{row.item} {row.value}{row.unit}<small>{row.date}</small></td>
          <td>{row.status === "ready" ? "可导入" : <>{STATUS_LABEL[row.status]}：{row.reason}{row.candidates?.length ? <small>{row.candidates.map((p) => `${p.name} · ${p.patientNumber || "未编号"}`).join("；")}</small> : null}</>}</td>
        </tr>)}</tbody></table></div>
      </>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {!result && <div className="modal-actions">{preview && <button className="secondary" disabled={busy} onClick={() => { setPreview(null); setError(""); }}>返回修改表格</button>}<button className="primary" disabled={busy || (preview ? !selected.length : !text.trim())} onClick={() => run(Boolean(preview))}>{busy ? "处理中…" : preview ? `生成 ${selected.length} 行检验提案` : "预览并匹配"}</button></div>}
    </div>
  </Modal>;
}
