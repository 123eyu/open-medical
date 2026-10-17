import { createHash } from "node:crypto";
import { check } from "../errors.mjs";
const identity = (c) =>
  createHash("sha256").update(JSON.stringify(c)).digest("hex");
const publicEndpoint = (value) => {
  try { const url = new URL(value); return `${url.origin}${url.pathname}`; }
  catch { return "地址待核对"; }
};
export class ModelChoices {
  constructor(settings, profiles, { fetchImpl = fetch } = {}) {
    Object.assign(this, { settings, profiles, fetchImpl });
    this.local = new Map();
  }
  existing() {
    const p = this.settings.provider();
    const current = this.settings.saved.provider
      ? this.settings.saved
      : {
          provider: p.local ? "local" : p.provider,
          model: p.model,
          baseUrl: p.baseUrl,
          apiKey: p.apiKey || "",
          vision: p.vision === true,
          timeoutMs: p.timeoutMs || 90000,
          maxTokens: p.maxTokens || 8192,
          contextWindow: p.contextWindow,
        };
    const rows = [];
    if (
      current.model &&
      current.baseUrl &&
      (current.apiKey || current.provider === "local")
    )
      rows.push({
        name: `${current.model} · 当前连接`,
        config: current,
        current: true,
      });
    for (const [id, config] of Object.entries(this.profiles.all()))
      if (!rows.some((r) => identity(r.config) === identity(config)))
        rows.push({ name: `${config.model} · ${id}`, config });
    return rows;
  }
  async list() {
    const local = new Map();
    let discovery = { status: "empty", message: "本机服务可达，尚无已下载模型。" };
    try {
      const response = await this.fetchImpl("http://127.0.0.1:11434/api/tags", {
        signal: AbortSignal.timeout(2000),
        redirect: "error",
      });
      check(response.ok, "LOCAL_UNAVAILABLE", "本机模型暂不可用");
      const data = await response.json();
      for (const m of (Array.isArray(data.models) ? data.models : []).slice(
        0,
        100,
      ))
        if (
          typeof m.name === "string" &&
          m.name.length > 0 &&
          m.name.length <= 500
        ) {
          const config = {
            provider: "local",
            baseUrl: "http://127.0.0.1:11434/v1",
            model: m.name,
            apiKey: "",
            vision: false,
            maxTokens: 8192,
            timeoutMs: 90000,
          };
          local.set(identity(config), {
            name: `${m.name} · 本机`,
            config,
            expiresAt: Date.now() + 300000,
          });
        }
      if (local.size) discovery = { status: "ready", message: `已发现 ${local.size} 个本机模型；图片能力尚未确认。` };
    } catch {
      discovery = { status: "unavailable", message: "本机模型服务不可达或发现超时，请启动服务后刷新；已保存连接仍可选择。" };
    }
    this.local = local;
    return {
      discovery,
      choices: [...this.existing(), ...local.values()].map(
        ({ name, config, current, expiresAt }) => ({
          id: identity(config),
          name,
          current: Boolean(current),
          local: config.provider === "local",
          vision: expiresAt ? null : config.vision === true,
          baseUrl: publicEndpoint(config.baseUrl),
        }),
      ),
    };
  }
  resolve(id) {
    const row =
      this.existing().find((r) => identity(r.config) === id) ||
      this.local.get(id);
    check(
      row && (!row.expiresAt || row.expiresAt > Date.now()),
      "MODEL_CHANGED",
      "模型列表已变化，请刷新后重新选择",
      409,
    );
    return this.settings.candidate(row.config);
  }
}
