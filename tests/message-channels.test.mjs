import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.mjs";
import { MessageGateway } from "../server/messaging/gateway.mjs";
import {
  MessageTransport,
  wechatOrigin,
} from "../server/messaging/transports.mjs";
const ok = (data) => ({ ok: true, status: 200, json: async () => data });
const APP = "cli_1234567890abcdef";
const provider = {
  apiKey: "synthetic-key",
  provider: "stub",
  model: "channel-test",
  complete: async () => ({
    message: { role: "assistant", content: "已整理工作要点。" },
  }),
};
const event = (
  id,
  text = "请简短介绍能做什么",
  sender = "ou_doctor",
  chat = "oc_private",
) => ({
  sender: { sender_type: "user", sender_id: { open_id: sender } },
  message: {
    message_id: `om_${id}`,
    chat_id: chat,
    chat_type: "p2p",
    message_type: "text",
    create_time: String(Date.now()),
    content: JSON.stringify({ text }),
  },
});
async function drain(g) {
  while (g.jobs.size || g.sends.size)
    await Promise.allSettled([...g.jobs.values(), ...g.sends.values()]);
}
async function setup(t, extra = {}) {
  const sent = [],
    sockets = [];
  let fail = false;
  const transportOptions = {
    fetchImpl: async (url, init) => {
      if (url.endsWith("/internal"))
        return ok({
          code: 0,
          tenant_access_token: "synthetic-token",
          expire: 7200,
        });
      if (url.endsWith("/info"))
        return ok({ code: 0, bot: { open_id: "ou_bot" } });
      if (fail) throw Error("sensitive transport failure");
      sent.push(JSON.parse(init.body));
      return ok({ code: 0 });
    },
    createSocket: (options, handler) => {
      const socket = {
        handler,
        start: async () => options.onReady(),
        close() {},
      };
      sockets.push(socket);
      return socket;
    },
  };
  const f = await fixture(t, {
    provider,
    messageGatewayOptions: transportOptions,
    ...extra,
  });
  const g = f.server.messageGateway;
  const save = await f.json("/api/message-channels", "PUT", {
    platform: "feishu",
    name: "飞书医生助手",
    appId: APP,
    appSecret: "synthetic-secret",
    enabled: true,
    authorizeModel: true,
  });
  assert.equal(save.status, 200, JSON.stringify(save.data));
  await Promise.all(g.starts.values());
  const c = g.settings().channels[0];
  const receive = async (e) => {
    sockets.at(-1).handler(e);
    await drain(g);
  };
  const authorize = async () => {
    const p = g.settings().channels[0].peers[0];
    const r = await f.json(`/api/message-channels/peers/${p.id}`, "PUT", {
      allowed: true,
      expectedRevision: p.revision,
    });
    assert.equal(r.status, 200);
    return g.settings().channels[0].peers[0];
  };
  return {
    ...f,
    g,
    c,
    sent,
    receive,
    authorize,
    transportOptions,
    setFail: (value) => {
      fail = value;
    },
  };
}

