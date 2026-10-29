import { AppError } from "../../../server/errors.mjs";

// 会话存档 is read-only. It never exposes a send path.
export function createArchiveAdapter({ db, vault, archive }) {
  const capabilities = {
    receive: "none",
    send: "manual",
    history: true,
    groups: false,
    contacts: false,
    binding: false,
    qr: false,
  };
  const config = () => {
    const row = db.prepare("SELECT data FROM chat_connections WHERE channel='wecom'").get();
    const connection = row ? JSON.parse(row.data) : {};
    return {
      endpoint: connection.endpoint || "",
      accountId: connection.accountId || "",
      token: vault?.get("chat:wecom")?.token || "",
      conversations: connection.conversations || [],
    };
  };
  const configured = () => {
    const value = config();
    return Boolean(value.endpoint && value.accountId && value.token);
  };
  return {
    id: "wecom-archive",
    label: "企业微信会话存档",
    capabilities,
    async status() {
      return {
        state: configured() ? "ready" : "unconfigured",
        account: config().accountId || null,
        lastError: null,
        capabilities,
      };
    },
    async configure() {
      throw new AppError("WECOM_CONFIG", "请在聊天随访设置中保存会话存档配置", 400);
    },
    async listConversations() {
      if (!configured()) throw new AppError("WECOM_UNCONFIGURED", "会话存档未配置", 503);
      return archive.conversations(config());
    },
    async health() {
      return { ok: configured() };
    },
    async start() {},
    async stop() {},
  };
}
