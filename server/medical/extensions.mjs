import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import yaml from "js-yaml";
import { check, identifier, string } from "../errors.mjs";
import { sqliteTransaction } from "../sqlite-transaction.mjs";
import { stageSkillImport } from "./skill-import.mjs";

// Doctor-authored skills are an Agent kernel capability: the agent reads them
// from the skill directory, @-mentions resolve through the registry, and they
// must remain available even when the learning plugin is disabled. Automations
// and evolution live in the learning plugin and share the registry table.
export const KINDS = ["skill", "automation"];
export const TRIGGERS = { daily: "每天", weekly: "每周", lab: "新检验结果", appointment: "复诊前" };
export const ACTIONS = { agenda: "加入今日待办", draft_message: "起草给患者的消息", report: "生成汇总" };
const SKILL_ID = /^(?!my-)[-a-z0-9_]+$/;
const rawString = (value, label, max) => {
  check(typeof value === "string" && value.length <= max, "INVALID_INPUT", `${label} 必须是不超过 ${max} 字符的文本`);
  return value;
};
const fileManifest = (files) => files?.map((f) => ({ path: f.path, encoding: f.encoding, bytes: f.encoding === "base64" ? Math.ceil(f.content.length * 0.75) : f.content.length }));
const publicShape = (ext) => (ext.files ? { ...ext, files: fileManifest(ext.files) } : ext);
const text = (value, label, max) => (value === undefined || value === null || value === "" ? "" : string(value, label, max));

