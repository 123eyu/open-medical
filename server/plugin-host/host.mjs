import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "../errors.mjs";
import { sqliteTransaction } from "../sqlite-transaction.mjs";
import { definePlugin } from "./define.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const DEFAULT_PLUGIN_DIRS = [resolve(ROOT, "plugins")];

const IDENT = [
  '"([^"]+)"',
  "'([^']+)'",
  "`([^`]+)`",
  "\\[([^\\]]+)\\]",
  "([A-Za-z_][A-Za-z0-9_$]*)",
].join("|");

const stripSqlComments = (sql) =>
  String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");

const firstIdentifier = (match, from = 1) =>
  match.slice(from).find((value) => value !== undefined);

// Migrations may only create/alter tables under the plugin's own prefix. The
// parser is deliberately conservative (CREATE TABLE / ALTER TABLE / CREATE
// INDEX ... ON) and accepts quoted identifiers; it is not a full SQL parser.
export function validateMigrationSql(sql, tablePrefix) {
  check(
    typeof tablePrefix === "string" && tablePrefix,
    "PLUGIN_MIGRATION",
    "插件迁移缺少 tablePrefix",
  );
  const source = stripSqlComments(sql);
  const names = [];
  const createTable = new RegExp(
    `\\bCREATE\\s+(?:TEMP(?:ORARY)?\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:${IDENT})`,
    "gi",
  );
  for (const match of source.matchAll(createTable))
    names.push({ statement: "CREATE TABLE", name: firstIdentifier(match) });

  const alterTable = new RegExp(
    `\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:${IDENT})`,
    "gi",
  );
  for (const match of source.matchAll(alterTable))
    names.push({ statement: "ALTER TABLE", name: firstIdentifier(match) });

  const createIndex = new RegExp(
    `\\bCREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:${IDENT})\\s+ON\\s+(?:${IDENT})`,
    "gi",
  );
  for (const match of source.matchAll(createIndex))
    names.push({
      statement: "CREATE INDEX",
      name: firstIdentifier(match, 6),
    });

  for (const { statement, name } of names) {
    check(
      typeof name === "string" && name.startsWith(tablePrefix),
      "PLUGIN_MIGRATION",
      `${statement} 的表名 ${name || "(无法识别)"} 必须以 ${tablePrefix} 开头`,
    );
  }
  return names.map((item) => item.name);
}

const errorMessage = (error) =>
  String(error?.message || error || "未知错误").slice(0, 1000);

export class PluginHost {
  constructor({
    db,
    store = null,
    services = {},
    pluginDirs,
    enabled = {},
  } = {}) {
    check(db, "PLUGIN_HOST", "PluginHost 需要数据库连接");
    this.db = db;
    this.store = store;
    this.baseServices = services;
    const dirs = Array.isArray(pluginDirs)
      ? pluginDirs
      : pluginDirs
        ? [pluginDirs]
        : DEFAULT_PLUGIN_DIRS;
    this.pluginDirs = dirs.map((dir) => resolve(dir));
    this.initialEnabled = enabled || {};
    this.records = [];
    this.ordered = [];
    this.byId = new Map();
    this.pluginServices = {};
    this.listeners = new Map();
    this.loaded = false;
    this._ensureTables();
  }

