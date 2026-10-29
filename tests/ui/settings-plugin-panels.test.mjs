import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createViteServer } from "vite";

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
  assert.equal(
    settings.resolveSettingsSection("knowledge-bot", []),
    "knowledge-bot",
    "懒加载前深链接也必须先落到知识库机器人",
  );
  assert.equal(
    settings.resolveSettingsSection("knowledge-bot", panels),
    "knowledge-bot",
  );
  assert.equal(
    slots.findSettingsPanel(panels, "knowledge-bot")?.pluginId,
    "feishu-knowledge-bot",
  );
});
