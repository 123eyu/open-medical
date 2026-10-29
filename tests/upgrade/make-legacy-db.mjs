#!/usr/bin/env node
// Generate the legacy upgrade fixture from a `main` checkout.
//
// The fixture must be produced by the pre-refactor server, because the current
// branch no longer contains the old fixed-area implementation. Run it from this
// branch with a temporary worktree of main:
//
//   git worktree add .legacy-main main
//   ln -s ../../node_modules .legacy-main/node_modules
//   node tests/upgrade/make-legacy-db.mjs --server-root .legacy-main
//
// The generated database contains only the built-in demo patients and the
// fictional records created below. It is vacuumed before being copied to
// tests/upgrade/fixtures/.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createScriptedProvider, textTurn, toolCall } from "../helpers/scripted-provider.mjs";
import { captureSnapshot } from "./snapshot.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else args[key] = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const serverRoot = resolve(ROOT, args["server-root"] || process.env.LEGACY_SERVER_ROOT || ".");
const databaseOut = resolve(
  ROOT,
  args.database || "tests/upgrade/fixtures/legacy.sqlite",
);
const snapshotOut = resolve(
  ROOT,
  args.snapshot || "tests/upgrade/fixtures/legacy-snapshot.json",
);

const tempRoot = mkdtempSync(
  join(process.env.MEDICAL_TEST_TMP || tmpdir(), "omw-legacy-"),
);
const databasePath = join(tempRoot, "legacy.sqlite");
// LanceDB (used by the knowledge index) reads TMPDIR directly. Point it at the
// writable test directory so fixture generation also works in restricted
// runners whose default TMPDIR is read-only.
process.env.TMPDIR = tempRoot;
const provider = createScriptedProvider([
  () =>
    toolCall(
      "followup_create_propose",
      {
        patientId: state.zhang.id,
        name: "升级兼容·血压复查随访",
        once: true,
        firstDueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        checklist: ["家庭血压记录", "当前用药核对"],
        summary: "为张沪生创建升级兼容随访",
      },
      "call_upgrade_followup",
    ),
  textTurn("已创建随访提案，等待确认。"),
]);
const state = {};

const { createServer } = await import(
  pathToFileURL(join(serverRoot, "server/agent.mjs")).href
);
let server;
let url;
let token;

async function request(path, { method = "GET", body, headers = {} } = {}) {
  const init = {
    method,
    headers: { "x-medical-token": token, ...headers },
  };
  if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  const response = await fetch(new URL(path, url), init);
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, ok: response.ok, body: parsed, text };
}

function expect(response, status, label) {
  if (response.status !== status)
    throw new Error(`${label}失败：HTTP ${response.status} ${response.text}`);
  return response.body;
}