  _ensureTables() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS plugin_state (
      plugin_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plugin_migrations (
      plugin_id TEXT NOT NULL,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      PRIMARY KEY(plugin_id, name)
    );
    CREATE TABLE IF NOT EXISTS plugin_config (
      plugin_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(plugin_id, key)
    );`);
  }

  _stateEnabled(spec) {
    const row = this.db
      .prepare("SELECT enabled FROM plugin_state WHERE plugin_id=?")
      .get(spec.id);
    if (row) return row.enabled === 1;
    if (Object.hasOwn(this.initialEnabled, spec.id))
      return this.initialEnabled[spec.id] === true;
    return spec.enabledByDefault;
  }

  load() {
    this.records = [];
    this.ordered = [];
    this.byId = new Map();
    this.pluginServices = {};
    this.listeners = new Map();
    for (const directory of this.pluginDirs) {
      if (!existsSync(directory) || !statSync(directory).isDirectory()) continue;
      // A pluginDir may be either a plugins/ container or one plugin folder;
      // supporting both keeps fixtures and production wiring identical.
      const candidates = [];
      if (existsSync(join(directory, "plugin.mjs")))
        candidates.push({ name: basename(directory), dir: directory });
      else {
        const entries = readdirSync(directory, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          const pluginDir = join(directory, entry.name);
          if (existsSync(join(pluginDir, "plugin.mjs")))
            candidates.push({ name: entry.name, dir: pluginDir });
        }
      }
      for (const entry of candidates) {
        const pluginDir = entry.dir;
        const pluginFile = join(pluginDir, "plugin.mjs");
        const record = {
          id: entry.name,
          dir: pluginDir,
          spec: null,
          enabled: false,
          available: false,
          reason: "",
          promptText: "",
        };
        try {
          const loaded = require(pluginFile);
          const raw = loaded?.default ?? loaded;
          const spec = definePlugin(raw);
          record.id = spec.id;
          record.spec = spec;
          record.enabled = this._stateEnabled(spec);
          if (this.byId.has(spec.id)) {
            record.reason = `插件 id 重复：${spec.id}`;
          } else {
            if (spec.prompt) {
              const promptFile = resolve(pluginDir, spec.prompt);
              check(
                existsSync(promptFile) && statSync(promptFile).isFile(),
                "PLUGIN_PROMPT",
                `提示文件不存在：${spec.prompt}`,
              );
              record.promptText = readFileSync(promptFile, "utf8");
            }
            if (spec.skills) {
              const skillsDir = resolve(pluginDir, spec.skills);
              check(
                existsSync(skillsDir) && statSync(skillsDir).isDirectory(),
                "PLUGIN_SKILLS",
                `技能目录不存在：${spec.skills}`,
              );
            }
            if (spec.migrations) {
              const migrationDir = resolve(pluginDir, spec.migrations);
              check(
                existsSync(migrationDir) && statSync(migrationDir).isDirectory(),
                "PLUGIN_MIGRATION",
                `迁移目录不存在：${spec.migrations}`,
              );
            }
            record.available = true;
          }
        } catch (error) {
          record.available = false;
          record.reason = `加载失败：${errorMessage(error)}`;
        }
        this.records.push(record);
        if (record.spec && !this.byId.has(record.id))
          this.byId.set(record.id, record);
      }
    }
    this._resolveDependencies();
    this._order();
    this.loaded = true;
    return this.list();
  }

  _resolveDependencies() {
    const resolveRecord = (record, trail) => {
      if (record._resolved !== undefined) return record._resolved;
      if (!record.available) {
        record._resolved = false;
        return false;
      }
      if (record._visiting) {
        record.available = false;
        record.reason = `依赖存在环：${[...trail, record.id].join(" -> ")}`;
        record._resolved = false;
        return false;
      }
      record._visiting = true;
      let failure = "";
      if (record.enabled && record.spec) {
        for (const [dependency, range] of Object.entries(
          record.spec.requires.plugins,
        )) {
          const target = this.byId.get(dependency);
          if (!target) {
            failure = `缺少依赖插件 ${dependency}${range ? `@${range}` : ""}`;
            break;
          }
          if (!target.enabled) {
            failure = `依赖插件 ${dependency} 未启用`;
            break;
          }
          if (!resolveRecord(target, [...trail, record.id])) {
            failure = `依赖插件 ${dependency} 不可用`;
            break;
          }
        }
        if (!failure) {
          for (const group of record.spec.requires.anyOf) {
            const satisfied = group.some((dependency) => {
              const target = this.byId.get(dependency);
              return Boolean(
                target &&
                  target.enabled &&
                  resolveRecord(target, [...trail, record.id]),
              );
            });
            if (!satisfied) {
              failure = `需要启用以下插件之一：${group.join(" / ")}`;
              break;
            }
          }
        }
      }
      record._visiting = false;
      if (failure) {
        record.available = false;
        record.reason = failure;
      }
      record._resolved = record.available;
      return record._resolved;
    };
    for (const record of this.records) resolveRecord(record, []);
    for (const record of this.records) delete record._resolved;
  }

  _order() {
    const ordered = [];
    const seen = new Set();
    const visit = (record) => {
      if (seen.has(record.id)) return;
      seen.add(record.id);
      if (record.enabled && record.spec) {
        for (const dependency of Object.keys(record.spec.requires.plugins)) {
          const target = this.byId.get(dependency);
          if (target) visit(target);
        }
      }
      ordered.push(record);
    };
    for (const record of [...this.records].sort((a, b) =>
      a.id.localeCompare(b.id),
    ))
      visit(record);
    this.ordered = ordered;
  }

  _fail(record, reason) {
    record.available = false;
    record.reason = reason;
    if (record.spec) delete this.pluginServices[record.spec.id];
  }

  migrate() {
    for (const record of this.ordered) {
      if (!record.available || !record.spec?.migrations) continue;
      const spec = record.spec;
      try {
        const migrationDir = resolve(record.dir, spec.migrations);
        const files = readdirSync(migrationDir)
          .filter((name) => name.endsWith(".sql"))
          .sort((a, b) => a.localeCompare(b));
        for (const name of files) {
          const applied = this.db
            .prepare(
              "SELECT 1 FROM plugin_migrations WHERE plugin_id=? AND name=?",
            )
            .get(spec.id, name);
          if (applied) continue;
          const sql = readFileSync(join(migrationDir, name), "utf8");
          validateMigrationSql(sql, spec.tablePrefix);
          sqliteTransaction(this.db, () => {
            this.db.exec(sql);
            this.db
              .prepare(
                "INSERT INTO plugin_migrations(plugin_id,name,applied_at) VALUES (?,?,?)",
              )
              .run(spec.id, name, new Date().toISOString());
          });
        }
      } catch (error) {
        this._fail(record, `迁移失败：${errorMessage(error)}`);
      }
    }
  }

  setup() {
    for (const record of this.ordered) {
      if (!record.available || !record.spec) continue;
      if (record.enabled) {
        const missing = Object.keys(record.spec.requires.plugins).find(
          (dependency) => {
            const target = this.byId.get(dependency);
            return !target || !target.enabled || !target.available;
          },
        );
        if (missing) {
          this._fail(record, `依赖插件 ${missing} 不可用`);
          continue;
        }
        const unsatisfied = record.spec.requires.anyOf.find(
          (group) =>
            !group.some((dependency) => {
              const target = this.byId.get(dependency);
              return target && target.enabled && target.available;
            }),
        );
        if (unsatisfied) {
          this._fail(
            record,
            `需要启用以下插件之一：${unsatisfied.join(" / ")}`,
          );
          continue;
        }
      }
      try {
        const service = record.spec.setup
          ? record.spec.setup(this.contextFor(record))
          : undefined;
        if (service !== undefined)
          this.pluginServices[record.spec.id] = service;
        if (record.spec.events)
          for (const [name, listener] of Object.entries(record.spec.events)) {
            const list = this.listeners.get(name) || [];
            list.push((payload) =>
              listener(payload, this.contextFor(record)),
            );
            this.listeners.set(name, list);
          }
      } catch (error) {
        this._fail(record, `初始化失败：${errorMessage(error)}`);
      }
    }
    return this.list();
  }

  _services() {
    return { ...this.baseServices, ...this.pluginServices };
  }

  contextFor(record) {
    const appendReason = (error) => {
      this._fail(record, `运行时错误：${errorMessage(error)}`);
    };
    return Object.freeze({
      db: this.db,
      store: this.store,
      services: this._services(),
      events: Object.freeze({
        emit: (name, payload) => this.emit(name, payload),
        on: (name, listener) => this.on(name, listener),
      }),
      now: () => new Date().toISOString(),
      log: (...args) => console.log(`[plugin:${record.id}]`, ...args),
      config: Object.freeze({
        get: (key) => this.getConfig(record.id, key),
        set: (key, value) => this.setConfig(record.id, key, value),
      }),
      proposals: Object.freeze({
        create: (proposal) => this.createProposal(record, proposal),
      }),
      plugin: Object.freeze({ id: record.id, dir: record.dir }),
      fail: appendReason,
    });
  }

  getConfig(pluginId, key) {
    const row = this.db
      .prepare("SELECT value FROM plugin_config WHERE plugin_id=? AND key=?")
      .get(pluginId, String(key));
    if (!row) return undefined;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  }

  setConfig(pluginId, key, value) {
    this.db
      .prepare(
        `INSERT INTO plugin_config(plugin_id,key,value,updated_at) VALUES (?,?,?,?)
         ON CONFLICT(plugin_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
      )
      .run(pluginId, String(key), JSON.stringify(value), new Date().toISOString());
    return value;
  }

