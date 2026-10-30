import { useEffect, useState } from "react";
import { api } from "./agent-runtime";

// 患者资料去隐私：开启后发给模型的资料先脱敏，原图不发给模型。
export function PrivacySettings() {
  const [data, setData] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [form, setForm] = useState({ baseUrl: "", apiKey: "" });
  useEffect(() => {
    let alive = true;
    api("/api/privacy-settings")
      .then((value) => alive && setData(value))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);
  async function run(fn) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const save = (patch, message) =>
    run(async () => {
      const result = await api("/api/privacy-settings", "PUT", patch);
      setData(result);
      setStatus(`${message}${result.reprocess?.queued ? `，正在为 ${result.reprocess.queued} 份已有资料补做脱敏` : ""}。`);
    });
  if (!data) return error ? <p role="alert">{error}</p> : null;
  const ownForm = form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim(), ...(form.apiKey ? { apiKey: form.apiKey } : {}) } : null;
  return (
    <section aria-label="患者资料脱敏">
      <p>
        开启后，导入的病历会先脱敏再保存：文字中的姓名、电话、证件号、住址等替换成占位符，图片和扫描件按识别结果把这些位置涂黑，原文和原图不再保留。模型只看到脱敏后的资料；建档时由本机把真实姓名填回提案。
      </p>
      <fieldset disabled={busy}>
        <label>
          <input type="checkbox" checked={data.enabled} onChange={(e) => save({ enabled: e.target.checked }, e.target.checked ? "已开启脱敏" : "已关闭脱敏")} />
          开启患者资料脱敏
        </label>
        <label>
          服务不可用时
          <select value={data.mode} onChange={(e) => save({ mode: e.target.value }, "已保存")}>
            {Object.entries(data.modes).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p>
          {data.service
            ? `脱敏服务：${data.service.baseUrl}${data.service.source === "ocr" ? "（沿用文字识别服务）" : ""}`
            : "尚未配置脱敏服务：将只用本地规则脱敏，自由文本中的家属姓名、地址可能漏掉。"}
        </p>
        {data.service?.insecure && (
          <p role="alert">该地址使用明文 HTTP：送去脱敏的原始病历和 API Key 在网络上未加密。建议改用 HTTPS，或只在可信内网使用。</p>
        )}
        <details>
          <summary>单独设置脱敏服务（gpu-worker）</summary>
          <label>
            接口地址
            <input value={form.baseUrl} placeholder={data.ownService?.baseUrl || "https://your-worker.example.com"} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
          </label>
          <label>
            API Key
            <input type="password" value={form.apiKey} placeholder={data.ownService?.hasKey ? "已保存，留空不修改" : "WORKER_API_KEY"} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
          </label>
          <p>支持 HTTP 和 HTTPS；经公网访问时建议使用 HTTPS。</p>
          <button disabled={!ownForm} onClick={() => save({ service: ownForm }, "脱敏服务已保存")}>
            保存服务
          </button>
          {data.ownService && (
            <button onClick={() => save({ clearService: true }, "已改回沿用文字识别服务")}>改回沿用文字识别服务</button>
          )}
        </details>
        <button
          onClick={() =>
            run(async () => {
              const result = await api("/api/privacy-settings/test", "POST", ownForm ? { service: ownForm } : {});
              setStatus(`${result.message}（${result.ms} 毫秒）：${result.sample}`);
            })
          }
        >
          测试脱敏服务
        </button>
        {data.enabled && (
          <button
            onClick={() =>
              run(async () => {
                const result = await api("/api/privacy-settings/reprocess", "POST");
                setStatus(result.queued ? `正在为 ${result.queued} 份资料重新脱敏。` : "所有资料都已经由服务脱敏。");
              })
            }
          >
            重新脱敏未完成的资料
          </button>
        )}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
