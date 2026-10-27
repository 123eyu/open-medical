import { createHash } from "node:crypto";
import { check } from "../errors.mjs";
const identity = (config) => createHash("sha256").update(JSON.stringify(config)).digest("hex");
const modelName = (name) => name.endsWith(":latest") ? name.slice(0, -7) : name;
const ollamaEndpoint = (config) => {
  try {
    const url = new URL(config.baseUrl);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      && url.port === "11434" && url.pathname.replace(/\/$/, "") === "/v1";
  } catch { return false; }
};
const publicEndpoint = (value) => {
  try { const url = new URL(value); return `${url.origin}${url.pathname}`; }
  catch { return "地址待核对"; }
};
const unknown = () => ({ kind: "unknown", declarations: [], message: "任务能力尚未确认；可手动测试连接。" });
function capability(data) {
  const declarations = Array.isArray(data.capabilities) ? data.capabilities.filter(v => ["completion", "embedding", "vision", "tools", "thinking"].includes(v)) : [];
  if (declarations.includes("completion")) return { kind: "completion", declarations, message: "模型声明支持文本生成；声明不代表连接测试已通过。" };
  if (declarations.includes("embedding")) return { kind: "embedding-only", declarations, message: "仅用于知识检索，不支持生成任务回答。请选择文本生成模型。" };
  return unknown();
}
// Bound the entire metadata request, including a stalled response body.
async function readJSON(fetchImpl, url, options) {
  const { signal } = options;
  signal.throwIfAborted();
  let abort;
  const interrupted = new Promise((_, reject) => { abort = () => reject(signal.reason); signal.addEventListener("abort", abort, { once: true }); });
  try {
    return await Promise.race([interrupted, (async () => {
      const response = await fetchImpl(url, { ...options, redirect: "error" });
      check(response.ok, "LOCAL_UNAVAILABLE", "本机模型元数据暂不可用");
      return response.json();
    })()]);
  } finally { signal.removeEventListener("abort", abort); }
}
export class ModelChoices {
  constructor(settings, profiles, { fetchImpl = fetch, discoveryTimeoutMs = 5000 } = {}) {
    Object.assign(this, { settings, profiles, fetchImpl, discoveryTimeoutMs });
    this.local = new Map();
    this.metadata = new Map();
    this.knownNames = new Set();
    this.cache = new Map();
    this.discoveredUntil = 0;
  }
  existing() {
    const current = this.settings.configuration();
    const rows = [];
    if (current.model && current.baseUrl && (current.apiKey || current.provider === "local"))
      rows.push({ name: `${current.model} · 当前连接`, config: current, current: true });
    for (const [id, config] of Object.entries(this.profiles.all()))
      if (!rows.some(r => identity(r.config) === identity(config))) rows.push({ name: `${config.model} · ${id}`, config });
    return rows;
  }
  information(config) {
    if (!ollamaEndpoint(config)) return unknown();
    const row = this.metadata.get(modelName(config.model));
    if (row && this.discoveredUntil > Date.now()) return row;
    if (this.discoveredUntil > Date.now() && this.knownNames.has(modelName(config.model))) return { ...unknown(), presence: "present", message: "模型已下载，本次尚未读取其能力声明；可手动测试连接。" };
    if (this.discoveredUntil > Date.now()) return { ...unknown(), presence: "missing", message: "当前名称未在本机列表中找到；请核对模型名称或下载状态。" };
    return { ...unknown(), presence: "unconfirmed", message: "本机服务未连通或尚未检查，尚未确认模型是否存在。" };
  }
  assertTaskModel(config) {
    check(this.information(config).kind !== "embedding-only", "MODEL_EMBEDDING_ONLY", "该模型仅用于知识检索，不能生成任务回答。请选择文本生成模型。", 400);
    return config;
  }
  async list() {
    const local = new Map(), metadata = new Map();
    let discovery = { status: "empty", message: "本机服务可达，尚无已下载模型。" };
    const deadline = AbortSignal.timeout(this.discoveryTimeoutMs);
    try {
      const data = await readJSON(this.fetchImpl, "http://127.0.0.1:11434/api/tags", {
        signal: AbortSignal.any([deadline, AbortSignal.timeout(2000)]),
      });
      const allModels = (Array.isArray(data.models) ? data.models : [])
        .filter(m => typeof m.name === "string" && m.name.length > 0 && m.name.length <= 500);
      this.knownNames = new Set(allModels.map(m => modelName(m.name)));
      const preferred = new Set(this.existing().filter(r => ollamaEndpoint(r.config)).map(r => modelName(r.config.model)));
      const models = [...allModels.filter(m => preferred.has(modelName(m.name))), ...allModels.filter(m => !preferred.has(modelName(m.name)))].slice(0, 100);
      for (const m of models) metadata.set(modelName(m.name), unknown());
      let cursor = 0;
      const worker = async () => {
        while (cursor < models.length && !deadline.aborted) {
          const m = models[cursor++], cacheKey = `${m.name}:${m.digest || m.modified_at || ""}`;
          let info = this.cache.get(cacheKey);
          if (!info || info.expiresAt <= Date.now()) {
            try {
              const details = await readJSON(this.fetchImpl, "http://127.0.0.1:11434/api/show", {
                method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: m.name }),
                signal: AbortSignal.any([deadline, AbortSignal.timeout(2000)]),
              });
              info = { value: capability(details), expiresAt: Date.now() + 300000 };
              this.cache.set(cacheKey, info);
            } catch { info = { value: unknown() }; }
          }
          metadata.set(modelName(m.name), info.value);
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, models.length) }, worker));
      for (const m of models) {
        const info = metadata.get(modelName(m.name));
        const config = { provider: "local", baseUrl: "http://127.0.0.1:11434/v1", model: m.name, apiKey: "",
          vision: info.declarations.includes("vision"), maxTokens: 8192, timeoutMs: 90000 };
        local.set(identity(config), { name: `${m.name} · 本机`, config, expiresAt: Date.now() + 300000 });
      }
      this.metadata = metadata;
      this.discoveredUntil = Date.now() + 300000;
      if (local.size) discovery = { status: "ready", message: `已发现 ${allModels.length} 个本机模型${allModels.length > models.length ? `，本次列出 ${models.length} 个，优先读取已保存连接；其余模型可手动添加` : ""}；能力声明与手动测试分别显示。` };
      if (this.cache.size > 200) this.cache = new Map([...this.cache].slice(-100));
    } catch {
      this.discoveredUntil = 0;
      discovery = { status: "unavailable", message: "本机模型服务不可达或发现超时，尚未确认模型是否存在。已保存连接仍可手动测试。" };
    }
    this.local = local;
    const existing = this.existing();
    const rows = [...existing, ...[...local.values()].filter(({ config }) => !existing.some(r => ollamaEndpoint(r.config) && modelName(r.config.model) === modelName(config.model)))];
    return {
      discovery,
      choices: rows.map(({ name, config, current }) => {
        const info = this.information(config);
        return { id: identity(config), name, current: Boolean(current), local: config.provider === "local",
          vision: info.kind === "unknown" ? (config.vision === true ? true : null) : info.declarations.includes("vision"), visionSource: info.kind === "unknown" ? "configuration" : "declaration", baseUrl: publicEndpoint(config.baseUrl),
          capability: info, selectable: info.kind !== "embedding-only", test: this.settings.testRecord(config) };
      }),
    };
  }
  resolve(id) {
    const row = this.existing().find(r => identity(r.config) === id) || this.local.get(id);
    check(row && (!row.expiresAt || row.expiresAt > Date.now()), "MODEL_CHANGED", "模型列表已变化，请刷新后重新选择", 409);
    return this.assertTaskModel(this.settings.candidate(row.config));
  }
}