  createProposal(record, { kind, patientId, input, summary } = {}) {
    check(
      record?.spec?.proposals?.[kind],
      "PLUGIN_PROPOSAL",
      `插件 ${record?.id || ""} 未定义提案类型 ${kind || ""}`,
    );
    const pending = this.baseServices.pending;
    check(
      pending && typeof pending.propose === "function",
      "PLUGIN_PENDING_UNAVAILABLE",
      "提案机制不可用",
      503,
    );
    return pending.propose({
      type: kind,
      patientId,
      payload: { input },
      summary: summary || `${record.spec.title}提案`,
    });
  }

  emit(name, payload) {
    for (const listener of this.listeners.get(name) || []) {
      try {
        listener(payload);
      } catch (error) {
        console.error(`插件事件 ${name} 处理失败:`, error);
      }
    }
  }

  on(name, listener) {
    check(typeof listener === "function", "PLUGIN_EVENT", "事件监听器必须是函数");
    const list = this.listeners.get(name) || [];
    list.push(listener);
    this.listeners.set(name, list);
    return () => {
      const current = this.listeners.get(name) || [];
      this.listeners.set(
        name,
        current.filter((item) => item !== listener),
      );
    };
  }

  registerTools(registry, workspace, run = null) {
    for (const record of this.ordered) {
      if (!record.available || !record.enabled || !record.spec?.tools) continue;
      try {
        const result = record.spec.tools(this.contextFor(record), {
          registry,
          workspace,
          run,
        });
        if (result && typeof result.catch === "function")
          result.catch((error) =>
            this._fail(record, `工具注册失败：${errorMessage(error)}`),
          );
      } catch (error) {
        this._fail(record, `工具注册失败：${errorMessage(error)}`);
      }
    }
  }

