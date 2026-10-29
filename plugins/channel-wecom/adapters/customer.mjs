// Customer-contact adapter: WeCom deliberately does not let an application
// send directly. A draft becomes a WeCom task that the responsible member
// confirms inside WeCom, so a confirmed send still reports awaiting_member.
const textOf = (message) =>
  typeof message === "string" ? message : String(message?.text || "");

export function createCustomerAdapter({ connector, directory }) {
  const capabilities = {
    receive: "none",
    send: "confirm",
    history: false,
    groups: true,
    contacts: true,
    binding: true,
    qr: false,
  };
  return {
    id: "wecom-customer",
    label: "企业微信客户联系",
    capabilities,
    async status() {
      return {
        state: connector.client ? "ready" : "unconfigured",
        account: connector.corpId || null,
        lastError: null,
        capabilities,
      };
    },
    async configure(input = {}) {
      connector.saveConfig(input);
      return this.status();
    },
    async connect() {
      connector.configure();
      return this.status();
    },
    async disconnect() {
      // Credentials stay in the vault; only the derived client is dropped.
      connector.client = null;
      return this.status();
    },
    async send(target = {}, message, opts = {}) {
      if (opts.confirmed !== true)
        return {
          state: "awaiting_member",
          error: "发送给患者前需要医生确认",
          retryable: false,
        };
      const text = textOf(message);
      if (!text.trim())
        return { state: "failed", error: "发送内容为空", retryable: false };
      const draft = connector.draft({
        patientId: target.patientId,
        bindingId: target.bindingId,
        text,
        requestId: opts.requestId,
      });
      const task = await connector.submit(draft.id, { confirmed: true });
      const state =
        task.status === "sent"
          ? "sent"
          : task.status === "awaiting_member"
            ? "awaiting_member"
            : task.status === "rejected"
              ? "failed"
              : "unknown";
      return {
        deliveryId: task.id,
        state,
        externalId: task.msgid || undefined,
        error:
          state === "failed" || state === "unknown"
            ? task.detail || undefined
            : undefined,
        retryable: false,
      };
    },
    async listContacts(query = {}) {
      return directory.contacts(query);
    },
    async listConversations(query = {}) {
      return directory.groups(query);
    },
    async bind(input) {
      return directory.link(input);
    },
    async unbind(id) {
      return connector.unbind(id);
    },
    async health() {
      return { ok: Boolean(connector.client) };
    },
    async start() {},
    async stop() {},
  };
}
