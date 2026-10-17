import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.mjs";
import { FeishuRegistration } from "../server/messaging/feishu-registration.mjs";
const APP = "cli_registration1234";
const response = (data, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
});
const confirmed = () =>
  response({
    client_id: APP,
    client_secret: "private-app-secret",
    user_info: { open_id: "ou_owner", tenant_brand: "feishu" },
  });
async function setup(t) {
  let time = Date.now(),
    pollResult = () => response({ error: "authorization_pending" }, 400);
  const requests = [],
    sockets = [],
    sent = [];
  const f = await fixture(t, {
    provider: {
      local: true,
      model: "demo",
      provider: "test",
      complete: async () => ({ message: { content: "完成" } }),
    },
    messageGatewayOptions: {
      now: () => time,
      fetchImpl: async (url, init) => {
        if (url.endsWith("/registration")) {
          const form = Object.fromEntries(new URLSearchParams(init.body));
          requests.push(form);
          if (form.action === "begin")
            return response({
              device_code: "private-device-code",
              user_code: "public-code",
              interval: 5,
              expire_in: 600,
              verification_uri_complete: "https://untrusted.invalid/never-used",
            });
          return pollResult();
        }
        if (url.endsWith("/internal"))
          return response({
            code: 0,
            tenant_access_token: "private-access-token",
            expire: 7200,
          });
        if (url.endsWith("/info")) return response({ code: 0 });
        sent.push(JSON.parse(init.body));
        return response({ code: 0 });
      },
      createSocket: (options, handler) => {
        sockets.push(handler);
        return { start: async () => options.onReady(), close() {} };
      },
    },
  });
  const g = f.server.messageGateway,
    binding = g.feishuBinding;
  clearInterval(binding.timer);
  const begin = async (authorizeModel = false) => {
    const r = await f.json("/api/message-channels/feishu-binding", "POST", {
      authorizeModel,
      expectedModel: g.modelKey(),
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  };
  const message = async (id, sender = "ou_owner", chat = "oc_chat") => {
    sockets.at(-1)({
      sender: { sender_type: "user", sender_id: { open_id: sender } },
      message: {
        chat_type: "p2p",
        chat_id: chat,
        message_id: `om_${id}`,
        create_time: String(Date.now()),
        message_type: "text",
        content: JSON.stringify({ text: "连接测试" }),
      },
    });
    while (g.jobs.size || g.sends.size)
      await Promise.allSettled([...g.jobs.values(), ...g.sends.values()]);
  };
  return {
    ...f,
    g,
    binding,
    requests,
    sent,
    begin,
    message,
    tick: (ms = 6000) => {
      time += ms;
    },
    result: (value) => {
      pollResult = value;
    },
  };
}

test("button binding uses official registration, hides secrets, and only authorizes the verified scanner", async (t) => {
  const f = await setup(t);
  assert.equal(
    (
      await fetch(f.origin + "/api/message-channels/feishu-binding", {
        method: "POST",
      })
    ).status,
    401,
  );
  const start = await f.begin(true);
  assert.equal(
    start.url,
    "https://open.feishu.cn/page/cli?user_code=public-code",
  );
  assert.match(start.image, /^data:image\/png;base64,/);
  assert.doesNotMatch(
    JSON.stringify(start),
    /private-device-code|device_code|untrusted/,
  );
  assert.equal(f.requests[0].archetype, "PersonalAgent");
  assert.equal(
    (await f.begin()).id,
    start.id,
    "another tab resumes the same registration",
  );
  await f.binding.poll(start.id);
  await f.binding.poll(start.id);
  assert.equal(
    f.requests.filter((x) => x.action === "poll").length,
    1,
    "server enforces polling interval",
  );
  f.tick();
  f.result(confirmed);
  assert.equal((await f.binding.poll(start.id)).status, "bound");
  await Promise.all(f.g.starts.values());
  const c = f.g.settings().channels[0];
  assert.equal(c.needsConsent, false);
  assert.equal(c.state, "connected");
  assert.equal(
    f.g.vault.get(`message-channel:${c.id}`).appSecret,
    "private-app-secret",
  );
  assert.doesNotMatch(
    JSON.stringify(f.g.settings()),
    /private-app-secret|private-device-code/,
  );
  assert.doesNotMatch(
    JSON.stringify(f.g.db.prepare("SELECT * FROM agent_credentials").all()),
    /private-app-secret|private-device-code/,
  );
  await f.message("stranger", "ou_stranger");
  assert.equal(f.sent.length, 0);
  await f.message("owner");
  assert.equal(f.sent.length, 1);
  const owner = f.g
    .settings()
    .channels[0].peers.find((p) => p.senderId === "ou_owner");
  assert.equal(owner.allowed, true);
  await f.g.authorize(owner.id, {
    allowed: false,
    expectedRevision: owner.revision,
  });
  await f.message("revoked");
  await f.message("newchat", "ou_owner", "oc_other");
  assert.equal(
    f.sent.length,
    1,
    "revocation cannot be bypassed through a new chat",
  );
  await f.g.remove(c.id, c.revision);
  assert.equal(f.binding.publicStatus().status, "idle");
});

test("consent is optional and never migrates to a different model during authorization", async (t) => {
  const f = await setup(t);
  await f.begin(true);
  f.g.getProvider = () => ({
    apiKey: "new",
    model: "changed",
    provider: "remote",
  });
  f.result(confirmed);
  await f.binding.poll();
  assert.equal(f.g.settings().channels[0].needsConsent, true);
  const c = f.g.settings().channels[0];
  await f.g.remove(c.id, c.revision);
  await f.begin(false);
  await f.binding.poll();
  assert.equal(f.g.settings().channels[0].needsConsent, true);
});

test("slow_down, network errors, expiry and denial leave usable retry states", async (t) => {
  const f = await setup(t);
  await f.begin();
  f.result(() => response({ error: "slow_down" }, 400));
  assert.equal((await f.binding.poll()).interval, 10);
  f.tick(10000);
  f.result(() => {
    throw Error("private-network-diagnostic");
  });
  const status = await f.binding.poll();
  assert.equal(status.status, "pending");
  assert.doesNotMatch(status.error, /private/);
  f.tick(600000);
  assert.equal((await f.binding.poll()).status, "expired");
  await f.begin();
  f.result(() => response({ error: "access_denied" }, 400));
  assert.equal((await f.binding.poll()).status, "denied");
  assert.equal(f.g.settings().channels.length, 0);
});

test("cancel and a late completion cannot create a channel or replace a newer registration", async (t) => {
  const f = await setup(t),
    first = await f.begin();
  let release;
  f.result(
    () =>
      new Promise((r) => {
        release = r;
      }),
  );
  const pending = f.binding.poll(first.id);
  f.binding.cancel(first.id);
  const second = await f.begin();
  release(confirmed());
  await pending;
  assert.notEqual(first.id, second.id);
  assert.equal(f.binding.publicStatus().id, second.id);
  assert.equal(f.g.settings().channels.length, 0);
  assert.throws(() => f.binding.poll(first.id), /绑定链接已更新/);
});

test("in-flight expiry is enforced and unsupported accounts are not falsely connected", async (t) => {
  const f = await setup(t);
  await f.begin();
  let release;
  f.result(
    () =>
      new Promise((r) => {
        release = r;
      }),
  );
  const pending = f.binding.poll();
  f.tick(600000);
  release(confirmed());
  assert.equal((await pending).status, "expired");
  assert.equal(f.g.settings().channels.length, 0);
  await f.begin();
  f.result(() =>
    response({
      client_id: APP,
      client_secret: "secret",
      user_info: { tenant_brand: "lark" },
    }),
  );
  assert.equal((await f.binding.poll()).status, "failed");
  assert.equal(f.g.settings().channels.length, 0);
});

test("consumed credentials survive restart and commit without repeating upstream authorization", async (t) => {
  const f = await setup(t);
  await f.begin();
  const accept = f.binding.accept;
  f.binding.accept = () => {
    throw Error("temporary local write failure");
  };
  f.result(confirmed);
  await f.binding.poll();
  assert.equal(f.binding.current().credentials.appSecret, "private-app-secret");
  assert.doesNotMatch(
    JSON.stringify(f.binding.publicStatus()),
    /private-app-secret/,
  );
  await f.binding.stop();
  f.tick();
  const restored = new FeishuRegistration({
    vault: f.g.vault,
    now: f.binding.now,
    canStart: () => {},
    accept,
    fetchImpl: () => {
      throw Error("must not poll consumed registration");
    },
  });
  assert.equal((await restored.poll()).status, "bound");
  assert.equal(f.g.settings().channels.length, 1);
  assert.equal(restored.current().credentials, undefined);
});

test("manual connection wins against a pending scan without later resurrection", async (t) => {
  const f = await setup(t);
  await f.begin();
  let release;
  f.result(
    () =>
      new Promise((r) => {
        release = r;
      }),
  );
  const pending = f.binding.poll();
  await f.g.save({
    platform: "feishu",
    name: "已有应用",
    appId: "cli_existing12345",
    appSecret: "manual-secret",
    enabled: true,
  });
  release(confirmed());
  await pending;
  assert.equal(f.g.settings().channels[0].appId, "cli_existing12345");
  assert.equal(f.binding.publicStatus().status, "cancelled");
  const c = f.g.settings().channels[0];
  await f.g.remove(c.id, c.revision);
  await f.binding.poll();
  assert.equal(f.g.settings().channels.length, 0);
});

test("stale displayed model cannot receive consent when generating a binding", async (t) => {
  const f = await setup(t);
  const result = await f.json("/api/message-channels/feishu-binding", "POST", {
    authorizeModel: true,
    expectedModel: "stale",
  });
  assert.equal(result.status, 409);
  assert.equal(f.requests.length, 0);
});
