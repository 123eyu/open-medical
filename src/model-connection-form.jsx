import { useState } from "react";
import { ModelBudgetFields } from "./model-budget-fields";

export function ModelConnectionForm({ busy, onTest, onSave, onChange }) {
  const [form, setForm] = useState({ provider: "openai-compatible", baseUrl: "", model: "", apiKey: "", vision: false, timeoutMs: 90000, maxTokens: 8192 });
  const [consent, setConsent] = useState(false);
  const update = changes => { setForm(value => ({ ...value, ...changes })); setConsent(false); onChange(); };
  return <details>
    <summary>添加模型连接</summary>
    <p>填写服务商提供的接口地址、模型名称和密钥。测试不会保存或启用连接。</p>
    <form onSubmit={event => { event.preventDefault(); onSave(form, () => setForm(value => ({ ...value, apiKey: "" }))); }}>
      <fieldset disabled={busy}>
        <label>接口协议<select value={form.provider} onChange={e => update({ provider: e.target.value })}>
          <option value="openai-compatible">OpenAI 兼容接口</option><option value="openai">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic">Anthropic</option><option value="deepseek">DeepSeek</option><option value="local">本机模型</option>
        </select></label>
        <label>接口地址<input required type="url" value={form.baseUrl} placeholder="https://服务商地址/v1" onChange={e => update({ baseUrl: e.target.value })}/></label>
        <label>模型名称<input required maxLength={500} value={form.model} onChange={e => update({ model: e.target.value })}/></label>
        <label>API Key<input type="password" autoComplete="off" required={form.provider !== 'local'} value={form.apiKey} onChange={e => update({ apiKey: e.target.value })}/></label>
        <label className="model-check"><input type="checkbox" checked={form.vision} onChange={e => update({ vision: e.target.checked })}/>此模型支持图片（按服务商说明确认）</label>
        <details><summary>高级预算设置</summary><ModelBudgetFields form={form} onChange={update}/></details>
        {form.provider !== 'local' && <label className="model-check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>允许此连接处理我的任务资料</label>}
        <div className="toolbar-actions"><button type="button" onClick={() => onTest(form)}>测试新连接</button><button type="submit" disabled={form.provider !== 'local' && !consent}>保存并启用连接</button></div>
      </fieldset>
    </form>
  </details>;
}
