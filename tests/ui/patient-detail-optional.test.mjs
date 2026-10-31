import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";
import { loadPatientBundle } from "../../src/patient-detail-data.js";

const patient = {
  id: "patient-1",
  name: "测试患者",
  sessionId: "session-1",
  revision: 1,
  updatedAt: "2026-01-01T00:00:00.000Z",
  archived: false,
  diagnoses: [],
  medications: [],
  visits: [],
  labs: [],
  counts: { dueFollowups: 1, unprocessedMessages: 2, pendingReminders: 1 },
};

test("followup 停用：不请求 messages/followups，患者详情仍可加载", async () => {
  const calls = [];
  const api = async (path) => {
    calls.push(path);
    if (path === "/api/patients/patient-1") return patient;
    throw Object.assign(new Error("接口不存在"), { code: "NOT_FOUND", status: 404 });
  };

  const bundle = await loadPatientBundle(api, "patient-1", {
    followupEnabled: false,
  });
  assert.equal(bundle.patient.id, "patient-1");
  assert.deepEqual(bundle.messages, []);
  assert.deepEqual(bundle.followups, []);
  assert.deepEqual(bundle.risks, []);
  assert.deepEqual(
    calls.filter((path) => /\/messages|\/followups|\/api\/care/.test(path)),
    [],
  );
});

test("risk-rules 停用：不请求 risk-alerts，患者详情仍可加载", async () => {
  const calls = [];
  const api = async (path) => {
    calls.push(path);
    if (path === "/api/patients/patient-1") return patient;
    throw Object.assign(new Error("接口不存在"), { code: "NOT_FOUND", status: 404 });
  };

  const bundle = await loadPatientBundle(api, "patient-1", {
    followupEnabled: false,
    riskEnabled: false,
  });
  assert.equal(bundle.patient.id, "patient-1");
  assert.deepEqual(bundle.risks, []);
  assert.deepEqual(calls, ["/api/patients/patient-1"]);
});

test("followup 启用但可选接口 404：详情加载不被拒绝，可选数据按空处理", async () => {
  const api = async (path) => {
    if (path === "/api/patients/patient-1") return patient;
    if (path === "/api/risk-alerts?patientId=patient-1") return { alerts: [] };
    if (path === "/api/patients/patient-1/messages")
      return { messages: [{ id: "m1", text: "消息" }] };
    throw Object.assign(new Error("接口不存在"), { code: "NOT_FOUND", status: 404 });
  };

  const bundle = await loadPatientBundle(api, "patient-1", {
    followupEnabled: true,
  });
  assert.equal(bundle.patient.id, "patient-1");
  assert.equal(bundle.messages.length, 1);
  assert.deepEqual(bundle.followups, []);
});

test("可选接口 404 后概览组件仍渲染患者概览标题", async (t) => {
  const vite = await createViteServer({
    appType: "custom",
    // Server-side rendering only: skip browser dependency pre-bundling, which
    // leaves a temp copy in node_modules/.vite each time the server closes.
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  t.after(() => vite.close());

  const previousStorage = globalThis.sessionStorage;
  globalThis.sessionStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  t.after(() => {
    if (previousStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previousStorage;
  });

  const { PatientDashboard } = await vite.ssrLoadModule(
    "/src/patient-dashboard.jsx",
  );
  const api = async (path) => {
    if (path === "/api/patients/patient-1") return patient;
    if (path === "/api/risk-alerts?patientId=patient-1") return { alerts: [] };
    throw Object.assign(new Error("接口不存在"), { code: "NOT_FOUND", status: 404 });
  };
  const bundle = await loadPatientBundle(api, "patient-1", {
    followupEnabled: true,
  });
  const html = renderToStaticMarkup(
    createElement(PatientDashboard, {
      patient: bundle.patient,
      session: { id: "session-1", files: [] },
      view: "overview",
      followups: bundle.followups,
      onClinical: () => {},
      onOpenWorkspace: () => {},
      onView: () => {},
      onChanged: () => {},
      onError: () => {},
    }),
  );

  assert.match(html, /<h2[^>]*>患者概览<\/h2>/);
  assert.match(html, /class="patient-overview"/);
  assert.doesNotMatch(html, /接口不存在/);
});