test("Feishu private chat: discovery, authorization, real agent session, rapid followups, dedup, reset and group isolation", async (t) => {
  const f = await setup(t);
  assert.equal((await fetch(f.origin + "/api/message-channels")).status, 401);
  const group = event("group");
  group.message.chat_type = "group";
  await f.receive(group);
  assert.equal(f.g.settings().channels[0].peers.length, 0);
  await f.receive(event("discover", "未经授权的秘密文本"));
  assert.equal(f.sent.length, 0);
  assert.doesNotMatch(
    JSON.stringify(f.g.rows("message_inbox")),
    /未经授权的秘密文本/,
  );
  await f.authorize();
  await f.receive(event("discover"));
  assert.equal(
    f.sent.length,
    0,
    "pre-authorization message cannot be replayed",
  );
  await f.receive(event("test", "连接测试"));
  assert.equal(f.sent.length, 1);
  assert.ok(f.g.settings().channels[0].peers[0].lastVerifiedAt);
  await f.receive(event("first"));
  const peer = f.g.settings().channels[0].peers[0],
    sid = peer.sessionId;
  assert.ok(sid);
  assert.equal(f.server.sessionBridge.get(sid).runs.length, 1);
  assert.match(JSON.parse(f.sent.at(-1).content).text, /工作要点/);
  assert.equal(f.server.sessionBridge.workspace(sid).approvalPolicy, "review");
  assert.equal(
    f.server.sessionBridge.workspace(sid).channelSource.peerId,
    peer.id,
  );
  const tr = f.g.transports.get(f.c.id);
  tr.feishuEvent(event("second", "继续解释"));
  tr.feishuEvent(event("third", "再举个例子"));
  await drain(f.g);
  assert.equal(f.server.sessionBridge.get(sid).runs.length, 3);
  await f.receive(event("first"));
  assert.equal(f.server.sessionBridge.get(sid).runs.length, 3);
  await f.receive(event("other", "hello", "ou_other", "oc_other"));
  assert.equal(f.server.sessionBridge.get(sid).runs.length, 3);
  await f.receive(event("reset", "/new"));
  await f.receive(event("fourth"));
  assert.notEqual(f.g.settings().channels[0].peers[0].sessionId, sid);
  assert.equal(f.server.sessionBridge.get(sid).runs.length, 3);
  assert.doesNotMatch(
    JSON.stringify(f.g.settings()),
    /synthetic-secret|synthetic-token/,
  );
});

test("ambiguous send retries saved reply without rerunning the agent, and revocation prevents retry", async (t) => {
  const f = await setup(t);
  await f.receive(event("discover"));
  await f.authorize();
  f.setFail(true);
  await f.receive(event("first"));
  const row = f.g.rows("message_inbox").find((m) => m.messageId === "om_first");
  assert.equal(row.status, "unknown");
  assert.doesNotMatch(
    JSON.stringify(f.g.settings()),
    /sensitive transport failure/,
  );
  assert.equal(f.server.sessionBridge.get(row.sessionId).runs.length, 1);
  f.setFail(false);
  await f.g.retry(row.id);
  assert.equal(f.server.sessionBridge.get(row.sessionId).runs.length, 1);
  assert.equal(f.g.read("message_inbox", row.id).status, "sent");
  f.setFail(true);
  await f.receive(event("second"));
  const peer = f.g.settings().channels[0].peers[0];
  await f.g.authorize(peer.id, {
    allowed: false,
    expectedRevision: peer.revision,
  });
  const second = f.g
    .rows("message_inbox")
    .find((m) => m.messageId === "om_second");
  await assert.rejects(f.g.retry(second.id), { code: "NOT_AUTHORIZED" });
});

test("model changes require renewed consent; connection does not imply model authorization", async (t) => {
  const f = await setup(t);
  await f.receive(event("discover"));
  await f.authorize();
  f.g.getProvider = () => ({ ...provider, model: "different-model" });
  await f.receive(event("first"));
  assert.match(JSON.parse(f.sent.at(-1).content).text, /授权当前模型/);
  assert.equal(f.g.settings().channels[0].peers[0].sessionId, "");
  assert.equal(f.g.settings().channels[0].needsConsent, true);
});

test("persistent session and interrupted delivery recover without replaying the task", async (t) => {
  const f = await setup(t);
  await f.receive(event("discover"));
  await f.authorize();
  await f.receive(event("first"));
  const row = f.g.rows("message_inbox").find((m) => m.messageId === "om_first");
  await f.g.stop();
  f.g.write("message_inbox", {
    ...row,
    status: "running",
    reply: "",
    sentParts: 0,
  });
  const restarted = new MessageGateway({
    store: f.server.store,
    vault: f.g.vault,
    bridge: f.server.sessionBridge,
    getProvider: () => provider,
    ...f.transportOptions,
  });
  restarted.start();
  await Promise.all(restarted.starts.values());
  await drain(restarted);
  assert.equal(restarted.read("message_inbox", row.id).status, "sent");
  assert.equal(f.server.sessionBridge.get(row.sessionId).runs.length, 1);
  assert.equal(
    restarted.settings().channels[0].peers[0].sessionId,
    row.sessionId,
  );
  await restarted.stop();
});