try {
  server = createServer({
    database: databasePath,
    provider,
    userSkillsDir: join(tempRoot, "my-skills"),
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  token = server.token;
  url = `http://127.0.0.1:${server.address().port}`;

  const demo = expect(
    await request("/api/demo-pack", { method: "POST" }),
    201,
    "加载示例资料",
  );
  const patients = expect(
    await request("/api/patients?summary=1"),
    200,
    "读取患者列表",
  ).patients;
  state.zhang = patients.find((patient) => patient.name === "示例·张沪生");
  state.li = patients.find((patient) => patient.name === "示例·李婉珍");
  if (!state.zhang || !state.li) throw new Error("示例患者缺失，无法生成旧数据库");

  // 1) A real lab import creates the same patient-update proposal the UI uses.
  const labText = [
    "姓名,项目,数值,单位,日期",
    `${state.zhang.name},前白蛋白,268,mg/L,2025-01-16`,
  ].join("\n");
  const preview = expect(
    await request("/api/patients/lab-import/preview", {
      method: "POST",
      body: { text: labText },
    }),
    200,
    "检验导入预览",
  );
  const row = preview.rows[0];
  if (!row || row.status !== "ready")
    throw new Error("检验导入预览没有可提交的行");
  const commit = expect(
    await request("/api/patients/lab-import/commit", {
      method: "POST",
      body: {
        text: labText,
        selectedRows: [row.row],
        fingerprint: preview.fingerprint,
        requestId: "upgrade-zhang-lab",
      },
    }),
    201,
    "检验导入提交",
  );
  const labProposal = commit.proposals[0];
  expect(
    await request(`/api/pending-actions/${labProposal.id}/confirm`, {
      method: "POST",
      body: {},
    }),
    200,
    "确认档案修改提案",
  );

  // 2) A follow-up proposal through the real agent tool, then confirm it.
  const run = expect(
    await request("/api/agent/run", {
      method: "POST",
      body: {
        sessionId: state.zhang.sessionId,
        message: "给张沪生创建一个血压复查随访提醒",
        mode: "standard",
        externalConsent: true,
      },
    }),
    200,
    "创建随访提案",
  );
  if (run.status !== "completed")
    throw new Error(`随访提案 run 未完成：${run.status}`);
  const followupActions = expect(
    await request(
      `/api/pending-actions?type=followup-create&patientId=${encodeURIComponent(state.zhang.id)}`,
    ),
    200,
    "读取随访提案",
  ).actions;
  const followupAction = followupActions.find(
    (action) => action.payload?.name === "升级兼容·血压复查随访",
  );
  if (!followupAction) throw new Error("找不到刚创建的随访提案");
  expect(
    await request(`/api/pending-actions/${followupAction.id}/confirm`, {
      method: "POST",
      body: {},
    }),
    200,
    "确认随访提案",
  );

  // 3) A referral follow-up (care task) and a new case-library entry.
  const careTask = expect(
    await request(
      `/api/patients/${encodeURIComponent(state.zhang.id)}/care-tasks`,
      {
        method: "POST",
        body: {
          title: "升级兼容·检查转诊跟进",
          kind: "referral",
          dueAt: new Date(Date.now() + 3 * 86400000).toISOString(),
          note: "转诊检查结果回收后由医生核对。",
          requestId: "upgrade-referral",
        },
      },
    ),
    201,
    "创建检查转诊跟进",
  );
  state.careTask = careTask;

  expect(
    await request("/api/cases", {
      method: "POST",
      body: {
        patientId: state.zhang.id,
        patientName: state.zhang.name,
        sessionId: state.zhang.sessionId,
        diagnosis: "原发性高血压",
        icd10: "I10",
        summary: "血压波动，肾功能稳定，调整用药后复查。",
        outcome: "门诊随访中",
        lessons: "先核对家庭血压记录，再判断是否需要调整用药。",
        tags: ["升级兼容", "虚构数据"],
        starred: false,
      },
    }),
    201,
    "创建病例库条目",
  );

  // 4) A doctor memory and a complete doctor profile.
  expect(
    await request("/api/doctor/memories", {
      method: "POST",
      body: {
        content: "书写病历时保留检验单位和日期，不使用缩写。",
        topic: "病历文风偏好",
        source: { type: "stated" },
      },
    }),
    201,
    "写入医生记忆",
  );
  const profile = expect(
    await request("/api/doctor/profile"),
    200,
    "读取医生档案",
  );
  expect(
    await request("/api/doctor/profile", {
      method: "PATCH",
      body: {
        expectedRevision: profile.revision,
        specialty: "全科医学科",
        note: "升级兼容测试使用的虚构医生档案。",
        medicationHabits: ["优先记录通用名与剂量"],
        examPanels: ["血常规 + 肝肾功能"],
        followupPreferences: ["一周内电话随访"],
      },
    }),
    200,
    "更新医生档案",
  );

  // 5) Leave a second patient-update proposal pending so the tray payload is
  //    covered by the migration snapshot as well.
  const pendingText = [
    "姓名,项目,数值,单位,日期",
    `${state.li.name},载脂蛋白A1,1.42,g/L,2025-01-18`,
  ].join("\n");
  const pendingPreview = expect(
    await request("/api/patients/lab-import/preview", {
      method: "POST",
      body: { text: pendingText },
    }),
    200,
    "待确认检验导入预览",
  );
  const pendingRow = pendingPreview.rows[0];
  expect(
    await request("/api/patients/lab-import/commit", {
      method: "POST",
      body: {
        text: pendingText,
        selectedRows: [pendingRow.row],
        fingerprint: pendingPreview.fingerprint,
        requestId: "upgrade-pending-li",
      },
    }),
    201,
    "创建待确认档案修改提案",
  );

  const snapshotPatients = expect(
    await request("/api/patients?summary=1"),
    200,
    "升级前患者列表",
  ).patients;
  const snapshot = await captureSnapshot(request, snapshotPatients);
  mkdirSync(dirname(snapshotOut), { recursive: true });
  writeFileSync(snapshotOut, `${JSON.stringify(snapshot, null, 2)}\n`);

  await server.shutdown();
  server = null;

  // Fold WAL back into one small fixture file.
  const db = new DatabaseSync(databasePath);
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;");
  } finally {
    db.close();
  }
  mkdirSync(dirname(databaseOut), { recursive: true });
  copyFileSync(databasePath, databaseOut);
  process.stdout.write(
    `legacy fixture: ${databaseOut}\nsnapshot: ${snapshotOut}\n` +
      `patients: ${snapshotPatients.length}, demo: ${demo.count ?? demo.patients?.length ?? "?"}, ` +
      `case: ${state.careTask?.id || "created"}\n`,
  );
} finally {
  if (server) await server.shutdown().catch(() => {});
  rmSync(tempRoot, { recursive: true, force: true });
}

