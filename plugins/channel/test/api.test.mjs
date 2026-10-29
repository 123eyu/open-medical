import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../../../server/agent.mjs";
import { createScriptedProvider } from "../../../tests/helpers/scripted-provider.mjs";
import { startTestServer, waitFor } from "../../../tests/helpers/server.mjs";

const snapshot = JSON.parse(
  readFileSync(
    new URL("./fixtures/message-channels.snapshot.json", import.meta.url),
    "utf8",
  ),
);

const seed = (gateway) => {
  gateway.write("message_channels", {
    id: "snap-channel",
    platform: "feishu",
    name: "快照连接",
    appId: "cli_snapshot0001",
    enabled: false,
    revision: 1,
    consentModel: "",
    cursor: "",
  });
  gateway.write("message_peers", {
    id: "peer-snap",
    channelId: "snap-channel",
    chatId: "chat-snap",
    senderId: "user-snap",
    allowed: true,
    revision: 0,
    sessionId: "",
    firstSeen: 0,
  });
  gateway.write("message_inbox", {
    id: "inbox-snap",
    channelId: "snap-channel",
    peerId: "peer-snap",
    messageId: "m1",
    status: "failed",
    at: 0,
    sentAt: null,
    error: "SNAP",
    sessionId: "",
    runId: "",
  });
};

const start = () =>
  startTestServer({
    provider: createScriptedProvider([]),
    seedDemoPack: false,
  });

async function startAt(database) {
  const server = createServer({
    database,
    provider: createScriptedProvider([]),
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;
  const request = async (path, { method = "GET", body } = {}) => {
    const response = await fetch(new URL(path, url), {
      method,
      headers: {
        "x-medical-token": server.token,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  return { server, request, close: () => server.shutdown() };
}

test("/api/message-channels 关键路由在插件启用时与迁移前快照一致", async (t) => {
  const app = await start();
  t.after(() => app.close());
  await waitFor(() => app.server.messageGateway.stopped === false, {
    description: "channel 网关启动",
  });

  const empty = await app.request("/api/message-channels");
  assert.equal(empty.status, snapshot.empty.status);
  assert.deepEqual(empty.body, snapshot.empty.body);

  seed(app.server.messageGateway);
  const seeded = await app.request("/api/message-channels");
  assert.equal(seeded.status, snapshot.seeded.status);
  assert.deepEqual(seeded.body, snapshot.seeded.body);

  const invalidSave = await app.request("/api/message-channels", {
    method: "PUT",
    body: {},
  });
  assert.equal(invalidSave.status, snapshot.invalidSave.status);
  assert.deepEqual(invalidSave.body, snapshot.invalidSave.body);

  const missingRemove = await app.request(
    "/api/message-channels/missing",
    { method: "DELETE", body: { expectedRevision: 1 } },
  );
  assert.equal(missingRemove.status, snapshot.missingRemove.status);
  assert.deepEqual(missingRemove.body, snapshot.missingRemove.body);

  const unknownSubpath = await app.request("/api/message-channels/unknown/path");
  assert.equal(unknownSubpath.status, snapshot.unknownSubpath.status);
  assert.deepEqual(unknownSubpath.body, snapshot.unknownSubpath.body);

  const disabled = await app.request("/api/plugins/channel", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);
  assert.equal((await app.request("/api/message-channels")).status, 404);
  await waitFor(
    () => {
      const timer = app.server.messageGateway.feishuBinding.timer;
      return (
        app.server.messageGateway.stopped === true &&
        (timer === undefined || timer._destroyed === true)
      );
    },
    { description: "停用后网关后台循环停止" },
  );

  const enabledAgain = await app.request("/api/plugins/channel", {
    method: "PUT",
    body: { enabled: true },
  });
  assert.equal(enabledAgain.status, 200);
  await waitFor(
    () =>
      app.server.messageGateway.stopped === false &&
      Boolean(app.server.messageGateway.feishuBinding.timer) &&
      app.server.messageGateway.feishuBinding.timer._destroyed !== true,
    { description: "重新启用后网关后台循环恢复" },
  );
  assert.equal((await app.request("/api/message-channels")).status, 200);
});

test("channel 插件启动时安装网关后台循环，停用启动后路由 404 且循环不启动", async (t) => {
  const enabled = await start();
  t.after(() => enabled.close());
  await waitFor(
    () =>
      enabled.server.messageGateway.stopped === false &&
      Boolean(enabled.server.messageGateway.feishuBinding.timer),
    { description: "channel 网关与飞书轮询启动" },
  );
  assert.equal((await enabled.request("/api/message-channels")).status, 200);

  const root = mkdtempSync(join(tmpdir(), "omw-channel-"));
  const database = join(root, "medical.sqlite");
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const first = await startAt(database);
  const disabled = await first.request("/api/plugins/channel", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);
  assert.equal((await first.request("/api/message-channels")).status, 404);
  await waitFor(() => first.server.messageGateway.stopped === true, {
    description: "停用后网关停止",
  });
  await first.close();

  const second = await startAt(database);
  t.after(() => second.close());
  const gateway = second.server.messageGateway;
  assert.equal(gateway.stopped, true, "停用插件后网关不得 start");
  assert.equal(gateway.feishuBinding.timer, undefined);
  assert.equal((await second.request("/api/message-channels")).status, 404);
  assert.equal((await second.request("/api/agent/health")).status, 200);
});