test("in-flight revocation cancels the task and suppresses external result", async (t) => {
  let entered;
  const ready = new Promise((r) => {
    entered = r;
  });
  const slow = {
    ...provider,
    complete: async (_messages, _tools, options) => {
      entered();
      return new Promise((resolve, reject) => {
        const signal = options?.signal;
        if (signal?.aborted) reject(signal.reason);
        else
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
      });
    },
  };
  const f = await setup(t, { provider: slow });
  await f.receive(event("discover"));
  const peer = await f.authorize();
  f.g.transports.get(f.c.id).feishuEvent(event("slow"));
  await ready;
  await f.g.authorize(peer.id, {
    allowed: false,
    expectedRevision: peer.revision,
  });
  await drain(f.g);
  assert.equal(f.sent.length, 0);
  assert.equal(
    f.g.rows("message_inbox").find((m) => m.messageId === "om_slow").status,
    "revoked",
  );
});

test("WeChat QR stores secrets locally; poll persists context and cursor before private text reply", async (t) => {
  const sent = [];
  let batch = [],
    polls = 0;
  const f = await fixture(t, {
    provider,
    messageGatewayOptions: {
      fetchImpl: async (url, init) => {
        if (url.includes("get_bot_qrcode"))
          return ok({
            qrcode: "test-code",
            qrcode_img_content: "https://example.invalid/qr",
          });
        if (url.includes("get_qrcode_status"))
          return ok({
            status: "confirmed",
            bot_token: "wx-secret",
            ilink_user_id: "doctor",
            ilink_bot_id: "bot",
            baseurl: "https://ilinkai.weixin.qq.com",
          });
        if (url.includes("getupdates")) {
          polls++;
          const msgs = batch;
          batch = [];
          return ok({ ret: 0, msgs, get_updates_buf: `cursor-${polls}` });
        }
        sent.push(JSON.parse(init.body));
        return ok({ ret: 0 });
      },
    },
  });
  const g = f.server.messageGateway;
  const qr = await g.startQr();
  assert.match(qr.image, /^data:image\/png/);
  const connected = await g.pollQr(qr.id);
  assert.equal(connected.status, "confirmed");
  assert.doesNotMatch(JSON.stringify(connected), /wx-secret/);
  let c = g.settings().channels[0];
  batch = [
    {
      message_id: "1",
      message_type: 1,
      from_user_id: "doctor",
      context_token: "context-one",
      item_list: [{ type: 1, text_item: { text: "hello" } }],
    },
    {
      message_id: "2",
      message_type: 1,
      from_user_id: "stranger",
      item_list: [{ type: 1, text_item: { text: "hello" } }],
    },
  ];
  await g.save({
    ...c,
    expectedRevision: c.revision,
    enabled: true,
    authorizeModel: true,
  });
  await Promise.all(g.starts.values());
  for (let i = 0; i < 100 && !g.settings().channels[0].peers.length; i++)
    await new Promise((r) => setTimeout(r, 10));
  c = g.settings().channels[0];
  assert.equal(c.peers.length, 1);
  const p = c.peers[0];
  await g.authorize(p.id, { allowed: true, expectedRevision: p.revision });
  batch = [
    {
      message_id: "3",
      message_type: 1,
      from_user_id: "doctor",
      context_token: "context-two",
      item_list: [{ type: 1, text_item: { text: "连接测试" } }],
    },
  ];
  for (let i = 0; i < 150 && !sent.length; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].msg.context_token, "context-two");
  assert.equal(sent[0].msg.to_user_id, "doctor");
  assert.match(g.read("message_channels", c.id).cursor, /^cursor-/);
  assert.doesNotMatch(JSON.stringify(g.settings()), /context-two|wx-secret/);
  assert.throws(() => wechatOrigin("https://evil.invalid"), {
    code: "INVALID_CONNECTION",
  });
});

