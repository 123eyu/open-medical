import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const patient = {
  id: "patient-1", name: "测试患者", sessionId: "session-1", revision: 3, gender: "female",
  diagnoses: [{ name: "2型糖尿病" }], medications: [{ name: "二甲双胍", status: "active" }],
  labs: [{ item: "血钾", value: 6.1, unit: "mmol/L", date: "2026-10-29" }], visits: [], allergies: [],
};

async function load(t, path) {
  const vite = await createViteServer({ appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  t.after(() => vite.close());
  const previous = globalThis.sessionStorage;
  globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  t.after(() => { if (previous === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = previous; });
  return vite.ssrLoadModule(path);
}

test("患者档案只读取本患者待确认的档案更新提案", async (t) => {
  const { loadPatientUpdateProposals, PatientProposalBanner } = await load(t, "/src/patient-proposal.jsx");
  const calls = [];
  const api = async (path) => {
    calls.push(path);
    return { actions: [
      { id: "a1", type: "patient-update", patientId: "patient-1", summary: "导入检验结果 1 项（肌酐）" },
      { id: "a2", type: "patient-update", patientId: "patient-2", summary: "其他患者" },
      { id: "a3", type: "followup-create", patientId: "patient-1", summary: "随访" },
    ] };
  };
  const actions = await loadPatientUpdateProposals(api, "patient-1");
  assert.deepEqual(actions.map((a) => a.id), ["a1"]);
  assert.match(calls[0], /status=pending/);
  assert.match(calls[0], /type=patient-update/);
  assert.match(calls[0], /patientId=patient-1/);
  const html = renderToStaticMarkup(createElement(PatientProposalBanner, { proposals: actions, onReview: () => {} }));
  assert.match(html, /导入检验结果 1 项/);
  assert.match(html, /核对/);
  assert.equal(renderToStaticMarkup(createElement(PatientProposalBanner, { proposals: [], onReview: () => {} })), "");
});

test("诊疗辅助：未配置模型时说明原因并禁用提问与档案建议", async (t) => {
  const { ClinicalAssistance } = await load(t, "/src/clinical-assistance.jsx");
  const locked = renderToStaticMarkup(createElement(ClinicalAssistance, { patient, modelConfigured: false, onModelSettings: () => {}, onOpenTask: async () => {} }));
  assert.match(locked, /需先连接模型/);
  assert.match(locked, /连接模型<\/button>/);
  assert.match(locked, /<textarea[^>]*disabled/);
  assert.match(locked, /<fieldset disabled=""/);
  assert.match(locked, /<button type="button" disabled=""><svg/);
  const open = renderToStaticMarkup(createElement(ClinicalAssistance, { patient, modelConfigured: true, onOpenTask: async () => {} }));
  assert.doesNotMatch(open, /需先连接模型/);
  assert.doesNotMatch(open, /<textarea[^>]*disabled/);
});

test("风险卡：未配置模型时禁用「生成处理建议草稿」并给出原因", async (t) => {
  const { RiskList } = await load(t, "/src/ui.jsx");
  const alerts = [{ id: "r1", status: "active", severity: "critical", title: "严重高钾血症", message: "血钾 6.1", evidence: [] }];
  const html = renderToStaticMarkup(createElement(RiskList, { alerts, onDraft: () => {}, onAck: () => {}, onResolve: () => {}, draftBlocked: "需先连接模型才能生成处理建议草稿" }));
  assert.match(html, /<button[^>]*disabled=""[^>]*title="需先连接模型才能生成处理建议草稿"[^>]*>\s*生成处理建议草稿/);
  const enabled = renderToStaticMarkup(createElement(RiskList, { alerts, onDraft: () => {}, onAck: () => {}, onResolve: () => {} }));
  assert.doesNotMatch(enabled, /需先连接模型/);
});

test("病史摘要：未配置模型时禁用「整理摘要草稿」并给出原因", async (t) => {
  const { PatientHistory } = await load(t, "/src/patient-history.jsx");
  const props = { patient, files: [], onEdit: () => {}, onNavigate: () => {}, onChanged: () => {}, citedFileName: () => "", onSummarize: () => {} };
  const locked = renderToStaticMarkup(createElement(PatientHistory, { ...props, summarizeBlocked: "需先连接模型才能整理摘要草稿" }));
  assert.match(locked, /<button[^>]*disabled=""[^>]*title="需先连接模型才能整理摘要草稿"[^>]*>整理摘要草稿/);
  const open = renderToStaticMarkup(createElement(PatientHistory, props));
  assert.match(open, /<button class="text-button">整理摘要草稿/);
});
