import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encrypt, getSignature } from "@wecom/crypto";
import { createScriptedProvider } from "../../../tests/helpers/scripted-provider.mjs";
import { startTestServer, waitFor } from "../../../tests/helpers/server.mjs";

const SNAPSHOT = JSON.parse(
  readFileSync(new URL("./fixtures/wecom-api.snapshot.json", import.meta.url), "utf8"),
);
const CORP = "wwsnap0000000001";
const TOKEN = "snaptoken";
const AES_KEY = "a".repeat(43);

const start = (options = {}) =>
  startTestServer({
    provider: createScriptedProvider([]),
    serverOptions: {
      wecom: {
        corpId: CORP,
        corpSecret: "snap-secret-123456",
        callbackToken: TOKEN,
        aesKey: AES_KEY,
      },
      ...options,
    },
  });

const seed = (app, patientId) => {
  const db = app.server.store.db;
  db.prepare("DELETE FROM wecom_contacts").run();
  db.prepare("DELETE FROM wecom_bindings").run();
  db.prepare("DELETE FROM wecom_tasks").run();
  db.prepare("DELETE FROM wecom_events").run();
  db.prepare("DELETE FROM wecom_groups").run();
  db.prepare("DELETE FROM wecom_group_tasks").run();
  db.prepare("DELETE FROM wecom_directory_state").run();
  db.prepare(
    "INSERT INTO wecom_contacts(corp,member,external,name,active,updated,data) VALUES (?,?,?,?,1,?,?)",
  ).run(
    CORP,
    "zhangsan",
    "wmEXT001",
    "张三",
    "2026-01-02T03:04:05.000Z",
    JSON.stringify({
      type: "wechat",
      gender: "male",
      corpName: "示例企业",
      remark: "张三·P0001",
      description: "家属：女儿陪同",
      mobiles: ["13800000000"],
      tags: ["复诊"],
      addedAt: "2026-01-01T00:00:00.000Z",
    }),
  );
  db.prepare("INSERT INTO wecom_bindings VALUES (?,?,?,?,?,?,?)").run(
    "binding-snap",
    CORP,
    "zhangsan",
    "wmEXT001",
    patientId,
    "self",
    "2026-01-02T04:05:06.000Z",
  );
  db.prepare("INSERT INTO wecom_tasks VALUES (?,?,?,?)").run(
    "task-snap",
    CORP,
    patientId,
    JSON.stringify({
      id: "task-snap",
      corpId: CORP,
      patientId,
      bindingId: "binding-snap",
      member: "zhangsan",
      external: "wmEXT001",
      recipient: "张三",
      relationship: "self",
      text: "请下周回来复诊。",
      status: "awaiting_member",
      msgid: "MSG-SNAP",
      detail: "已创建企业微信任务，等待成员确认发送。",
      createdAt: "2026-01-03T00:00:00.000Z",
      updatedAt: "2026-01-03T00:01:00.000Z",
    }),
  );
  db.prepare("INSERT INTO wecom_events VALUES (?,?,?,?)").run(
    "event-snap",
    CORP,
    "2026-01-04T00:00:00.000Z",
    JSON.stringify({ event: "change_external_contact" }),
  );
  db.prepare("INSERT INTO wecom_groups VALUES (?,?,?,?,1,?,?)").run(
    CORP,
    "wrGROUP001",
    "糖友交流群",
    "zhangsan",
    "2026-01-02T03:04:05.000Z",
    JSON.stringify({
      notice: "群公告",
      createdAt: "2026-01-01T00:00:00.000Z",
      admins: ["zhangsan"],
      members: [
        { id: "wmEXT001", external: true, name: "张三", joinedAt: "2026-01-01T00:00:00.000Z" },
        { id: "zhangsan", external: false, name: "助理", joinedAt: null },
      ],
    }),
  );
  db.prepare("INSERT INTO wecom_group_tasks VALUES (?,?,?,?)").run(
    "gtask-snap",
    CORP,
    "wrGROUP001",
    JSON.stringify({
      id: "gtask-snap",
      chatId: "wrGROUP001",
      groupName: "糖友交流群",
      owner: "zhangsan",
      text: "本周健康讲座。",
      status: "draft",
      createdAt: "2026-01-05T00:00:00.000Z",
      updatedAt: "2026-01-05T00:00:00.000Z",
    }),
  );
  db.prepare("INSERT INTO wecom_directory_state VALUES (?,?)").run(
    CORP,
    JSON.stringify({
      members: ["zhangsan"],
      lastSyncAt: "2026-01-06T00:00:00.000Z",
      lastError: null,
      groupsError: null,
      lastAttemptAt: "2026-01-06T00:00:00.000Z",
    }),
  );
};

const normalize = (value, patientId) =>
  JSON.parse(JSON.stringify(value).split(patientId).join("<patientId>"));

test("/api/wecom/* 关键 GET 路由与迁移前快照一致", async (t) => {
  const app = await start();
  t.after(() => app.close());
  const service = app.server.channelWecom;
  await waitFor(() => service.started, { description: "channel-wecom 启动" });
  // Let the first due directory pull settle before seeding deterministic rows.
  await waitFor(() => !service.directory.running, {
    description: "首轮目录同步结束",
  });

  const patient = (await app.patients())[0];
  seed(app, patient.id);
  const routes = Object.keys(SNAPSHOT);
  for (const template of routes) {
    const expected = SNAPSHOT[template];
    const route = template.split("<patientId>").join(patient.id);
    const response = await app.request(route);
    assert.equal(response.status, expected.status, route);
    assert.deepEqual(
      normalize(response.body, patient.id),
      expected.body,
      route,
    );
  }
});

test("/api/wecom/callback 签名成功与失败形状不变", async (t) => {
  const app = await start();
  t.after(() => app.close());
  await waitFor(() => app.server.channelWecom.started, {
    description: "channel-wecom 启动",
  });

  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "nonce123";
  const message = "callback-echo-ok";
  const cipher = encrypt(AES_KEY, message, CORP, Buffer.alloc(16, 7));
  const signature = getSignature(TOKEN, timestamp, nonce, cipher);
  const query = new URLSearchParams({
    timestamp,
    nonce,
    msg_signature: signature,
    echostr: cipher,
  });
  const ok = await app.request(`/api/wecom/callback?${query}`, {
    auth: false,
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.text, message);

  query.set("msg_signature", "0".repeat(40));
  const bad = await app.request(`/api/wecom/callback?${query}`, {
    auth: false,
  });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.code, "WECOM_SIGNATURE");
  assert.match(bad.body.error, /回调签名无效/);
});
