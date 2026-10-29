import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { check } from "../../../server/errors.mjs";

const KEY = "message-feishu-registration";
const ENDPOINT = "https://accounts.feishu.cn/oauth/v1/app/registration";
const bounded = (value, fallback, max) =>
  Number.isFinite(Number(value)) && Number(value) > 0
    ? Math.min(max, Number(value))
    : fallback;
const text = (value, max) =>
  typeof value === "string" && value.length > 0 && value.length <= max;

// PersonalAgent registration follows larksuite/cli internal/auth/app_registration.go.
// Pending device codes and consumed credentials remain in the local encrypted vault.
export class FeishuRegistration {
  constructor({ vault, accept, canStart, key = KEY, fetchImpl = fetch, now = Date.now }) {
    Object.assign(this, { vault, accept, canStart, key, fetchImpl, now });
    this.controllers = new Set();
    this.stopped = false;
  }
  current() {
    return this.vault.get(this.key);
  }
  save(value) {
    this.vault.set(this.key, value);
  }
  publicStatus() {
    let flow = this.current();
    if (!flow.id) return { status: "idle" };
    if (
      flow.status === "pending" &&
      !flow.credentials &&
      flow.expiresAt <= this.now()
    ) {
      flow = {
        id: flow.id,
        status: "expired",
        error: "绑定链接已过期，请重新生成。",
      };
      this.save(flow);
    }
    const { id, status, url, image, expiresAt, interval, error, channelId } =
      flow;
    return { id, status, url, image, expiresAt, interval, error, channelId };
  }
  async request(form) {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 15000);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(form).toString(),
        redirect: "error",
        signal: controller.signal,
      });
      // OAuth pending/slow_down are valid JSON responses, usually HTTP 400.
      const data = await response.json();
      if ((!response.ok && !data.error) || response.status >= 500)
        throw Error("upstream unavailable");
      return data;
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }
  async begin(consentModel = "") {
    check(
      !this.stopped && !this.starting,
      "BUSY",
      "正在生成绑定链接，请稍候。",
      409,
    );
    this.canStart();
    if (this.publicStatus().status === "pending") return this.publicStatus();
    this.starting = true;
    try {
      let data;
      try {
        data = await this.request({
          action: "begin",
          archetype: "PersonalAgent",
          auth_method: "client_secret",
          request_user_info: "open_id tenant_brand",
        });
      } catch {
        check(
          false,
          "BINDING_UNAVAILABLE",
          "暂时无法连接飞书，请稍后重新生成绑定链接。",
          502,
        );
      }
      check(
        !this.stopped,
        "CANCELLED",
        "应用正在退出，请重新打开后连接。",
        409,
      );
      check(
        !data.error &&
          text(data.device_code, 4096) &&
          text(data.user_code, 512),
        "BINDING_UNAVAILABLE",
        "飞书暂未提供绑定链接，请稍后重试。",
        502,
      );
      const url = new URL("https://open.feishu.cn/page/cli");
      url.searchParams.set("user_code", data.user_code);
      const flow = {
        id: randomUUID(),
        status: "pending",
        code: data.device_code,
        url: url.href,
        image: await QRCode.toDataURL(url.href, { width: 240, margin: 2 }),
        expiresAt:
          this.now() +
          bounded(data.expire_in || data.expires_in, 600, 1800) * 1000,
        interval: bounded(data.interval, 5, 60),
        nextPoll: 0,
        consentModel,
      };
      check(
        !this.stopped,
        "CANCELLED",
        "应用正在退出，请重新打开后连接。",
        409,
      );
      this.canStart();
      this.save(flow);
      return this.publicStatus();
    } finally {
      this.starting = false;
    }
  }
  cancel(id) {
    const flow = this.current();
    if (flow.id === id && flow.status === "pending")
      this.save({ id, status: "cancelled" });
    return this.publicStatus();
  }
  poll(id) {
    const status = this.publicStatus();
    check(
      !id || status.id === id,
      "BINDING_REPLACED",
      "绑定链接已更新，请刷新页面。",
      409,
    );
    if (this.job) return this.job;
    this.job = this.advance().finally(() => {
      this.job = null;
    });
    return this.job;
  }
  async advance() {
    const flow = this.current();
    if (this.stopped || flow.status !== "pending" || flow.nextPoll > this.now())
      return this.publicStatus();
    try {
      if (!flow.credentials) {
        const data = await this.request({
          action: "poll",
          device_code: flow.code,
        });
        if (
          this.publicStatus().id !== flow.id ||
          this.publicStatus().status !== "pending"
        )
          return this.publicStatus();
        if ((data.user_info?.tenant_brand || "feishu") !== "feishu") {
          this.save({
            id: flow.id,
            status: "failed",
            error: "请使用飞书账号绑定；当前连接暂不支持 Lark 国际版。",
          });
          return this.publicStatus();
        }
        if (
          !data.error &&
          /^cli_[a-zA-Z0-9]{8,64}$/.test(data.client_id || "") &&
          text(data.client_secret, 512)
        ) {
          if (!/^ou_[a-zA-Z0-9]+$/.test(data.user_info?.open_id || '')) {
            this.save({ id: flow.id, status: 'failed', error: '飞书未返回绑定账号，请重新扫码。' });
            return this.publicStatus();
          }
          flow.credentials = {
            appId: data.client_id,
            appSecret: data.client_secret,
            openId: data.user_info?.open_id || "",
          };
          // Persist a consumed registration before attaching the channel, so a restart can resume.
          delete flow.code;
          this.save(flow);
        } else {
          if (
            ["access_denied", "expired_token", "invalid_grant"].includes(
              data.error,
            )
          ) {
            this.save({
              id: flow.id,
              status: data.error === "access_denied" ? "denied" : "expired",
              error:
                data.error === "access_denied"
                  ? "已取消飞书授权，可以重新连接。"
                  : "绑定链接已过期，请重新生成。",
            });
          } else if (
            data.error &&
            !["authorization_pending", "slow_down"].includes(data.error)
          ) {
            this.save({
              id: flow.id,
              status: "failed",
              error: "飞书未完成绑定，请重新生成链接并按页面提示确认。",
            });
          } else {
            if (data.error === "slow_down")
              flow.interval = Math.min(60, flow.interval + 5);
            this.save({
              ...flow,
              nextPoll: this.now() + flow.interval * 1000,
              error: "",
            });
          }
          return this.publicStatus();
        }
      }
      if (this.stopped) return this.publicStatus();
      // accept synchronously commits channel + credentials + completion in one SQLite transaction.
      const channelId = this.accept(flow, () =>
        this.save({ id: flow.id, status: "bound", channelId: flow.channelId }),
      );
      return { ...this.publicStatus(), channelId };
    } catch {
      if (
        this.current().id === flow.id &&
        this.current().status === "pending"
      ) {
        this.save({
          ...flow,
          nextPoll: this.now() + flow.interval * 1000,
          error: flow.credentials
            ? "授权已收到，正在保存连接，请稍后检查。"
            : "连接飞书暂时中断，将自动重试。",
        });
      }
      return this.publicStatus();
    }
  }
  start() {
    this.stopped = false;
    this.timer = setInterval(() => {
      void this.poll().catch(() => {});
    }, 1000);
    this.timer.unref?.();
  }
  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    for (const controller of this.controllers) controller.abort();
    await this.job;
  }
  clearForChannel(id) {
    if (this.current().channelId === id) this.vault.delete(this.key);
  }
}
