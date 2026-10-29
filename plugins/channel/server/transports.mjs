import * as Lark from "@larksuiteoapi/node-sdk";
import { randomBytes } from "node:crypto";
import { AppError, check } from "../../../server/errors.mjs";

const quiet = { debug() {}, info() {}, warn() {}, error() {}, trace() {} };
export function feishuSocket(options, handler) {
  const socket = new Lark.WSClient({ ...options, logger: quiet });
  return {
    start: () =>
      socket.start({
        eventDispatcher: new Lark.EventDispatcher({ logger: quiet }).register({
          "im.message.receive_v1": handler,
        }),
      }),
    close: () => socket.close({ force: true }),
  };
}
export function wechatOrigin(value = "https://ilinkai.weixin.qq.com") {
  let url;
  try {
    url = new URL(value);
  } catch {
    /* checked below */
  }
  check(
    url?.protocol === "https:" &&
      /^ilink[a-z0-9-]*\.weixin\.qq\.com$/.test(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash,
    "INVALID_CONNECTION",
    "微信连接地址无效",
  );
  return url.origin;
}
export const wechatHeaders = (token) => ({
  "iLink-App-Id": "bot",
  "iLink-App-ClientVersion": "131586",
  "Content-Type": "application/json",
  ...(token
    ? {
        AuthorizationType: "ilink_bot_token",
        Authorization: `Bearer ${token}`,
        "X-WECHAT-UIN": Buffer.from(
          String(randomBytes(4).readUInt32BE()),
        ).toString("base64"),
      }
    : {}),
});

// A transport owns network lifecycle only. Authorization, inbox and agent work live in Gateway.
export class MessageTransport {
  constructor({
    connection,
    secret,
    fetchImpl = fetch,
    createSocket = feishuSocket,
    receive,
    state,
    cursor,
    saveCursor,
    getContext,
    saveContext,
  }) {
    Object.assign(this, {
      connection,
      secret,
      fetchImpl,
      createSocket,
      receive,
      state,
      cursor,
      saveCursor,
      getContext,
      saveContext,
    });
    this.controllers = new Set();
    this.stopped = false;
  }
  async request(url, init = {}, timeout = 15000) {
    check(!this.stopped, "CANCELLED", "连接已停止", 409);
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), timeout);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        redirect: "error",
        signal: controller.signal,
      });
      const data = await response.json();
      check(
        response.ok,
        "PLATFORM_REJECTED",
        `平台返回 HTTP ${response.status}`,
        502,
      );
      return data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "DELIVERY_UNKNOWN",
        "网络中断，无法确认平台是否收到消息",
        502,
      );
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }
  async feishu(path, body) {
    if (!this.token || this.tokenExpiry < Date.now()) {
      const data = await this.request(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            app_id: this.connection.appId,
            app_secret: this.secret.appSecret,
          }),
        },
      );
      check(
        data.code === 0 && data.tenant_access_token,
        "PLATFORM_REJECTED",
        "飞书凭证验证失败",
        502,
      );
      this.token = data.tenant_access_token;
      this.tokenExpiry =
        Date.now() + Math.max(0, (Number(data.expire) || 0) - 60) * 1000;
    }
    const data = await this.request("https://open.feishu.cn/open-apis" + path, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    });
    check(
      data.code === 0,
      "PLATFORM_REJECTED",
      "飞书未接受请求，请检查应用权限和发布状态",
      502,
    );
    return data;
  }
  async start() {
    this.state("connecting");
    if (this.connection.platform === "feishu") {
      await this.feishu("/bot/v3/info");
      if (this.stopped) return;
      this.socket = this.createSocket(
        {
          appId: this.connection.appId,
          appSecret: this.secret.appSecret,
          onReady: () => !this.stopped && this.state("connected"),
          onError: () => !this.stopped && this.state("failed"),
          onReconnecting: () => !this.stopped && this.state("reconnecting"),
          onReconnected: () => !this.stopped && this.state("connected"),
        },
        (event) => this.feishuEvent(event),
      );
      await this.socket.start();
    } else this.polling = this.poll();
  }
  feishuEvent(event) {
    const m = event?.message,
      senderId = event?.sender?.sender_id?.open_id;
    if (
      this.stopped ||
      event?.sender?.sender_type !== "user" ||
      m?.chat_type !== "p2p" ||
      m.message_type !== "text"
    )
      return;
    if (
      !/^ou_[\w]+$/.test(senderId || "") ||
      !/^oc_[\w]+$/.test(m.chat_id || "") ||
      !/^om_[\w]+$/.test(m.message_id || "")
    )
      return;
    const at = Number(m.create_time);
    if (!Number.isFinite(at) || Math.abs(Date.now() - at) > 86400000) return;
    let text;
    try {
      text = JSON.parse(m.content).text;
    } catch {
      return;
    }
    this.receive({ id: m.message_id, chatId: m.chat_id, senderId, text });
  }
  async poll() {
    let backoff = 1000;
    while (!this.stopped) {
      try {
        const data = await this.request(
          `${wechatOrigin(this.secret.baseUrl)}/ilink/bot/getupdates`,
          {
            method: "POST",
            headers: wechatHeaders(this.secret.botToken),
            body: JSON.stringify({
              get_updates_buf: this.cursor || "",
              base_info: { channel_version: "2.2.0" },
            }),
          },
          45000,
        );
        if (this.stopped) break;
        if (data.ret || data.errcode) {
          this.state("failed");
          break;
        }
        check(
          Array.isArray(data.msgs ?? []) && (data.msgs || []).length <= 1000,
          "PLATFORM_REJECTED",
          "微信消息格式无效",
        );
        this.state("connected");
        backoff = 1000;
        for (const item of data.msgs || []) {
          const m = item.msg || item;
          // Only the QR-bound doctor may use this private assistant. No ordinary group ingestion.
          if (m.from_user_id !== this.secret.userId || m.message_type !== 1)
            continue;
          const text = (m.item_list || [])
            .filter((i) => i.type === 1)
            .map((i) => i.text_item?.text || "")
            .join("\n");
          if (
            typeof m.context_token === "string" &&
            m.context_token.length <= 16384
          )
            this.saveContext(m.from_user_id, m.context_token);
          this.receive({
            id: String(m.message_id || m.client_id || ""),
            chatId: m.from_user_id,
            senderId: m.from_user_id,
            text,
          });
        }
        // Cursor moves only after every accepted message is durably recorded.
        if (typeof data.get_updates_buf === "string") {
          this.saveCursor(data.get_updates_buf);
          this.cursor = data.get_updates_buf;
        }
        if (!(data.msgs || []).length) await this.delay(500);
      } catch {
        if (this.stopped) break;
        this.state("reconnecting");
        await this.delay(backoff);
        backoff = Math.min(backoff * 2, 30000);
      }
    }
  }
  delay(ms) {
    return new Promise((resolve) => {
      this.wake = resolve;
      this.timer = setTimeout(resolve, ms);
      this.timer.unref?.();
    });
  }
  async send(peer, text, clientId) {
    if (this.connection.platform === "feishu")
      return this.feishu("/im/v1/messages?receive_id_type=chat_id", {
        receive_id: peer.chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
        uuid: clientId,
      });
    const context = this.getContext(peer.senderId);
    check(
      context,
      "PLATFORM_REJECTED",
      "请先向微信机器人发送一条消息，再重试回复",
    );
    const data = await this.request(
      `${wechatOrigin(this.secret.baseUrl)}/ilink/bot/sendmessage`,
      {
        method: "POST",
        headers: wechatHeaders(this.secret.botToken),
        body: JSON.stringify({
          base_info: { channel_version: "2.2.0" },
          msg: {
            from_user_id: this.secret.botId,
            to_user_id: peer.senderId,
            client_id: clientId,
            context_token: context,
            message_type: 2,
            message_state: 2,
            item_list: [{ type: 1, text_item: { text } }],
          },
        }),
      },
    );
    check(
      (data.ret === 0 || data.errcode === 0) && !data.ret && !data.errcode,
      "PLATFORM_REJECTED",
      "微信未接受回复，请重新向机器人发消息或重新扫码",
      502,
    );
  }
  async stop() {
    this.stopped = true;
    this.socket?.close();
    for (const c of this.controllers) c.abort();
    clearTimeout(this.timer);
    this.wake?.();
    await this.polling;
  }
}