  promptFragments() {
    return this.ordered
      .filter(
        (record) =>
          record.available && record.enabled && record.promptText.trim(),
      )
      .map((record) => record.promptText.trim())
      .join("\n\n");
  }

  skillDirs() {
    return this.ordered
      .filter(
        (record) =>
          record.available && record.enabled && record.spec?.skills,
      )
      .map((record) => resolve(record.dir, record.spec.skills))
      .filter((dir) => existsSync(dir) && statSync(dir).isDirectory());
  }

  proposalHandler(kind) {
    if (typeof kind !== "string") return null;
    for (const record of this.ordered) {
      if (!record.available || !record.enabled) continue;
      const handler = record.spec?.proposals?.[kind];
      if (!handler) continue;
      return {
        pluginId: record.id,
        validate: (input) =>
          handler.validate
            ? handler.validate(input, this.contextFor(record))
            : input,
        apply: (input, tx) =>
          handler.apply(
            input,
            this.contextFor(record),
            tx ?? this.db,
          ),
      };
    }
    return null;
  }

  // Workflow hooks are only exposed while the owning plugin is enabled. The
  // returned object carries the plugin context so callers can invoke
  // configure(ctx, { registry, workspace, run }) exactly as plugins declare it.
  workflow(id) {
    for (const record of this.ordered) {
      if (!record.available || !record.enabled || !record.spec) continue;
      const hooks = record.spec.workflows?.[id];
      if (!hooks) continue;
      return Object.freeze({
        id,
        pluginId: record.id,
        artifactType: hooks.artifactType,
        ctx: this.contextFor(record),
        detect: hooks.detect,
        applyPolicy: hooks.applyPolicy,
        guidance: hooks.guidance,
        configure: hooks.configure,
        prepared: hooks.prepared,
        answer: hooks.answer,
      });
    }
    return null;
  }