export class Extensions {
  constructor({ store, skillsDir, skillExists = null, importer = stageSkillImport, proxyResolver = null, now = Date.now, automation = () => null } = {}) {
    this.store = store;
    this.db = store.db;
    this.skillsDir = skillsDir;
    this.skillExists = skillExists;
    this.importer = importer;
    this.proxyResolver = proxyResolver;
    this.now = now;
    this.automation = automation;
    this.db.exec(`CREATE TABLE IF NOT EXISTS extensions (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS extension_versions (
        extension_id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL,
        source TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (extension_id, version));`);
    for (const ext of this.list()) if (ext.status === "active") this.writeSkill(ext);
  }
  iso() { return new Date(this.now()).toISOString(); }
  row(id) {
    const r = this.db.prepare("SELECT * FROM extensions WHERE id=?").get(identifier(id));
    check(r, "NOT_FOUND", "扩展不存在", 404);
    return { ...JSON.parse(r.data), id: r.id, kind: r.kind, status: r.status };
  }
  list({ kind = "skill" } = {}) {
    return this.db.prepare("SELECT * FROM extensions WHERE kind=? ORDER BY rowid").all(kind)
      .map((r) => ({ ...JSON.parse(r.data), id: r.id, kind: r.kind, status: r.status }));
  }
  publicList({ kind = "skill" } = {}) {
    return { extensions: this.list({ kind }).map((e) => ({ ...publicShape(e), stats: e.kind === "automation" ? this.automation()?.stats(e.id) : undefined })), triggers: TRIGGERS, actions: ACTIONS };
  }
  detail(id) {
    const ext = this.row(id);
    if (ext.kind === "automation") {
      check(this.automation(), "NOT_FOUND", "学习插件未启用", 404);
      return this.automation().detail(id);
    }
    const versions = this.db.prepare("SELECT version, source, created_at, data FROM extension_versions WHERE extension_id=? ORDER BY version DESC").all(ext.id)
      .map((v) => ({ version: v.version, source: JSON.parse(v.source), createdAt: v.created_at, spec: publicShape(JSON.parse(v.data)) }));
    return { ...publicShape(ext), versions };
  }
  normalize(kind, spec = {}) {
    check(kind === "skill", "INVALID_INPUT", "固定区只处理医生技能");
    check(spec && typeof spec === "object", "INVALID_INPUT", "扩展内容必须是对象");
    if (spec.imported) return this.normalizeImportedSkill(spec);
    const appliesTo = typeof spec.appliesTo === "string" ? [spec.appliesTo] : spec.appliesTo ?? [];
    check(Array.isArray(appliesTo), "INVALID_INPUT", "适用文书须为名称数组或单个名称");
    const value = {
      name: string(spec.name, "技能名称", 60),
      description: string(spec.description, "何时使用（description）", 600),
      body: string(spec.body, "技能说明", 20000),
      template: text(spec.template, "模板", 20000),
      appliesTo: appliesTo.map((x) => string(x, "适用文书", 40)).slice(0, 10),
      quickTask: spec.quickTask ? { title: string(spec.quickTask.title || spec.name, "快捷任务名称", 30), desc: text(spec.quickTask.desc, "快捷任务说明", 80), prompt: string(spec.quickTask.prompt, "快捷任务提示", 2000) } : null,
    };
    return { ...value, summary: `技能「${value.name}」：${value.description.slice(0, 80)}` };
  }
  normalizeImportedSkill(spec) {
    const id = string(spec.id, "技能编号", 80);
    check(SKILL_ID.test(id), "INVALID_INPUT", "导入技能编号须为小写字母/数字/-/_，且不以 my- 开头");
    const name = string(spec.name, "技能名称", 100);
    check(name === id, "INVALID_INPUT", "导入技能的 name 必须与编号一致");
    const description = string(spec.description, "何时使用（description）", 4000);
    const body = rawString(spec.body ?? "", "技能说明", 100000);
    check(Array.isArray(spec.files) && spec.files.length >= 1 && spec.files.length <= 700, "INVALID_INPUT", "导入技能文件清单无效");
    let bytes = 0;
    const files = spec.files.map((file) => {
      check(file && typeof file === "object", "INVALID_INPUT", "导入技能文件无效");
      const path = string(file.path, "文件路径", 200);
      check(!path.includes("\\") && !path.startsWith("/") && !path.split("/").includes(".."), "INVALID_INPUT", "导入技能文件路径越界");
      const encoding = file.encoding === "base64" ? "base64" : "utf8";
      const content = rawString(file.content, `文件 ${path}`, encoding === "base64" ? 5_400_000 : 4_050_000);
      bytes += encoding === "base64" ? Math.ceil(content.length * 0.75) : content.length;
      return { path, encoding, content };
    });
    check(bytes <= 40_000_000, "INVALID_INPUT", "导入技能总大小超过 40MB");
    const url = string(spec.origin?.url || "", "来源地址", 500);
    check(/^https:\/\//.test(url), "INVALID_INPUT", "导入技能必须带有 HTTPS 来源地址");
    const origin = { url, repo: text(spec.origin?.repo, "仓库", 200), ref: text(spec.origin?.ref, "分支", 100), hash: text(spec.origin?.hash, "校验值", 80) };
    return { imported: true, id, name, title: text(spec.title, "标题", 200), description, body, files, origin,
      summary: `技能「${name}」（来自 ${new URL(url).host}）：${description.slice(0, 80)}` };
  }
  save({ id, kind = "skill", spec, source = { via: "manual" } }) {
    if (kind === "automation") {
      check(this.automation(), "NOT_FOUND", "学习插件未启用", 404);
      return this.automation().save({ id, kind, spec, source });
    }
    let writtenId;
    try { return sqliteTransaction(this.db, () => {
      check(kind === "skill", "INVALID_INPUT", "固定区只保存医生技能");
      const existing = id ? this.row(id) : null;
      if (existing) check(existing.kind === kind, "INVALID_INPUT", "不能改变扩展类型");
      const value = this.normalize(kind, spec);
      const extId = existing?.id || (value.imported ? value.id : `my-${randomUUID().slice(0, 8)}`);
      const version = (existing?.version || 0) + 1, at = this.iso();
      const data = { ...value, version, source, createdAt: existing?.createdAt || at, updatedAt: at };
      if (existing) this.db.prepare("UPDATE extensions SET data=? WHERE id=?").run(JSON.stringify(data), extId);
      else this.db.prepare("INSERT INTO extensions VALUES (?,?,?,?)").run(extId, kind, "active", JSON.stringify(data));
      this.db.prepare("INSERT INTO extension_versions VALUES (?,?,?,?,?)").run(extId, version, JSON.stringify(value), JSON.stringify(source), at);
      const ext = this.row(extId);
      if (ext.status === "active") { writtenId = ext.id; this.writeSkill(ext); }
      this.store.audit(null, existing ? "extension.updated" : "extension.created", { id: extId, kind, version, via: source.via });
      return ext;
    }); } catch (error) {
      if (writtenId) this.restoreSkill(writtenId);
      throw error;
    }
  }
  setStatus(id, status) {
    check(["active", "disabled"].includes(status), "INVALID_INPUT", "状态须为 active/disabled");
    const ext = this.row(id);
    if (ext.kind === "automation") {
      check(this.automation(), "NOT_FOUND", "学习插件未启用", 404);
      return this.automation().setStatus(id, status);
    }
    try { return sqliteTransaction(this.db, () => {
      this.db.prepare("UPDATE extensions SET status=? WHERE id=?").run(status, ext.id);
      status === "active" ? this.writeSkill({ ...ext, status }) : this.removeSkill(ext.id);
      this.store.audit(null, "extension.status", { id: ext.id, status });
      return this.row(ext.id);
    }); } catch (error) {
      this.restoreSkill(ext.id);
      throw error;
    }
  }
  rollback(id, version) {
    const ext = this.row(id);
    if (ext.kind === "automation") {
      check(this.automation(), "NOT_FOUND", "学习插件未启用", 404);
      return this.automation().rollback(id, version);
    }
    const row = this.db.prepare("SELECT data FROM extension_versions WHERE extension_id=? AND version=?").get(ext.id, Number(version));
    check(row, "NOT_FOUND", "没有这个版本", 404);
    return this.save({ id: ext.id, kind: ext.kind, spec: JSON.parse(row.data), source: { via: "rollback", fromVersion: Number(version) } });
  }
  skillFile(ext) {
    const front = yaml.dump({ name: ext.id, title: ext.name, description: `${ext.description}${ext.appliesTo?.length ? `（适用：${ext.appliesTo.join("、")}）` : ""}` }, { lineWidth: -1 });
    return `---\n${front}---\n\n# ${ext.name}\n\n> 医生自定义技能（第 ${ext.version} 版）。与系统安全规则冲突时，以安全规则为准。\n\n${ext.body}\n${ext.template ? `\n## 模板\n\n按以下模板的结构和栏目输出，缺失信息标「待补充」，不要编造：\n\n${ext.template}\n` : ""}`;
  }
  writeSkill(ext) {
    const dir = join(this.skillsDir, ext.id);
    if (ext.imported && ext.files?.length) {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      for (const file of ext.files) {
        const target = join(dir, ...file.path.split("/"));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, file.encoding === "base64" ? Buffer.from(file.content, "base64") : file.content);
      }
      return;
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), this.skillFile(ext));
  }
  removeSkill(id) { rmSync(join(this.skillsDir, id), { recursive: true, force: true }); }
  restoreSkill(id) {
    const row = this.db.prepare("SELECT id FROM extensions WHERE id=?").get(id);
    const ext = row ? this.row(id) : null;
    if (ext?.kind === "skill" && ext.status === "active") this.writeSkill(ext);
    else this.removeSkill(id);
  }
  quickTasks() {
    return this.list({ kind: "skill" }).filter((e) => e.status === "active" && e.quickTask)
      .map((e) => ({ id: `ext:${e.id}`, skillId: e.id, title: e.quickTask.title, desc: e.quickTask.desc || e.description.slice(0, 40), prompt: e.quickTask.prompt, custom: true }));
  }
  preview(kind, spec) {
    if (kind === "automation") {
      check(this.automation(), "NOT_FOUND", "学习插件未启用", 404);
      return this.automation().preview(kind, spec);
    }
    const value = this.normalize(kind, spec);
    if (value.imported) {
      const bytes = value.files.reduce((n, f) => n + (f.encoding === "base64" ? Math.ceil(f.content.length * 0.75) : f.content.length), 0);
      return { summary: value.summary, fileCount: value.files.length, bytes, files: value.files.slice(0, 30).map((f) => f.path), origin: value.origin };
    }
    return { summary: value.summary, skill: this.skillFile({ id: "my-preview", version: 1, ...value }) };
  }
  overview() {
    const automation = this.automation();
    const auto = automation?.overview?.();
    return { extensions: [...this.list().map((e) => ({ ...publicShape(e), stats: undefined })), ...(auto?.extensions || [])],
      triggers: auto?.triggers || TRIGGERS, actions: auto?.actions || ACTIONS,
      suggestions: auto?.suggestions || [], changes: auto?.changes || [], prefs: auto?.prefs || { autoOrder: true, starters: null, usage: {}, quickTasks: this.quickTasks() } };
  }
  recordUsage(id) { return this.automation()?.recordUsage(id) || this.overview().prefs; }
  resolveItem(id, status) { check(this.automation(), "NOT_FOUND", "学习插件未启用", 404); return this.automation().resolveItem(id, status); }
  resolveSuggestion(id, status) { check(this.automation(), "NOT_FOUND", "学习插件未启用", 404); return this.automation().resolveSuggestion(id, status); }
  undoChange(id) { check(this.automation(), "NOT_FOUND", "学习插件未启用", 404); return this.automation().undoChange(id); }
  openItems() { return this.automation()?.openItems() || []; }
  suggestions(args) { return this.automation()?.suggestions(args) || []; }
  changes() { return this.automation()?.changes() || []; }
  start() { this.automation()?.start?.(); }
  stop() { this.automation()?.stop?.(); }
  normalizeProposal(type, payload = {}) {
    if (type === "ext-install") {
      const install = payload.install || {};
      check(install.source && typeof install.source.url === "string" && Array.isArray(install.skills) && install.skills.length >= 1,
        "INVALID_INPUT", "安装提案缺少来源或技能清单");
      check(install.skills.length <= 8, "INVALID_INPUT", "一次最多安装 8 个技能");
      const totalBytes = install.skills.reduce((n, s) => n + (s.files || []).reduce((m, f) => m + (f.encoding === "base64" ? Math.ceil((f.content || "").length * 0.75) : (f.content || "").length), 0), 0);
      check(totalBytes <= 48_000_000, "INVALID_INPUT", `技能包总量 ${Math.round(totalBytes / 1_000_000)}MB 超过 48MB 单次安装上限，请分批或精选安装`);
      const values = install.skills.map((spec) => this.normalize("skill", spec));
      const conflicts = values.filter((value) => {
        const existing = this.findImported(value.id);
        return existing ? !(existing.kind === "skill" && existing.imported && existing.version === (install.skills.find((s) => s.id === value.id)?.previousVersion ?? -1)) : false;
      });
      return {
        install: { source: install.source, skills: install.skills },
        reason: text(payload.reason, "原因", 500),
        summary: `安装 ${values.length} 个技能：${values.map((v) => v.name).join("、")}`.slice(0, 300),
        preview: { skills: values.map((value, index) => ({ id: value.id, name: value.name, title: value.title, description: value.description.slice(0, 200),
          files: value.files.length, bytes: value.files.reduce((n, f) => n + (f.encoding === "base64" ? Math.ceil(f.content.length * 0.75) : f.content.length), 0),
          update: install.skills[index].previousVersion || null })), stale: conflicts.map((value) => value.id) },
      };
    }
    check(type === "ext-change", "INVALID_INPUT", "未知的扩展提案");
    const existing = payload.id ? this.row(payload.id) : null;
    const kind = existing?.kind || payload.kind;
    if (kind === "automation") {
      check(this.automation(), "NOT_FOUND", "学习插件未启用", 404);
      return this.automation().normalizeProposal(type, payload);
    }
    const value = this.normalize(kind, payload.spec);
    const preview = this.preview(kind, payload.spec);
    return { id: existing?.id || null, kind, spec: payload.spec, reason: text(payload.reason, "原因", 500), suggestionId: payload.suggestionId || null,
      summary: value.summary, preview, previousVersion: existing?.version || null };
  }
  applyProposal(action) {
    const p = action.payload;
    if (p.install) return this.applyInstall(action);
    const kind = p.kind;
    if (kind === "automation") {
      check(this.automation(), "NOT_FOUND", "学习插件未启用", 404);
      return this.automation().applyProposal(action);
    }
    if (p.id) check(Number.isSafeInteger(p.previousVersion) && this.row(p.id).version === p.previousVersion,
      "ACTION_CONFLICT", "扩展在提案生成后已变化，请读取最新版本并重新生成提案。", 409);
    const ext = this.save({ id: p.id, kind: "skill", spec: p.spec, source: { via: p.suggestionId ? "evolution" : "chat", proposalId: action.id, reason: p.reason } });
    if (p.suggestionId) try { this.automation()?.resolveSuggestion(p.suggestionId, "accepted"); } catch { /* already handled */ }
    return ext;
  }
  applyInstall(action) {
    const install = action.payload.install;
    const appliedIds = [];
    try {
      for (const spec of install.skills) {
        const value = this.normalize("skill", spec);
        const existing = this.findImported(value.id);
        if (existing) {
          check(existing.kind === "skill" && existing.imported && Number.isSafeInteger(spec.previousVersion) && existing.version === spec.previousVersion,
            "ACTION_CONFLICT", `技能 ${value.id} 在提案生成后已变化，请重新生成安装提案。`, 409);
        } else {
          const taken = (() => { try { return this.skillExists ? this.skillExists(value.id) : false; } catch { return false; } })();
          check(!taken, "INVALID_INPUT", `技能 ${value.id} 与内置技能重名，未安装。`);
        }
        const ext = this.save({ id: existing?.id || null, kind: "skill", spec, source: { via: "import", url: value.origin.url, proposalId: action.id, reason: action.payload.reason } });
        appliedIds.push(ext.id);
      }
      return { kind: "skill", ids: appliedIds, extensions: appliedIds.map((id) => this.row(id)) };
    } catch (error) {
      for (const id of appliedIds) this.restoreSkill(id);
      throw error;
    }
  }
  async stageImport({ url, select }) {
    check(typeof url === "string" && url.trim(), "INVALID_INPUT", "请提供 GitHub 仓库或 tar.gz 压缩包地址");
    const chosen = [...new Set((Array.isArray(select) ? select : []).map((id) => string(id, "技能名", 80)))];
    return this.importer({
      url,
      select: chosen,
      skillExists: (id) => { try { return this.skillExists ? this.skillExists(id) : false; } catch { return false; } },
      lookupExtension: (id) => this.findImported(id),
      ...(this.proxyResolver ? { resolveProxy: this.proxyResolver } : {}),
    });
  }
  findImported(id) {
    try { return this.row(id); } catch (error) {
      if (error.code === "NOT_FOUND") return null;
      throw error;
    }
  }
  remove(id) {
    const ext = this.row(id);
    check(ext.kind === "skill", "INVALID_INPUT", "规则不能删除，只能停用");
    return sqliteTransaction(this.db, () => {
      this.db.prepare("DELETE FROM extension_versions WHERE extension_id=?").run(ext.id);
      this.db.prepare("DELETE FROM extensions WHERE id=?").run(ext.id);
      this.removeSkill(ext.id);
      this.store.audit(null, "extension.deleted", { id: ext.id, via: ext.source?.via, imported: Boolean(ext.imported) });
      return { ok: true, id: ext.id };
    });
  }
}
