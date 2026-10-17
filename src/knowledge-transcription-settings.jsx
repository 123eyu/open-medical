import { useEffect, useRef, useState } from "react";
import { api } from "./agent-runtime";

export const transcriptionSettingsUrl = collection => `?view=settings&settingsTab=transcription${collection ? `&collection=${encodeURIComponent(collection)}` : ""}`;

export function KnowledgeTranscriptionSettings() {
  const [data, setData] = useState(null), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [form, setForm] = useState({provider:"local",baseUrl:"",model:"",apiKey:""});
  const lock = useRef(false);
  const load = async () => {
    setError("");
    try {
      const value = await api("/api/knowledge/transcription-settings");
      setData(value); setForm({provider:value.transcription?.provider || "local",baseUrl:value.transcription?.baseUrl || "",model:value.transcription?.model || "",apiKey:""});
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);
  const save = async event => {
    event.preventDefault(); if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const value = await api("/api/knowledge/transcription-settings", "PUT", {...form,expectedRevision:data.transcriptionRevision});
      setData(value); setForm({...form,apiKey:""});
      setNotice("转写连接已保存，尚未验证识别结果。可返回原任务继续导入。");
    } catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(false); }
  };
  const collection = new URLSearchParams(window.location.search).get("collection");
  return <section aria-label="音视频转写设置">
    <h2>音视频转写</h2>
    <p>知识库音视频使用此服务识别语音。聊天模型配置保持独立；保存连接不代表服务已经连通。</p>
    {error && <p role="alert">{error} <button type="button" disabled={busy} onClick={load}>重新载入转写设置</button></p>}
    {notice && <p role="status">{notice}</p>}
    {!data ? <p>正在读取转写设置…</p> : <form onSubmit={save}>
      <p>{data.transcriptionReady ? `已保存连接：${data.transcription.model}；实际识别结果以导入任务为准。` : "尚未保存转写连接。"}</p>
      <fieldset disabled={busy}>
        <label>转写服务位置<select value={form.provider} onChange={e=>setForm({...form,provider:e.target.value})}><option value="local">本机服务</option><option value="openai-compatible">远端兼容服务</option><option value="openai">OpenAI 服务</option></select></label>
        <label>转写接口地址<input required type="url" placeholder="http://127.0.0.1:端口/v1" value={form.baseUrl} onChange={e=>setForm({...form,baseUrl:e.target.value})} /></label>
        <label>转写模型名称<input required value={form.model} onChange={e=>setForm({...form,model:e.target.value})} /></label>
        <label>转写访问密钥<input type="password" autoComplete="new-password" value={form.apiKey} placeholder={data.transcription?.hasKey ? "已保存；留空沿用同一地址的密钥" : "本机服务未要求密钥时可留空"} onChange={e=>setForm({...form,apiKey:e.target.value})} /></label>
        <p className="muted">接口需支持音频转写。远端服务须使用 HTTPS；本机服务仅允许回环地址，有访问令牌时请填写。密钥加密保存，不会回显。</p>
        <button className="primary" type="submit">{busy ? "正在保存…" : "保存转写连接"}</button>
      </fieldset>
    </form>}
    <p><a href={`?view=knowledge${collection ? `&collection=${encodeURIComponent(collection)}` : ""}`}>返回知识库继续导入</a></p>
  </section>;
}
