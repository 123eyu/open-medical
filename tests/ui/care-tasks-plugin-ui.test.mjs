import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";
import { resolveCommunicationTab } from "../../src/patient-tabs.js";

async function load() {
  const vite = await createViteServer({
    appType: "custom",
    // Server-side rendering only: skip browser dependency pre-bundling, which
    // leaves a temp copy in node_modules/.vite each time the server closes.
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  return {
    vite,
    slots: await vite.ssrLoadModule("/src/plugin-slots.jsx"),
    plugin: (await vite.ssrLoadModule("/plugins/care-tasks/ui/index.jsx"))
      .default,
  };
}

function Tabs() {
  const slots = globalThis.__careSlots;
  const tabs = slots.mergePatientTabs(slots.useActiveSlot("patient.tabs"), {
    area: "communication",
    builtin: [["appointments", "复诊预约", 20]],
  });
  return createElement(
    "div",
    null,
    tabs.map((tab) =>
      createElement("span", { key: tab.key, "data-key": tab.key }, tab.label),
    ),
  );
}

test("care-tasks：启用时贡献检查与转诊 tab，停用后消失", async (t) => {
  const { vite, slots, plugin } = await load();
  t.after(() => vite.close());
  globalThis.__careSlots = slots;

  const tab = plugin.slots["patient.tabs"][0];
  assert.equal(tab.id, "tracking");
  assert.equal(tab.label, "检查与转诊");
  assert.equal(tab.order, 40);
  assert.equal(tab.area, "communication");
  assert.equal(tab.legacyTab, "tracking");
  assert.equal(tab.replacesBuiltin, true);

  slots.registerUiPlugins({ "care-tasks": plugin }, ["care-tasks"]);
  let html = renderToStaticMarkup(createElement(Tabs));
  assert.match(html, /data-key="appointments"[^>]*>复诊预约</);
  assert.match(html, /data-key="tracking"[^>]*>检查与转诊</);
  let keys = [...html.matchAll(/data-key="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, ["appointments", "tracking"]);

  slots.registerUiPlugins({ "care-tasks": plugin }, [], []);
  html = renderToStaticMarkup(createElement(Tabs));
  assert.doesNotMatch(html, /data-key="tracking"/);
  keys = [...html.matchAll(/data-key="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, ["appointments"]);
  assert.equal(
    resolveCommunicationTab([{ key: "appointments" }], "tracking"),
    "appointments",
    "停用后旧的 tracking 跳转应落到仍存在的沟通 tab",
  );
});
