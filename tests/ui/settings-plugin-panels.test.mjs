import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createViteServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Browser-free coverage for the settings shell contract that the screenshot
// baseline depends on: plugin panels contribute order and legacyTab data, and
// a deep link must land on the panel before its lazy chunk has loaded.
test("设置：消息渠道子页签顺序与插件声明一致", async (t) => {
  const vite = await createViteServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  t.after(() => vite.close());
  const settings = await vite.ssrLoadModule("/src/app-settings.jsx");
  const slots = await vite.ssrLoadModule("/src/plugin-slots.jsx");
  const panelOf = async (path) => {
    const definition = (await vite.ssrLoadModule(path)).default;
    const panel = definition.slots["settings.panels"][0];
    return {
      pluginId: definition.id,
      id: panel.id,
      label: panel.label,
      order: panel.order,
      legacyTab: panel.legacyTab,
    };
  };
  const panels = [
    await panelOf("/plugins/channel/ui/index.jsx"),
    await panelOf("/plugins/feishu-knowledge-bot/ui/index.jsx"),
    await panelOf("/plugins/doctor-notifications/ui/index.jsx"),
    await panelOf("/plugins/followup/ui/index.jsx"),
  ];
  assert.deepEqual(
    settings.mergeChannelSections(panels).map(([id]) => id),
    ["channels", "knowledge-bot", "notifications", "followup"],
  );

  // The lazy panel has a stable legacyTab mapping at any load stage.
  assert.deepEqual(
    settings.mergeChannelSections([]).map(([id]) => id),
    ["channels"],
  );
  assert.deepEqual(
    settings
      .mergeChannelSections([
        ...panels,
        { pluginId: "learning", legacyTab: "workbench", label: "自动化规则", order: 10 },
        { pluginId: "learning", legacyTab: "learning", label: "学习与记忆", order: 20 },
      ])
      .map(([id]) => id),
    ["channels", "knowledge-bot", "notifications", "followup"],
    "技能与规则面板不能混入消息渠道子页签",
  );
  assert.equal(
    settings.resolveSettingsSection("knowledge-bot", []),
    "general",
    "面板未注册时回到通用设置，注册后由同一原始请求重新解析",
  );
  assert.equal(
    settings.resolveSettingsSection("knowledge-bot", panels),
    "knowledge-bot",
  );
  assert.equal(
    slots.findSettingsPanel(panels, "knowledge-bot")?.pluginId,
    "feishu-knowledge-bot",
  );

  // Register the real UI modules the shell loads. This catches a panel that
  // declares legacyTab but never reaches the active slot (the deep-link bug).
  const registry = await vite.ssrLoadModule("/src/plugin-registry.js");
  const modules = await registry.loadUiPluginModules();
  const ids = Object.values(modules)
    .map((module) => (module.default ?? module)?.id)
    .filter(Boolean);
  slots.registerUiPlugins(modules, ids, ids);
  let registered = [];
  function CapturePanels() {
    registered = slots.useActiveSlot("settings.panels");
    return null;
  }
  renderToStaticMarkup(createElement(CapturePanels));
  assert.equal(
    settings.resolveSettingsSection("knowledge-bot", registered),
    "knowledge-bot",
    "设置页懒加载完成后，settingsTab=knowledge-bot 必须落到插件面板",
  );
  assert.equal(
    slots.findSettingsPanel(registered, "knowledge-bot")?.pluginId,
    "feishu-knowledge-bot",
  );
});
