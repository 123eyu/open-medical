import { createHash } from "node:crypto";
import { check } from "../errors.mjs";
const identity = (c) =>
  createHash("sha256").update(JSON.stringify(c)).digest("hex");
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
    } catch {
      /* Local model discovery is optional and never changes the active connection. */
    }
    this.local = local;
    return {
      choices: [...this.existing(), ...local.values()].map(
        ({ name, config, current }) => ({
          id: identity(config),
          name,
          current: Boolean(current),
          local: config.provider === "local",
          vision: config.vision === true,
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
