import { useEffect, useRef, useState } from "react";
import { api } from "./agent-runtime";
import { Modal } from "./components";

export function KnowledgeTranscriptRecovery({ job, onClose, onSaved }) {
  const [text, setText] = useState(""), [format, setFormat] = useState("text"), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRef(null), lock = useRef(false);
  useEffect(() => {
    if (!text) return;
    const guard = event => {event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",guard);
    return () => window.removeEventListener("beforeunload",guard);
  }, [text]);
  const close = () => { if (!busy && (!text || window.confirm("放弃尚未提交的文字稿？"))) onClose(); };
  const submit = async event => {
    event.preventDefault(); if (lock.current) return;
    lock.current=true;setBusy(true);setError("");
    const signature = JSON.stringify([text,format]);
    if (!request.current || request.current.signature !== signature) request.current={signature,id:crypto.randomUUID()};
    try {
      await api(`/api/knowledge/organization/${job.id}/transcript`,"POST",{text,format,requestId:request.current.id,expectedUpdatedAt:job.updatedAt,externalConsent:true});
      setText(""); await onSaved();
    } catch (e) {setError(e.message);}
    finally {lock.current=false;setBusy(false);}
  };
  return <Modal title="补充文字稿" onClose={close}>
    <form onSubmit={submit}>
      <p>对应原件：{job.fileName}。请提供这份音视频的完整文字稿；原件和任务会保留。</p>
      <p>文字稿将标为“医生提供”，作为检索与图谱依据，不会标为自动识别结果。未提供时间的文字不生成时间定位。</p>
      <fieldset disabled={busy}>
        <label>文字稿格式<select value={format} onChange={e=>setFormat(e.target.value)}><option value="text">纯文字</option><option value="srt">SRT 字幕</option><option value="vtt">VTT 字幕</option></select></label>
        <label>完整文字稿<textarea aria-label="完整文字稿" value={text} onChange={e=>setText(e.target.value)} rows={12} maxLength={1000000}/></label>
        {error && <p role="alert">{error}</p>}
        <p className="muted">继续后，文字稿会按原任务设置交给已配置的索引和图谱服务。</p>
        <button className="primary" disabled={!text.trim()}>{busy ? "正在保存…" : "保存文字稿并继续原任务"}</button>
      </fieldset>
    </form>
  </Modal>;
}
