import test from "node:test";
import assert from "node:assert/strict";
import {
  CHANNEL_API_VERSION,
  normalizeCapabilities,
  normalizeSendResult,
  validateAdapter,
} from "../contract.mjs";
import { createChannelService } from "../service.mjs";

const gateway = { rows: () => [] };
const baseAdapter = (overrides = {}) => ({
  id: "wecom-customer",
  label: "企微客户联系",
  capabilities: { receive: "none", send: "confirm", contacts: true },
  status: async () => ({ state: "ready" }),
  start: async () => {},
  stop: async () => {},
  send: async () => ({ state: "sent", externalId: "m1" }),
  ...overrides,
});

test("validateAdapter：正例补默认能力，反例拒绝非法契约", () => {
  const adapter = baseAdapter();
  assert.equal(validateAdapter(adapter), adapter);
  assert.deepEqual(normalizeCapabilities({}), {
    receive: "none",
    send: "manual",
    history: false,
    groups: false,
    contacts: false,
    binding: false,
    qr: false,
  });

  assert.throws(
    () => validateAdapter(baseAdapter({ id: "Bad ID" })),
    /id 必须匹配/,
  );
  assert.throws(
    () => validateAdapter(baseAdapter({ label: "" })),
    /缺少 label/,
  );
  assert.throws(
    () =>
      validateAdapter(
        baseAdapter({ capabilities: { receive: "webhook", send: "none" } }),
      ),
    /capabilities.receive/,
  );
  assert.throws(
    () =>
      validateAdapter(
        baseAdapter({ capabilities: { receive: "none", send: "auto" } }),
      ),
    /capabilities.send/,
  );
  assert.throws(
    () => validateAdapter(baseAdapter({ send: undefined })),
    /必须实现 send/,
  );
  // A read-only adapter declares send:"none" and must not expose send().
  const readOnly = baseAdapter({ capabilities: { receive: "none", send: "none" } });
  delete readOnly.send;
  assert.equal(validateAdapter(readOnly), readOnly);
  assert.throws(
    () =>
      validateAdapter(
        baseAdapter({ capabilities: { receive: "none", send: "none" } }),
      ),
    /不能实现 send/,
  );
  assert.throws(
    () =>
      validateAdapter(
        baseAdapter({
          capabilities: { receive: "push", send: "direct" },
          onMessage: undefined,
        }),
      ),
    /必须实现 onMessage/,
  );
  assert.throws(
    () => validateAdapter(baseAdapter({ stop: undefined })),
    /缺少 stop/,
  );
});

test("normalizeSendResult：只接受统一发送结果", () => {
  assert.deepEqual(normalizeSendResult({ state: "queued", retryable: true }), {
    state: "queued",
    retryable: true,
  });
  assert.throws(() => normalizeSendResult({ state: "done" }), /state/);
  assert.throws(
    () => normalizeSendResult({ state: "sent", retryable: "yes" }),
    /retryable/,
  );
});

test("channel service：register/list/get 与重复注册", () => {
  const service = createChannelService({ gateway });
  assert.equal(service.apiVersion, CHANNEL_API_VERSION);
  assert.deepEqual(service.list(), []);

  const adapter = baseAdapter({ capabilities: { receive: "none", send: "confirm" } });
  const registered = service.register(adapter);
  assert.equal(registered.id, "wecom-customer");
  assert.equal(registered.capabilities.send, "confirm");
  assert.equal(service.get("wecom-customer"), adapter);
  assert.equal(service.get("missing"), null);
  assert.deepEqual(service.list(), [registered]);
  assert.deepEqual(service.adapters(), [registered]);
  assert.throws(() => service.register(adapter), /已注册/);
});

test("channel service.send：confirm 必须医生确认，manual 不自动发送，direct 可发", async () => {
  const service = createChannelService({ gateway });
  const calls = [];
  service.register(
    baseAdapter({
      capabilities: { receive: "none", send: "confirm" },
      send: async (target, message, opts) => {
        calls.push({ target, message, opts });
        return { state: "sent", externalId: "confirm-1" };
      },
    }),
  );
  service.register(
    baseAdapter({
      id: "wechat-desktop",
      label: "桌面微信",
      capabilities: { receive: "poll", send: "manual" },
      send: async () => {
        calls.push({ manual: true });
        return { state: "sent" };
      },
    }),
  );
  service.register(
    baseAdapter({
      id: "wecom-kf",
      label: "企微客服",
      capabilities: { receive: "push", send: "direct" },
      onMessage: () => () => {},
    }),
  );

  const awaiting = await service.send("wecom-customer", { id: "p1" }, "你好");
  assert.equal(awaiting.state, "awaiting_member");
  assert.match(awaiting.error, /医生确认/);
  assert.equal(calls.length, 0, "未确认时不得调用适配器发送");

  let readOnlyCalls = 0;
  const readOnly = baseAdapter({
    id: "wecom-archive",
    label: "企微会话存档",
    capabilities: { receive: "none", send: "none" },
  });
  delete readOnly.send;
  service.register(readOnly);
  // Simulate a stray implementation on the instance: the service must still
  // reject the send before calling it.
  readOnly.send = async () => {
    readOnlyCalls += 1;
    return { state: "sent" };
  };

  const manual = await service.send("wechat-desktop", { id: "p1" }, "你好", {
    confirmed: true,
  });
  assert.equal(manual.state, "awaiting_member");
  assert.equal(manual.retryable, false);
  assert.equal(calls.length, 0, "manual 适配器不提供自动发送路径");

  const sent = await service.send(
    "wecom-customer",
    { id: "p1" },
    "你好",
    { confirmed: true, requestId: "r1" },
  );
  assert.equal(sent.state, "sent");
  assert.equal(sent.externalId, "confirm-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.requestId, "r1");

  const rejected = await service.send("wecom-archive", { id: "p3" }, "只读", {
    confirmed: true,
  });
  assert.equal(rejected.state, "failed");
  assert.match(rejected.error, /只读渠道/);
  assert.equal(readOnlyCalls, 0, "none 渠道不得调用适配器");

  const direct = await service.send("wecom-kf", { id: "p2" }, "直接发送");
  assert.equal(direct.state, "sent");

  const missing = await service.send("missing", {}, "x");
  assert.equal(missing.state, "failed");

  service.register(
    baseAdapter({
      id: "flaky",
      label: "异常渠道",
      capabilities: { receive: "none", send: "direct" },
      send: async () => {
        throw new Error("网络中断");
      },
    }),
  );
  const unknown = await service.send("flaky", {}, "x");
  assert.equal(unknown.state, "unknown");
  assert.match(unknown.error, /网络中断/);
  assert.equal(unknown.retryable, false);
});
