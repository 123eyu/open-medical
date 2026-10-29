import { AppError } from "../../../server/errors.mjs";

// wx-cli is a local, read-only HTTP interface (127.0.0.1:9100). It has no
// outgoing path: the adapter exposes only status and conversation reads.
export function createWxCliAdapter({ db, vault, WxCliClient }) {
  const capabilities = {
    receive: "poll",
    send: "none",
    history: true,
    groups: true,
    contacts: false,
    binding: true,
    qr: false,
  };
  const config = () => {
    const row = db
      .prepare("SELECT data FROM chat_connections WHERE channel='wx-cli'")
      .get();
    const connection = row ? JSON.parse(row.data) : {};
    return {
      endpoint: connection.endpoint || "http://127.0.0.1:9100",
      accountId: connection.accountId || "",
      token: vault?.get("chat:wx-cli")?.token || "",
      conversations: connection.conversations || [],
    };
  };
  const configured = () => {
    const value = config();
    return Boolean(value.endpoint && value.accountId);
  };
  const client = () => new WxCliClient();
  return {
    id: "wechat-cli",
    label: "个人微信（wx-cli）",
    capabilities,
    async status() {
      if (!configured())
        return {
          state: "unconfigured",
          account: null,
          lastError: null,
          capabilities,
        };
      try {
        const result = await client().status(config());
        return {
          state: result?.ready ? "ready" : "unconfigured",
          account: config().accountId || null,
          lastError: result?.ready ? null : result?.message || null,
          capabilities,
        };
      } catch (error) {
        return {
          state: "failed",
          account: config().accountId || null,
          lastError: String(error?.message || "wx-cli 不可用").slice(0, 500),
          capabilities,
        };
      }
    },
    async listConversations() {
      if (!configured())
        throw new AppError("WXCLI_UNCONFIGURED", "wx-cli 未配置", 503);
      return client().conversations(config());
    },
    async configure() {
      throw new AppError(
        "WXCLI_CONFIG",
        "请在聊天随访设置中保存 wx-cli 配置",
        400,
      );
    },
    async health() {
      if (!configured()) return { ok: false };
      try {
        await client().health(config());
        return { ok: true };
      } catch {
        return { ok: false };
      }
    },
    async start() {},
    async stop() {},
  };
}
