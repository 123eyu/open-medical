// Deferred tool groups: a domain can keep rarely needed tools out of the
// model's tool list until they are wanted. Keeping the list short saves tokens
// on every request and makes tool choice easier.
//
// Cache-friendly by design: groups are only ever added within a session
// (persisted by the caller), never removed, so the request prefix changes at
// most once per group.
//
// spec = { groups: [{ id, title, summary, names }], enabled: Set<groupId> }
export function applyDeferredTools(registry, spec, { persist = () => {} } = {}) {
  const hiddenGroups = [];
  for (const group of spec?.groups || []) {
    const present = group.names.filter((name) => registry.has(name));
    if (!present.length) continue;
    for (const name of present) registry.groupOf.set(name, group.id);
    if (spec.enabled?.has(group.id)) continue;
    for (const name of present) registry.hidden.add(name);
    hiddenGroups.push(group);
  }
  registry.onReveal = (groupId) => persist(groupId);
  if (!hiddenGroups.length) return [];
  registry.register({
    permission: "tools.execute",
    capability: { backend: "local" },
    definition: {
      type: "function",
      function: {
        name: "enable_tools",
        description:
          "开启默认未列出的工具组，开启后本会话一直可用，下一轮起可直接调用。可开启：" +
          hiddenGroups.map((group) => `${group.id}（${group.title}：${group.summary}）`).join("；") +
          "。只在任务确实需要时开启。",
        parameters: {
          type: "object",
          properties: { group: { type: "string", enum: hiddenGroups.map((group) => group.id) } },
          required: ["group"],
          additionalProperties: false,
        },
      },
    },
    execute: ({ group }) => ({
      enabled: group,
      tools: registry.reveal(group),
      note: "已开启，下一轮起这些工具会出现在可用工具中。",
    }),
  });
  return hiddenGroups;
}
