import { check } from "../../server/errors.mjs";

export const CHANNEL_API_VERSION = 1;

/**
 * A channel adapter hides one concrete messaging integration behind a single
 * contract. `capabilities` is deliberately declarative: the followup domain
 * must be able to decide whether a send needs a doctor confirmation without
 * importing any adapter implementation.
 *
 * @typedef {Object} ChannelCapabilities
 * @property {"push"|"poll"|"none"} receive       incoming messages arrive by callback, polling, or not at all
 * @property {"direct"|"confirm"|"manual"} send   direct send / doctor-confirmed send / draft-only manual task
 * @property {boolean} history                    can read historical messages
 * @property {boolean} groups                     supports group conversations
 * @property {boolean} contacts                   can enumerate contacts
 * @property {boolean} binding                    can bind a patient to an external contact
 * @property {boolean} qr                         connection needs a QR code
 */

export const CHANNEL_RECEIVE_MODES = Object.freeze(["push", "poll", "none"]);
export const CHANNEL_SEND_MODES = Object.freeze(["direct", "confirm", "manual"]);
export const CHANNEL_SEND_STATES = Object.freeze([
  "sent",
  "queued",
  "awaiting_member",
  "unknown",
  "failed",
]);
export const CHANNEL_CONVERSATION_TYPES = Object.freeze(["dm", "group"]);
export const CHANNEL_MESSAGE_DIRECTIONS = Object.freeze(["in", "out"]);
export const CHANNEL_MESSAGE_KINDS = Object.freeze(["text", "event", "system"]);

const ADAPTER_ID = /^[a-z][a-z0-9-]{1,63}$/;
const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * Fill defaults and validate the capability matrix. Unknown enum values are
 * rejected so a typo cannot silently turn into an auto-send path.
 *
 * @param {Partial<ChannelCapabilities>} [input]
 * @returns {Readonly<ChannelCapabilities>}
 */
export function normalizeCapabilities(input = {}) {
  check(isObject(input), "CHANNEL_ADAPTER_INVALID", "channel.capabilities 必须是对象");
  const receive = input.receive ?? "none";
  const send = input.send ?? "manual";
  check(
    CHANNEL_RECEIVE_MODES.includes(receive),
    "CHANNEL_ADAPTER_INVALID",
    `channel.capabilities.receive 必须是 ${CHANNEL_RECEIVE_MODES.join(" / ")}`,
  );
  check(
    CHANNEL_SEND_MODES.includes(send),
    "CHANNEL_ADAPTER_INVALID",
    `channel.capabilities.send 必须是 ${CHANNEL_SEND_MODES.join(" / ")}`,
  );
  const flags = {};
  for (const name of ["history", "groups", "contacts", "binding", "qr"]) {
    const value = input[name] ?? false;
    check(
      typeof value === "boolean",
      "CHANNEL_ADAPTER_INVALID",
      `channel.capabilities.${name} 必须是布尔值`,
    );
    flags[name] = value;
  }
  return Object.freeze({ receive, send, ...flags });
}

/**
 * Validate one adapter before it is registered with the `channel` service.
 * The returned value is the same adapter object; the service stores the
 * normalized capabilities it creates from this contract.
 *
 * Required: id, label, capabilities, status(), start(), stop().
 * Required by capability: send() for direct/confirm, onMessage() for push.
 * Optional: configure/connect/disconnect/listConversations/listContacts/
 *           bind/unbind/health.
 *
 * @param {Object} adapter
 * @returns {Object} the validated adapter
 */
export function validateAdapter(adapter) {
  check(isObject(adapter), "CHANNEL_ADAPTER_INVALID", "渠道适配器必须是对象");
  check(
    typeof adapter.id === "string" && ADAPTER_ID.test(adapter.id),
    "CHANNEL_ADAPTER_INVALID",
    "渠道适配器 id 必须匹配 /^[a-z][a-z0-9-]{1,63}$/",
  );
  check(
    typeof adapter.label === "string" && adapter.label.trim(),
    "CHANNEL_ADAPTER_INVALID",
    `渠道适配器 ${adapter.id} 缺少 label`,
  );
  const capabilities = normalizeCapabilities(adapter.capabilities);
  for (const method of ["status", "start", "stop"]) {
    check(
      typeof adapter[method] === "function",
      "CHANNEL_ADAPTER_INVALID",
      `渠道适配器 ${adapter.id} 缺少 ${method}()`,
    );
  }
  if (capabilities.send !== "manual")
    check(
      typeof adapter.send === "function",
      "CHANNEL_ADAPTER_INVALID",
      `渠道适配器 ${adapter.id} 的 send 能力为 ${capabilities.send}，必须实现 send()`,
    );
  if (capabilities.receive === "push")
    check(
      typeof adapter.onMessage === "function",
      "CHANNEL_ADAPTER_INVALID",
      `渠道适配器 ${adapter.id} 使用 push 入站，必须实现 onMessage()`,
    );
  for (const method of [
    "configure",
    "connect",
    "disconnect",
    "listConversations",
    "listContacts",
    "bind",
    "unbind",
    "onMessage",
    "health",
    "send",
  ])
    check(
      adapter[method] === undefined || typeof adapter[method] === "function",
      "CHANNEL_ADAPTER_INVALID",
      `渠道适配器 ${adapter.id} 的 ${method} 必须是函数`,
    );
  return adapter;
}

/**
 * Normalize the only result shape a channel send is allowed to expose.
 *
 * @typedef {Object} ChannelSendResult
 * @property {string} [deliveryId]
 * @property {"sent"|"queued"|"awaiting_member"|"unknown"|"failed"} state
 * @property {string} [externalId]
 * @property {number|string} [sentAt]
 * @property {string} [error]
 * @property {boolean} [retryable]
 *
 * @param {ChannelSendResult} value
 * @returns {Readonly<ChannelSendResult>}
 */
export function normalizeSendResult(value) {
  check(isObject(value), "CHANNEL_SEND_RESULT", "渠道发送结果必须是对象");
  check(
    CHANNEL_SEND_STATES.includes(value.state),
    "CHANNEL_SEND_RESULT",
    `渠道发送结果 state 必须是 ${CHANNEL_SEND_STATES.join(" / ")}`,
  );
  for (const field of ["deliveryId", "externalId", "error"]) {
    check(
      value[field] === undefined || typeof value[field] === "string",
      "CHANNEL_SEND_RESULT",
      `渠道发送结果 ${field} 必须是字符串`,
    );
  }
  check(
    value.retryable === undefined || typeof value.retryable === "boolean",
    "CHANNEL_SEND_RESULT",
    "渠道发送结果 retryable 必须是布尔值",
  );
  return Object.freeze({ ...value });
}
