import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

async function load() {
  const vite = await createViteServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  return {
    vite,
    slots: await vite.ssrLoadModule("/src/plugin-slots.jsx"),
    plugin: (await vite.ssrLoadModule("/plugins/followup/ui/index.jsx")).default,
    settings: await vite.ssrLoadModule("/src/app-settings.jsx"),
  };
}

function harness(slots) {
  function Tabs() {
    const tabs = slots.useActiveSlot("patient.tabs");
    const communication = slots.mergePatientTabs(tabs, {
      area: "communication",
      builtin: [["appointments", "复诊预约", 20]],
    });
    return createElement(
      "div",
      null,
      communication.map((item) =>
        createElement("span", { key: item.key, "data-key": item.key }, item.key),
      ),
    );
  }
  function Settings() {
    const panels = slots.useActiveSlot("settings.panels");
    return createElement(
      "div",
      null,
      panels.map((panel) =>
        createElement("span", { key: panel.id, "data-panel": panel.id }, panel.id),
      ),
    );
  }
  return createElement("div", null, createElement(Tabs), createElement(Settings));
}

test("patient tabs：followup 未激活时不渲染消息/随访 tab，但保留设置连接面板", async (t) => {
  const { vite, slots, plugin } = await load();
  t.after(() => vite.close());

  slots.registerUiPlugins({ followup: plugin }, ["followup"], []);
  const html = renderToStaticMarkup(harness(slots));

  assert.doesNotMatch(html, /data-key="messages"/);
  assert.doesNotMatch(html, /data-key="followups"/);
  assert.match(html, /data-key="appointments"/);
  const keys = [...html.matchAll(/data-key="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(keys, ["appointments"]);
  assert.match(html, /data-panel="followup"/, "连接渠道的设置面板必须保留");
});

test("dormant：settingsTab=followup 仍解析到患者随访连接面板", async (t) => {
  const { vite, slots, plugin, settings } = await load();
  t.after(() => vite.close());

  slots.registerUiPlugins({ followup: plugin }, ["followup"], []);
  let panels = [];
  function CapturePanels() {
    panels = slots.useActiveSlot("settings.panels");
    return null;
  }
  renderToStaticMarkup(createElement(CapturePanels));

  assert.equal(
    settings.resolveSettingsSection("followup", panels, { medical: true }),
    "followup",
  );
  assert.equal(
    slots.findSettingsPanel(panels, "followup")?.id,
    "followup",
  );
  // Before the lazy panel arrives the same request falls back to 模型与运行;
  // keeping the raw request lets the next render resolve it once registered.
  assert.equal(
    settings.resolveSettingsSection("followup", [], { medical: true }),
    "general",
  );
});

test("patient tabs：followup 激活后消息/随访 tab 恢复", async (t) => {
  const { vite, slots, plugin } = await load();
  t.after(() => vite.close());

  slots.registerUiPlugins({ followup: plugin }, ["followup"], ["followup"]);
  const html = renderToStaticMarkup(harness(slots));

  const keys = [...html.matchAll(/data-key="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(keys, ["messages", "appointments", "followups"]);
});
