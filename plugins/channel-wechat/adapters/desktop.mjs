import { check } from "../../../server/errors.mjs";

const textOf = (message) =>
  typeof message === "string" ? message : String(message?.text || "");

// Desktop WeChat is a visible-window reader. Reading and sending both depend on
// the calibrated window/avatar fingerprint, so `send` keeps the historical
// doctor-confirmation gate: the channel service blocks unconfirmed sends, and
// this adapter repeats the check before touching the screen.
export function createDesktopAdapter({ getReader, getChat }) {
  const capabilities = {
    receive: "poll",
    send: "confirm",
    history: false,
    groups: false,
    contacts: true,
    binding: true,
    qr: false,
  };
  const reader = () => {
    const value = getReader?.();
    check(value, "WECHAT_UNAVAILABLE", "个人微信桌面读取未启用", 503);
    return value;
  };
  const chat = () => getChat?.() || null;
  return {
    id: "wechat-desktop",
    label: "个人微信（桌面窗口）",
    capabilities,
    async status() {
      try {
        const value = await reader().status();
        return {
          state: value?.ready ? "ready" : "unconfigured",
          account: null,
          lastError: value?.ready ? null : value?.message || "微信窗口不可用",
          capabilities,
        };
      } catch (error) {
        return {
          state: "unconfigured",
          account: null,
          lastError: String(error?.message || "微信窗口不可用").slice(0, 500),
          capabilities,
        };
      }
    },
    async send(target = {}, message, opts = {}) {
      if (opts.confirmed !== true && opts.consent !== true)
        return {
          state: "awaiting_member",
          error: "发送给患者前需要医生确认",
          retryable: false,
        };
      const text = textOf(message);
      check(text.trim(), "INVALID_INPUT", "发送内容为空", 400);
      const instance = chat();
      if (target.bindingId && instance)
        return instance.sendToBinding({
          bindingId: target.bindingId,
          text,
          consent: true,
          autoLocate: opts.autoLocate !== false,
        }).then((result) => ({
          state: result?.sent ? "sent" : "unknown",
          deliveryId: result?.messageId || undefined,
          sentAt: result?.sent ? new Date().toISOString() : undefined,
          error: result?.sent ? undefined : "桌面微信发送未确认",
          retryable: false,
        }));
      // Lower-level callers must pass the full calibrated binding; no blind
      // search/Return fallback exists in the reader.
      check(target.binding, "CHAT_BINDING", "缺少已校准的微信会话", 409);
      const result = await reader().send(
        target.binding,
        text,
        opts.signal,
        opts.readerOptions || {},
      );
      return {
        state: "sent",
        externalId: result?.fingerprint || undefined,
        sentAt: new Date().toISOString(),
      };
    },
    async listContacts() {
      const value = reader();
      if (typeof value.listNames !== "function") return { names: [] };
      const result = await value.listNames();
      return result?.names ? result : { names: result || [] };
    },
    async listConversations() {
      const value = reader();
      if (typeof value.scanConversationList !== "function")
        return { conversations: [], partial: true };
      return value.scanConversationList();
    },
    async bind(input) {
      const instance = chat();
      check(instance, "WECHAT_UNAVAILABLE", "个人微信未启用", 503);
      return instance.bind(input);
    },
    async unbind(id) {
      const instance = chat();
      check(instance, "WECHAT_UNAVAILABLE", "个人微信未启用", 503);
      return instance.unbind(id);
    },
    async health() {
      try {
        return { ok: Boolean((await reader().status())?.ready) };
      } catch {
        return { ok: false };
      }
    },
    async start() {},
    async stop() {},
  };
}
