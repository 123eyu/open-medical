import { check } from "../errors.mjs";

const PLUGIN_ID = /^[a-z][a-z0-9-]{1,39}$/;
const TABLE_PREFIX = /^[a-z][a-z0-9_]{0,39}$/;

const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

// Domain plugins describe server-side capabilities only: data migrations,
// Agent tools, prompts/skills, proposals, agenda sources and an HTTP handler.
// The host owns lifecycle; definePlugin only validates and freezes the spec so
// a broken plugin cannot mutate its own declaration after loading.
export function definePlugin(spec = {}) {
  check(isObject(spec), "PLUGIN_SPEC", "插件定义必须是对象");
  const {
    id,
    version,
    title,
    requires = {},
    enabledByDefault = true,
    migrations,
    tablePrefix,
    legacyTables = [],
    setup,
    tools,
    prompt,
    skills,
    proposals = {},
    agendaSources = [],
    api,
    events = {},
  } = spec;

  check(
    typeof id === "string" && PLUGIN_ID.test(id),
    "PLUGIN_SPEC",
    "插件 id 必须匹配 /^[a-z][a-z0-9-]{1,39}$/",
  );
  check(
    typeof version === "string" && version.trim(),
    "PLUGIN_SPEC",
    `插件 ${id} 缺少 version`,
  );
  check(
    typeof title === "string" && title.trim(),
    "PLUGIN_SPEC",
    `插件 ${id} 缺少 title`,
  );
  check(
    typeof enabledByDefault === "boolean",
    "PLUGIN_SPEC",
    `插件 ${id} 的 enabledByDefault 必须是布尔值`,
  );
  check(isObject(requires), "PLUGIN_SPEC", `插件 ${id} 的 requires 必须是对象`);
  const requiredPlugins = requires.plugins ?? {};
  check(
    isObject(requiredPlugins) &&
      Object.entries(requiredPlugins).every(
        ([key, value]) => PLUGIN_ID.test(key) && typeof value === "string",
      ),
    "PLUGIN_SPEC",
    `插件 ${id} 的 requires.plugins 必须是 { 插件id: 版本范围 }`,
  );
  const anyOf = requires.anyOf ?? [];
  check(
    Array.isArray(anyOf) &&
      anyOf.every(
        (group) =>
          Array.isArray(group) &&
          group.length > 0 &&
          group.every((key) => typeof key === "string" && PLUGIN_ID.test(key)),
      ),
    "PLUGIN_SPEC",
    `插件 ${id} 的 requires.anyOf 必须是插件 id 分组数组`,
  );

  check(
    migrations === undefined ||
      (typeof migrations === "string" && migrations.trim()),
    "PLUGIN_SPEC",
    `插件 ${id} 的 migrations 必须是相对路径`,
  );
  if (migrations) {
    check(
      typeof tablePrefix === "string" && TABLE_PREFIX.test(tablePrefix),
      "PLUGIN_SPEC",
      `插件 ${id} 有 migrations 时必须提供合法的 tablePrefix`,
    );
  } else {
    check(
      tablePrefix === undefined ||
        (typeof tablePrefix === "string" && TABLE_PREFIX.test(tablePrefix)),
      "PLUGIN_SPEC",
      `插件 ${id} 的 tablePrefix 无效`,
    );
  }
  check(
    Array.isArray(legacyTables) &&
      legacyTables.every((name) => typeof name === "string" && name.trim()),
    "PLUGIN_SPEC",
    `插件 ${id} 的 legacyTables 必须是表名数组`,
  );
  for (const [field, value] of [
    ["setup", setup],
    ["tools", tools],
    ["api", api],
  ]) {
    check(
      value === undefined || typeof value === "function",
      "PLUGIN_SPEC",
      `插件 ${id} 的 ${field} 必须是函数`,
    );
  }
  for (const [field, value] of [
    ["prompt", prompt],
    ["skills", skills],
  ]) {
    check(
      value === undefined || (typeof value === "string" && value.trim()),
      "PLUGIN_SPEC",
      `插件 ${id} 的 ${field} 必须是相对路径`,
    );
  }
  check(
    isObject(proposals),
    "PLUGIN_SPEC",
    `插件 ${id} 的 proposals 必须是对象`,
  );
  const normalizedProposals = {};
  for (const [kind, handler] of Object.entries(proposals)) {
    check(
      kind.startsWith(`${id}.`) && kind.length > id.length + 1,
      "PLUGIN_SPEC",
      `插件 ${id} 的提案类型 ${kind} 必须以 "${id}." 开头`,
    );
    check(
      isObject(handler) && typeof handler.apply === "function",
      "PLUGIN_SPEC",
      `插件 ${id} 的提案类型 ${kind} 必须提供 apply`,
    );
    check(
      handler.validate === undefined || typeof handler.validate === "function",
      "PLUGIN_SPEC",
      `插件 ${id} 的提案类型 ${kind} 的 validate 必须是函数`,
    );
    normalizedProposals[kind] = Object.freeze({
      validate: handler.validate,
      apply: handler.apply,
    });
  }

  check(
    Array.isArray(agendaSources),
    "PLUGIN_SPEC",
    `插件 ${id} 的 agendaSources 必须是数组`,
  );
  const normalizedSources = agendaSources.map((source) => {
    check(
      isObject(source) &&
        typeof source.kind === "string" &&
        source.kind.trim() &&
        typeof source.read === "function",
      "PLUGIN_SPEC",
      `插件 ${id} 的 agendaSource 必须提供 kind 与 read`,
    );
    check(
      source.label === undefined || typeof source.label === "string",
      "PLUGIN_SPEC",
      `插件 ${id} 的 agendaSource label 必须是字符串`,
    );
    return Object.freeze({
      kind: source.kind,
      label: source.label ?? source.kind,
      read: source.read,
    });
  });

  check(isObject(events), "PLUGIN_SPEC", `插件 ${id} 的 events 必须是对象`);
  for (const [name, listener] of Object.entries(events))
    check(
      typeof listener === "function",
      "PLUGIN_SPEC",
      `插件 ${id} 的事件 ${name} 必须是函数`,
    );

  return Object.freeze({
    id,
    version,
    title,
    requires: Object.freeze({
      plugins: Object.freeze({ ...requiredPlugins }),
      anyOf: Object.freeze(anyOf.map((group) => Object.freeze([...group]))),
    }),
    enabledByDefault,
    migrations,
    tablePrefix,
    legacyTables: Object.freeze([...legacyTables]),
    setup,
    tools,
    prompt,
    skills,
    proposals: Object.freeze(normalizedProposals),
    agendaSources: Object.freeze(normalizedSources),
    api,
    events: Object.freeze({ ...events }),
  });
}
