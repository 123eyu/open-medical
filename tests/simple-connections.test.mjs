import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.mjs";
import { ModelChoices } from "../server/core/model-choices.mjs";
const ok = (data) => ({ ok: true, status: 200, json: async () => data });
test("knowledge and reminder registrations stay isolated; scanner is recognized and revocation survives a new chat", async (t) => {
  const sent = [];
  let receive;
  const transport = (app) => async (url, init) => {
    if (url.endsWith("/registration"))
      return ok(
        new URLSearchParams(init.body).get("action") === "begin"
          ? { device_code: app, user_code: app, interval: 1, expire_in: 600 }
          : {
              client_id: app,
              client_secret: "private-secret",
              user_info: { open_id: "ou_owner", tenant_brand: "feishu" },
            },
      );
    if (url.endsWith("/internal"))
      return ok({
        code: 0,
        tenant_access_token: "private-token",
        expire: 7200,
      });
    if (url.endsWith("/info"))
      return ok({ code: 0, bot: { open_id: "ou_bot" } });
    if (url.includes("/users/"))
      return ok({ code: 0, data: { user: { name: "扫码医生" } } });
    sent.push({ url, body: JSON.parse(init.body) });
    return ok({ code: 0 });
  };
  const f = await fixture(t, {
    doctorNotificationOptions: {
      autoStart: false,
      fetchImpl: transport("cli_reminder12345"),
    },
    knowledgeBotOptions: {
      fetchImpl: transport("cli_knowledge1234"),
      createSocket: (options, handler) => ({
        start: async () => {
          receive = handler;
          options.onReady();
        },
        close() {},
      }),
    },
  });
  const bot = f.server.knowledgeBot,
    reminders = f.server.doctorNotifications;
  clearInterval(bot.binding.timer);
  const [kb, notification] = await Promise.all([
    f.json("/api/knowledge-bot/feishu-binding", "POST", {}),
    f.json("/api/doctor-notifications/feishu-binding", "POST", {}),
  ]);
  assert.equal(kb.status, 200);
  assert.equal(notification.status, 200);
  assert.notEqual(kb.data.id, notification.data.id);
  assert.equal(
    (
      await f.json("/api/knowledge-bot/feishu-binding/status", "POST", {
        id: kb.data.id,
      })
    ).data.status,
    "bound",
  );
  assert.equal(reminders.binding.publicStatus().status, "pending");
  await reminders.binding.poll(notification.data.id);
  assert.equal(reminders.publicConfig("feishu").hasConnection, true);
  assert.doesNotMatch(
    JSON.stringify([bot.settings(), reminders.settings()]),
    /private-secret|private-token|device_code/,
  );
  await reminders.test("feishu");
  assert.equal(sent.at(-1).body.receive_id, "ou_owner");
  assert.match(sent.at(-1).url, /receive_id_type=open_id/);
  const doc = await f.server.guidelines.addDocument({
    title: "复诊资料",
    collection: "门诊",
    text: "复诊前核对资料日期和来源。",
  });
  f.server.guidelines.updateMetadata(doc.id, {
    expectedRevision: 0,
    reviewStatus: "reviewed",
    reviewNote: "核对",
    allowExternalUse: true,
  });
  await bot.save({
    ...bot.config(),
    enabled: true,
    collections: ["门诊"],
    expectedRevision: bot.config().revision,
  });
  await bot.connection;
  const message = async (id, sender, chat = "oc_owner") => {
    receive({
      sender: { sender_type: "user", sender_id: { open_id: sender } },
      message: {
        message_id: `om_${id}`,
        chat_id: chat,
        chat_type: "p2p",
        message_type: "text",
        create_time: String(Date.now()),
        content: JSON.stringify({ text: "复诊" }),
      },
    });
    await Promise.all([...bot.jobs]);
  };
  const count = sent.length;
  await message("stranger", "ou_stranger", "oc_stranger");
  assert.equal(sent.length, count);
  await message("owner", "ou_owner");
  assert.equal(sent.length, count + 1);
  assert.deepEqual(bot.config().privateChats, ["oc_owner"]);
  await bot.save({
    ...bot.config(),
    privateChats: [],
    expectedRevision: bot.config().revision,
  });
  await bot.connection;
  await message("revoked", "ou_owner");
  await message("newchat", "ou_owner", "oc_new");
  assert.equal(sent.length, count + 1);
  await bot.disconnect(bot.config().revision);
  assert.equal(bot.binding.publicStatus().status, "idle");
  assert.equal(reminders.binding.publicStatus().status, "bound");
  reminders.disconnect("feishu", reminders.config("feishu").revision);
  assert.equal(reminders.binding.publicStatus().status, "idle");
});
test("model picker uses only known connections, keeps credentials server-side and rejects changed profiles", async () => {
  const current = {
    provider: "openai-compatible",
    baseUrl: "https://models.example/v1",
    model: "existing",
    apiKey: "private-key",
  };
  let profiles = { second: { ...current, model: "second" } };
  const settings = {
    saved: current,
    provider: () => current,
    candidate: (c) => c,
  };
  const picker = new ModelChoices(
    settings,
    { all: () => profiles },
    {
      fetchImpl: async (url) => {
        assert.equal(url, "http://127.0.0.1:11434/api/tags");
        return ok({ models: [{ name: "local-model" }] });
      },
    },
  );
  const list = await picker.list();
  assert.equal(list.choices.length, 3);
  assert.doesNotMatch(JSON.stringify(list), /private-key|apiKey/);
  assert.equal(list.choices[0].baseUrl, "https://models.example/v1");
  assert.equal(picker.resolve(list.choices[0].id).apiKey, "private-key");
  assert.equal(picker.resolve(list.choices[2].id).provider, "local");
  profiles = { second: { ...profiles.second, apiKey: "rotated" } };
  assert.throws(() => picker.resolve(list.choices[1].id), /列表已变化/);
  assert.throws(() => picker.resolve("http://evil.invalid"), /列表已变化/);
});
