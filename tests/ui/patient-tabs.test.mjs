import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { createElement } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { createServer as createViteServer } from "vite";

function renderAsync(element) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const output = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    const timer = setTimeout(() => reject(new Error("SSR render timed out")), 5000);
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const stream = renderToPipeableStream(element, {
      onAllReady() {
        stream.pipe(output);
      },
      onShellError: finish,
      onError() {},
    });
    output.once("finish", () => finish());
    output.once("error", finish);
  });
}

async function load() {
  const vite = await createViteServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  return {
    vite,
    slots: await vite.ssrLoadModule("/src/plugin-slots.jsx"),
    navigation: await vite.ssrLoadModule("/src/navigation.js"),
  };
}

const View = ({ view }) => createElement("p", null, `插件视图:${view}`);

function definition(slots, contributions) {
  return slots.defineUiPlugin({
    id: "followup-ui",
    slots: contributions,
  });
}

test("patient.tabs 归一化 area/legacyTab/replacesBuiltin，并按 area 与固定 tab 合并", async (t) => {
  const { vite, slots } = await load();
  t.after(() => vite.close());

  const plugin = definition(slots, {
    "patient.tabs": [
      {
        id: "record-extra",
        label: "插件记录",
        order: 15,
        component: () => Promise.resolve({ default: View }),
      },
      {
        id: "followups",
        label: "随访计划",
        order: 30,
        area: "communication",
        legacyTab: "followups",
        component: () => Promise.resolve({ default: View }),
      },
      {
        id: "care",
        label: "关怀",
        order: 35,
        area: "communication",
        component: () => Promise.resolve({ default: View }),
      },
    ],
    "settings.panels": [
      {
        id: "followup",
        label: "患者随访",
        order: 30,
        legacyTab: "followup",
        component: () => Promise.resolve({ default: View }),
      },
    ],
    legacyViews: {
      followups: () => Promise.resolve({ default: View }),
    },
  });

  const [recordTab, legacyTab, careTab] = plugin.slots["patient.tabs"];
  assert.equal(recordTab.area, "record");
  assert.equal(recordTab.replacesBuiltin, false);
  assert.equal(slots.patientTabKey(recordTab), "p:followup-ui:record-extra");
  assert.equal(legacyTab.area, "communication");
  assert.equal(legacyTab.legacyTab, "followups");
  assert.equal(legacyTab.replacesBuiltin, true);
  assert.equal(slots.patientTabKey(legacyTab), "followups");
  assert.equal(slots.findPatientTab(plugin.slots["patient.tabs"], "followups"), legacyTab);
  assert.equal(
    slots.findPatientTab(plugin.slots["patient.tabs"], "p:followup-ui:care"),
    careTab,
  );

  const record = slots.mergePatientTabs(plugin.slots["patient.tabs"], {
    area: "record",
    builtin: [["overview", "概览"], ["diagnoses", "诊断与病史"]],
  });
  assert.deepEqual(record.map((item) => item.key), [
    "overview",
    "p:followup-ui:record-extra",
    "diagnoses",
  ]);

  const communication = slots.mergePatientTabs(plugin.slots["patient.tabs"], {
    area: "communication",
    builtin: [
      ["messages", "消息记录", 10],
      ["appointments", "复诊预约", 20],
      ["followups", "随访计划", 30],
      ["tracking", "检查与转诊", 40],
    ],
  });
  assert.deepEqual(
    communication.map((item) => [item.key, item.label]),
    [
      ["messages", "消息记录"],
      ["appointments", "复诊预约"],
      ["followups", "随访计划"],
      ["p:followup-ui:care", "关怀"],
      ["tracking", "检查与转诊"],
    ],
  );
  assert.equal(
    communication.filter((item) => item.key === "followups").length,
    1,
    "legacyTab 必须替换同 id 的固定项而不是重复追加",
  );

  assert.equal(plugin.slots["settings.panels"][0].legacyTab, "followup");
  assert.equal(
    slots.findSettingsPanel(plugin.slots["settings.panels"], "followup"),
    plugin.slots["settings.panels"][0],
  );
  assert.equal(slots.findSettingsPanel(plugin.slots["settings.panels"], "other"), null);
});

test("patient.tabs 拒绝非法 area/legacyTab", async (t) => {
  const { vite, slots } = await load();
  t.after(() => vite.close());

  const component = () => Promise.resolve({ default: View });
  assert.throws(
    () =>
      definition(slots, {
        "patient.tabs": [
          { id: "bad", label: "Bad", area: "other", component },
        ],
      }),
    /area 必须是 record 或 communication/,
  );
  assert.throws(
    () =>
      definition(slots, {
        "patient.tabs": [
          { id: "bad", label: "Bad", legacyTab: "Bad-Tab", component },
        ],
      }),
    /legacyTab/,
  );
  assert.throws(
    () =>
      definition(slots, {
        "patient.tabs": [
          { id: "one", label: "One", legacyTab: "same", component },
          { id: "two", label: "Two", legacyTab: "same", component },
        ],
      }),
    /重复声明 legacyTab/,
  );
});

test("legacyViews 由插件渲染且 URL 不变；缺失时回退固定区", async (t) => {
  const { vite, slots } = await load();
  t.after(() => vite.close());

  const plugin = definition(slots, {
    legacyViews: {
      followups: () => Promise.resolve({ default: View }),
    },
  });
  slots.registerUiPlugins({ "./followup-ui/ui/index.jsx": { default: plugin } }, [
    "followup-ui",
  ]);

  const html = await renderAsync(
    createElement(slots.LegacyView, {
      view: "followups",
      fallback: () => createElement("p", null, "固定区视图"),
    }),
  );
  assert.match(html, /插件视图:followups/);
  assert.doesNotMatch(html, /固定区视图/);

  const fallback = await renderAsync(
    createElement(slots.LegacyView, {
      view: "care",
      fallback: () => createElement("p", null, "固定区视图"),
    }),
  );
  assert.match(fallback, /固定区视图/);
});

test("navigation 接受 legacyTab 与 p: 插件 tab，拒绝非法 URL tab", async (t) => {
  const { vite, navigation } = await load();
  t.after(() => vite.close());

  assert.equal(navigation.isLegacyTab("custom-tab"), true);
  assert.equal(navigation.isLegacyTab("Custom-Tab"), false);
  assert.equal(navigation.isPluginTab("p:followup:followups"), true);
  assert.equal(navigation.isPluginTab("p:Followup:followups"), false);
});