test("transport checks platform error codes and validates Feishu private message envelope", async () => {
  const received = [];
  const transport = new MessageTransport({
    connection: { platform: "wechat" },
    secret: {
      baseUrl: "https://ilinkai.weixin.qq.com",
      botToken: "test",
      botId: "bot",
    },
    getContext: () => "ctx",
    receive: (m) => received.push(m),
    fetchImpl: async () => ok({ ret: -1, errcode: 40001 }),
  });
  await assert.rejects(transport.send({ senderId: "doctor" }, "test", "id"), {
    code: "PLATFORM_REJECTED",
  });
  const e = event("stale");
  e.message.create_time = "0";
  transport.feishuEvent(e);
  assert.equal(received.length, 0);
  await transport.stop();
});

test("external session cannot confirm a medical proposal; normal sessions keep the existing tool behavior", async (t) => {
  const f = await setup(t);
  await f.receive(event("discover"));
  await f.authorize();
  await f.receive(event("first"));
  const peer = f.g.settings().channels[0].peers[0];
  const registry = f.server.workspaces.registry(peer.sessionId);
  const confirm = registry.get("proposal_confirm");
  assert.ok(confirm);
  await assert.rejects(
    async () => confirm.execute({ proposalId: "synthetic-action" }, {}),
    { code: "CHANNEL_REVIEW_REQUIRED" },
  );
});

test("knowledge bot and agent cannot concurrently own the same Feishu app, and deleting a connection keeps sessions", async (t) => {
  const f = await setup(t);
  await f.receive(event("discover"));
  await f.authorize();
  await f.receive(event("first"));
  const peer = f.g.settings().channels[0].peers[0];
  assert.equal(
    (await f.json("/api/knowledge-bot", "PUT", { enabled: true, appId: APP }))
      .status,
    409,
  );
  assert.equal(
    (
      await f.json(`/api/message-channels/${f.c.id}`, "DELETE", {
        expectedRevision: 0,
      })
    ).status,
    409,
  );
  const removed = await f.json(`/api/message-channels/${f.c.id}`, "DELETE", {
    expectedRevision: f.c.revision,
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.data.channels.length, 0);
  assert.equal(f.server.sessionBridge.get(peer.sessionId).runs.length, 1);
  assert.deepEqual(f.g.vault.get(`message-channel:${f.c.id}`), {});
});

test("stop bypasses queued work and cancels the active turn without discarding completed history", async (t) => {
  let entered;
  const ready = new Promise((r) => {
    entered = r;
  });
  const slow = {
    ...provider,
    complete: async (_m, _t, options) => {
      entered();
      return new Promise((resolve, reject) =>
        options.signal.addEventListener(
          "abort",
          () => reject(options.signal.reason),
          { once: true },
        ),
      );
    },
  };
  const f = await setup(t, { provider: slow });
  await f.receive(event("discover"));
  await f.authorize();
  const transport = f.g.transports.get(f.c.id);
  transport.feishuEvent(event("slow"));
  transport.feishuEvent(event("queued", "第二个任务"));
  await ready;
  transport.feishuEvent(event("stop", "/stop"));
  await drain(f.g);
  assert.equal(
    f.g.rows("message_inbox").find((m) => m.messageId === "om_queued").status,
    "cancelled",
  );
  assert.ok(
    f.sent.some((s) => JSON.parse(s.content).text.includes("已请求停止")),
  );
  const peer = f.g.settings().channels[0].peers[0];
  assert.equal(f.server.sessionBridge.get(peer.sessionId).runs.length, 1);
});

test("cancelled QR poll cannot create a connection after phone confirmation", async (t) => {
  let release;
  const f = await fixture(t, {
    messageGatewayOptions: {
      fetchImpl: async (url) => {
        if (url.includes("get_bot_qrcode"))
          return ok({
            qrcode: "synthetic-code",
            qrcode_img_content: "https://example.invalid/qr",
          });
        await new Promise((r) => {
          release = r;
        });
        return ok({
          status: "confirmed",
          bot_token: "synthetic",
          ilink_user_id: "doctor",
          ilink_bot_id: "bot",
        });
      },
    },
  });
  const g = f.server.messageGateway,
    qr = await g.startQr();
  const poll = g.pollQr(qr.id);
  await g.cancelQr(qr.id);
  release();
  await assert.rejects(poll, { code: "QR_EXPIRED" });
  assert.equal(g.settings().channels.length, 0);
});
