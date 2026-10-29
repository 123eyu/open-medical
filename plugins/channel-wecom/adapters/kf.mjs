import { AppError, check } from "../../../server/errors.mjs";

export const KF_WINDOW_MS = 48 * 3600000;
export const KF_WINDOW_MESSAGES = 5;

// 微信客服 (customer service) adapter. The 48h/5-message window is enforced
// here, not by the followup domain, because it is a WeCom delivery rule.
export function createKfAdapter({ config, WecomApi, fetchImpl = fetch, now = Date.now }) {
  const capabilities = {
    receive: "push",
    send: "direct",
    history: true,
    groups: false,
    contacts: false,
    binding: true,
    qr: false,
  };
  const listeners = new Set();
  const client = (kind = "kf") => {
    const value = config();
    const secret = kind === "kf" ? value.kfSecret : value.appSecret;
    check(value.corpId && secret, "WECOM_UNCONFIGURED", "企业微信客服未配置", 503);
    return new WecomApi({ corpId: value.corpId, secret, fetch: fetchImpl, now });
  };
  const blocked = (target = {}) => {
    const value = config();
    if (!value.corpId || !value.kfSecret || !value.openKfId) return "微信客服未配置";
    if (!target.kfExternalUserId) return "该患者尚未通过微信客服联系";
    const last = Date.parse(target.kfLastInboundAt || "");
    if (!Number.isFinite(last) || now() - last > KF_WINDOW_MS)
      return "患者超过 48 小时未在微信客服发消息，微信客服暂不能主动发送";
    if ((target.kfSentSinceInbound || 0) >= KF_WINDOW_MESSAGES)
      return "患者上次发消息后已回复 5 条，需等患者再次发消息";
    return "";
  };
  return {
    id: "wecom-kf",
    label: "企业微信客服",
    capabilities,
    kfBlocked: blocked,
    async status() {
      const value = config();
      return {
        state:
          value.corpId && value.kfSecret && value.openKfId ? "ready" : "unconfigured",
        account: value.openKfId || null,
        lastError: null,
        capabilities,
      };
    },
    async configure(input = {}) {
      // Care channel settings own this vault entry; this adapter only reads it.
      if (input && Object.keys(input).length)
        throw new AppError(
          "WECOM_CONFIG",
          "请通过患者消息渠道设置保存微信客服配置",
          400,
        );
      return this.status();
    },
    async send(target = {}, message, opts = {}) {
      const reason = blocked(target);
      if (reason) throw new AppError("WECOM_KF_WINDOW", reason, 409);
      const value = config();
      const text = typeof message === "string" ? message : String(message?.text || "");
      check(text.trim(), "INVALID_INPUT", "发送内容为空", 400);
      const body = await client().sendKf({
        externalUserId: target.kfExternalUserId,
        openKfId: value.openKfId,
        text,
      });
      return {
        deliveryId: opts.requestId || undefined,
        state: "sent",
        externalId: body.msgid || undefined,
        sentAt: new Date(now()).toISOString(),
      };
    },
    async listConversations() {
      return { conversations: [], partial: false };
    },
    onMessage(handler) {
      check(typeof handler === "function", "CHANNEL_ADAPTER_INVALID", "消息处理器必须是函数");
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    emitMessage(message) {
      for (const listener of listeners) {
        try {
          listener(message);
        } catch {
          // A consumer must not break callback acknowledgement.
        }
      }
    },
    async health() {
      const value = config();
      return { ok: Boolean(value.corpId && value.kfSecret && value.openKfId) };
    },
    async start() {},
    async stop() {
      listeners.clear();
    },
  };
}
