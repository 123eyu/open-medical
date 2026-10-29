// Historical export import is entirely read-only. Downloads/backups are
// explicit user actions owned by WechatExpService; this adapter only reports
// whether that tool and its produced backup are available.
export function createImportAdapter({ getExp }) {
  const capabilities = {
    receive: "none",
    send: "none",
    history: true,
    groups: false,
    contacts: false,
    binding: false,
    qr: false,
  };
  const exp = () => getExp?.() || null;
  return {
    id: "wechat-import",
    label: "个人微信（历史导出）",
    capabilities,
    async status() {
      const service = exp();
      if (!service)
        return {
          state: "unconfigured",
          account: null,
          lastError: "微信历史导入服务未启用",
          capabilities,
        };
      const value = service.status();
      return {
        state: value?.toolReady ? "ready" : "unconfigured",
        account: value?.account || null,
        lastError: value?.lastError || null,
        capabilities,
      };
    },
    async health() {
      return { ok: Boolean(exp()?.toolReady) };
    },
    async start() {},
    async stop() {},
  };
}
