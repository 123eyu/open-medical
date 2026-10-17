import { useEffect, useRef, useState } from "react";
import { api } from "./agent-runtime";
import { OcrSettingsSection } from "./ocr-settings";
import { PersonalRegressionSettings } from "./learning-loop";
import { JevSettings } from "./jev-settings";
import { ModelConnectionForm } from "./model-connection-form";
export function ModelSettings({ onClose, onSaved }) {
  const dialog = useRef(null), request = useRef(null), generation = useRef(0);
  const [choices, setChoices] = useState(null), [discovery, setDiscovery] = useState(null),
    [selected, setSelected] = useState(""), [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(""), [error, setError] = useState(""), [status, setStatus] = useState("");
  function accept(result) {
    setChoices(result.choices);
    setDiscovery(result.discovery);
    setSelected(previous => result.choices.some(c => c.id === previous) ? previous : result.choices.find(c => c.current)?.id || result.choices[0]?.id || "");
    setConsent(false);
  }
  function clearFeedback() { setError(""); setStatus(""); }
  function cancel() {
    generation.current++;
    request.current?.abort();
    request.current = null;
    setBusy("");
  }
  function close() { cancel(); onClose(); }
  useEffect(() => {
    dialog.current.showModal();
    const controller = new AbortController();
    api("/api/model-choices", { signal: controller.signal }).then(accept).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => { controller.abort(); generation.current++; request.current?.abort(); };
  }, []);
  async function run(operation, fn) {
    const id = ++generation.current, controller = new AbortController();
    request.current?.abort(); request.current = controller;
    setBusy(operation); clearFeedback();
    try { await fn(controller.signal); }
    catch (e) { if (id === generation.current && !controller.signal.aborted) setError(e.message); }
    finally { if (id === generation.current) { setBusy(""); request.current = null; } }
  }
  const post = (path, data, signal, method = "POST") => api(path, { method, body: JSON.stringify(data), signal });
  const test = (path, data) => run("test", async signal => {
    const result = await post(path, data, signal);
    if (!signal.aborted) setStatus(result.message);
  });
  const save = (path, data, method = "POST", afterSave) => run("save", async signal => {
    await post(path, data, signal, method);
    if (signal.aborted) return;
    afterSave?.();
    setStatus("已保存并启用，下一次任务使用所选模型。");
    try { await onSaved(); const value = await api("/api/model-choices", { signal }); if (!signal.aborted) { accept(value); setSelected(value.choices.find(c => c.current)?.id || ""); } }
    catch (e) { if (!signal.aborted) setError(`连接已启用，但刷新显示失败：${e.message}。请刷新可用模型核对当前连接。`); }
  });
  const choice = choices?.find(c => c.id === selected);
  return <dialog ref={dialog} className="model-settings-dialog" aria-labelledby="model-settings-title" onCancel={e => { e.preventDefault(); close(); }} onClose={onClose}>
    <header><h2 id="model-settings-title">模型与识别</h2><button onClick={close}>关闭</button></header>
    <div className="model-settings-body"><section>
      <h3>选择可用模型</h3><p>自动读取已保存的模型连接和本机正在运行的模型。</p>
      {!choices && !error && <p role="status">正在查找可用模型…</p>}
      {discovery && <p role="status">{discovery.message}</p>}
      {choices?.length === 0 && <p>尚未找到可用模型。启动本机 Ollama 后刷新，或通过下方「添加模型连接」填写服务商连接。</p>}
      {!!choices?.length && <fieldset disabled={Boolean(busy)}>
        <label>任务使用的模型<select value={selected} onChange={e => { setSelected(e.target.value); setConsent(false); clearFeedback(); }}>
          {choices.map(c => <option key={c.id} value={c.id}>{c.name}{c.baseUrl ? ` · ${c.baseUrl}` : ''}</option>)}
        </select></label>
        {choice && <p>{choice.local ? "任务资料在本机处理。" : "任务消息及所需资料会交给所选模型服务处理。"}{choice.vision === null ? "图片能力尚未确认，当前先通过文字识别处理。" : choice.vision ? "支持图片。" : "图片先通过文字识别处理。"}</p>}
        {choice && !choice.local && <label className="model-check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>允许此模型处理我的任务资料</label>}
        <div className="toolbar-actions"><button onClick={() => test('/api/model-choices/test', { id: selected })}>{busy === 'test' ? '检测中…' : '测试连接'}</button>
          <button disabled={!choice || (!choice.local && !consent)} onClick={() => save('/api/model-choices/select', { id: selected, consent })}>使用所选模型</button></div>
      </fieldset>}
      <p><small>连接测试只发送固定示例文本，不含患者资料；云端测试可能产生少量费用。依次检测文本、工具调用和 JSON 输出，整个检查最长等待 30 秒。</small></p>
      {busy && <p role="status">{busy === 'test' ? '正在检测连接与能力，最长等待 30 秒；可取消检测或关闭窗口。' : busy === 'save' ? '正在保存连接…' : '正在刷新可用模型…'}</p>}
      {busy === 'test' && <button onClick={() => { cancel(); setStatus('已取消检测，当前连接未改变。'); }}>取消检测</button>}
      <button disabled={Boolean(busy)} onClick={() => run('refresh', async signal => { const value = await api('/api/model-choices', { signal }); if (!signal.aborted) { accept(value); setSelected(value.choices.find(c => c.current)?.id || ""); } })}>刷新可用模型</button>
      {error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
      <ModelConnectionForm busy={Boolean(busy)} onChange={clearFeedback} onTest={form => test('/api/model-settings/test', form)} onSave={(form, afterSave) => save('/api/model-settings', form, 'PUT', afterSave)}/>
      <details><summary>文字识别</summary><OcrSettingsSection/></details><PersonalRegressionSettings/><JevSettings/>
    </section></div>
  </dialog>;
}