  // Detection is intentionally available for disabled plugins so a request can
  // fail with PLUGIN_UNAVAILABLE instead of silently running the wrong
  // workflow. Callers must use workflow(id) before invoking any hook.
  matchWorkflow(message, policy) {
    for (const record of this.ordered) {
      if (!record.spec?.workflows) continue;
      for (const [id, hooks] of Object.entries(record.spec.workflows)) {
        if (!hooks.detect) continue;
        let matched = false;
        try {
          matched = hooks.detect(message, policy) === true;
        } catch (error) {
          this._fail(record, `工作流检测失败：${errorMessage(error)}`);
        }
        if (matched)
          return {
            id,
            pluginId: record.id,
            enabled: record.enabled && record.available,
            available: record.available,
            workflow: record.enabled && record.available ? this.workflow(id) : null,
          };
      }
    }
    return null;
  }

  // Metadata for the agenda shell: only enabled, available plugin sources are
  // advertised, so a kind filter can be validated against the same set the
  // reader will actually use.
  agendaSources() {
    const sources = [];
    for (const record of this.ordered) {
      if (!record.available || !record.enabled || !record.spec) continue;
      for (const source of record.spec.agendaSources)
        sources.push({
          pluginId: record.id,
          kind: source.kind,
          label: source.label,
          order: source.order,
        });
    }
    return sources.sort(
      (a, b) =>
        a.order - b.order ||
        a.pluginId.localeCompare(b.pluginId) ||
        a.kind.localeCompare(b.kind),
    );
  }

  agendaItems({
    now = new Date().toISOString(),
    patientId,
    onError,
  } = {}) {
    const items = [];
    for (const record of this.ordered) {
      if (!record.available || !record.enabled || !record.spec) continue;
      for (const source of record.spec.agendaSources) {
        try {
          const result = source.read(this.contextFor(record), {
            now,
            patientId,
          });
          if (Array.isArray(result))
            for (const item of result)
              if (item && typeof item === "object")
                items.push({
                  ...item,
                  kind: item.kind || source.kind,
                  pluginId: record.id,
                });
        } catch (error) {
          console.error(`插件 ${record.id} 待办来源失败:`, error);
          if (typeof onError === "function")
            try {
              onError({
                kind: source.kind,
                pluginId: record.id,
                message: errorMessage(error),
              });
            } catch {
              // A reporting callback must never break the remaining sources.
            }
        }
      }
    }
    return items;
  }

  async handleApi(req, url, io) {
    if (!url.pathname.startsWith("/api/p/")) return false;
    const parts = url.pathname.split("/").filter(Boolean);
    const id = parts[2];
    const record = id ? this.byId.get(id) : null;
    const prefix = id ? `/api/p/${id}/` : null;
    if (
      !record ||
      !record.available ||
      !record.enabled ||
      !record.spec?.api ||
      !url.pathname.startsWith(prefix)
    ) {
      io.send(404, {
        error: "插件不存在或未启用",
        code: "NOT_FOUND",
      });
      return true;
    }
    try {
      const handled = await record.spec.api(
        this.contextFor(record),
        req,
        url,
        io,
      );
      if (handled !== true)
        io.send(404, { error: "插件接口不存在", code: "NOT_FOUND" });
    } catch (error) {
      if (io.error) io.error(error);
      else
        io.send(Number.isInteger(error?.status) ? error.status : 500, {
          error: errorMessage(error),
          code: error?.code || "PLUGIN_API_ERROR",
        });
    }
    return true;
  }

  setEnabled(id, enabled) {
    check(typeof enabled === "boolean", "INVALID_INPUT", "enabled 必须是布尔值");
    const record = this.byId.get(id);
    check(record, "NOT_FOUND", "插件不存在", 404);
    const time = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO plugin_state(plugin_id,enabled,updated_at) VALUES (?,?,?)
         ON CONFLICT(plugin_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at`,
      )
      .run(id, enabled ? 1 : 0, time);
    record.enabled = enabled;
    return this.list().find((item) => item.id === id);
  }

  list() {
    return this.ordered
      .filter((record) => record.spec || record.reason)
      .map((record) => {
        const spec = record.spec;
        return {
          id: record.id,
          title: spec?.title || record.id,
          version: spec?.version || "0.0.0",
          enabled: record.enabled,
          status: !record.available
            ? "unavailable"
            : record.enabled
              ? "ready"
              : "disabled",
          reason: record.reason,
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}
