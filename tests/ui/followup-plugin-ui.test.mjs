import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";
import { resolveCommunicationTab } from "../../src/patient-tabs.js";

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
  };
}

function tabsHarness(slots) {
  return function Tabs() {
    const contributions = slots.useSlot("patient.tabs");
    const tabs = slots.mergePatientTabs(contributions, {
      area: "communication",
      builtin: [["appointments", "复诊预约", 20]],
    });
    return createElement(
      "div",
      null,
      tabs.map((tab) =>
        createElement(
          "span",
          { key: tab.key, "data-key": tab.key },
          slots.patientTabLabel(tab, {
            counts: { unprocessedMessages: 3 },
          }),
        ),
      ),
    );
  };
}


function fallbackHarness(slots) {
  return function Fallback() {
    const contributions = slots.useSlot("patient.tabs");
    const tabs = slots.mergePatientTabs(contributions, {
      area: "communication",
      builtin: [["appointments", "复诊预约", 20]],
    });
    return createElement("span", {
      "data-first-message": resolveCommunicationTab(tabs, "messages"),
      "data-first-followup": resolveCommunicationTab(tabs, "followups"),
    });
  };
}

test("followup 启用时贡献消息/随访 tab，legacyTab 保持旧 URL id", async (t) => {
  const { vite, slots, plugin } = await load();
  t.after(() => vite.close());

  slots.registerUiPlugins({ followup: plugin }, ["followup"]);
  const html = renderToStaticMarkup(createElement(tabsHarness(slots)));

  assert.match(html, /data-key="messages"[^>]*>消息记录 · 3 待整理</);
  assert.match(html, /data-key="appointments"[^>]*>复诊预约</);
  assert.match(html, /data-key="followups"[^>]*>随访计划</);

  const keys = [...html.matchAll(/data-key="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(keys, ["messages", "appointments", "followups"]);

  const fallback = renderToStaticMarkup(createElement(fallbackHarness(slots)));
  assert.match(fallback, /data-first-message="messages"/);
  assert.match(fallback, /data-first-followup="followups"/);

  const messages = plugin.slots["patient.tabs"].find((tab) => tab.id === "messages");
  const followups = plugin.slots["patient.tabs"].find((tab) => tab.id === "followups");
  assert.equal(messages.legacyTab, "messages");
  assert.equal(messages.area, "communication");
  assert.equal(messages.replacesBuiltin, true);
  assert.equal(slots.patientTabKey(messages), "messages");
  assert.equal(followups.legacyTab, "followups");
  assert.equal(slots.patientTabKey(followups), "followups");
  assert.equal(
    plugin.slots["settings.panels"][0].legacyTab,
    "followup",
  );
});

test("followup 停用时消息/随访 tab 与设置面板都不出现", async (t) => {
  const { vite, slots, plugin } = await load();
  t.after(() => vite.close());

  slots.registerUiPlugins({ followup: plugin }, []);
  const html = renderToStaticMarkup(createElement(tabsHarness(slots)));

  assert.doesNotMatch(html, /data-key="messages"/);
  assert.doesNotMatch(html, /data-key="followups"/);
  assert.match(html, /data-key="appointments"/);
  const keys = [...html.matchAll(/data-key="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(keys, ["appointments"]);

  const fallback = renderToStaticMarkup(createElement(fallbackHarness(slots)));
  assert.match(fallback, /data-first-message="appointments"/);
  assert.match(fallback, /data-first-followup="appointments"/);

  function Panels() {
    const panels = slots.useSlot("settings.panels");
    return createElement(
      "div",
      null,
      panels.map((panel) => createElement("span", { key: panel.id }, panel.id)),
    );
  }
  assert.doesNotMatch(renderToStaticMarkup(createElement(Panels)), /followup/);
});
