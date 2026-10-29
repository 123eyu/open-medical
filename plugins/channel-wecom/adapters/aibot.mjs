import { check } from "../../../server/errors.mjs";

// 企业微信智能机器人 adapter. The fixed chat-aibot business pipeline still
// owns drafting/review until T7.3; this adapter only exposes the connection.
export function createAibotAdapter({ getChannel }) {
  const capabilities = {
    receive: "push",
    send: "direct",
    history: false,
    groups: true,
    contacts: false,
    binding: false,
    qr: false,
  };
  const listeners = new Set();
  return {
    id: "wecom-aibot",
    label: "企业微信智能机器人",
    capabilities,
    async status() {
      const channel = getChannel();
      return {
        state: channel?.live ? "ready" : "unconfigured",
        account: channel?.secret ? "configured" : null,
        lastError: null,
        capabilities,
      };
    },
    async send(target = {}, message, opts = {}) {
      const channel = getChannel();
      check(channel, "WECOM_UNCONFIGURED", "企业微信智能机器人未配置", 503);
      // Sending is only allowed after an explicit doctor review.
      check(opts.confirmed === true || opts.consent === true, "CHAT_CONSENT", "请确认回复内容后再发送", 412);
      const text = typeof message === "string" ? message : String(message?.text || "");
      check(text.trim(), "INVALID_INPUT", "回复内容为空", 400);
      if (target.replyId) {
        const row = await channel.sendReply(target.replyId, {
          ...opts,
          consent: true,
          text,
        });
        return { state: "sent", deliveryId: row.id, sentAt: row.sentAt };
      }
      check(channel.live, "CHAT_CHANNEL", "长连接不在线，请稍后重试", 409);
      check(target.conversationId, "INVALID_INPUT", "缺少机器人会话", 400);
      await channel.socket.push(target.conversationId, {
        msgtype: "text",
        text: { content: text },
      });
      return { state: "sent", sentAt: new Date().toISOString() };
    },
    async listConversations() {
      const channel = getChannel();
      return channel ? channel.conversations() : { conversations: [], partial: false };
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
          // Isolated by design.
        }
      }
    },
    async health() {
      return { ok: Boolean(getChannel()?.live) };
    },
    async start() {},
    async stop() {
      listeners.clear();
    },
  };
}
