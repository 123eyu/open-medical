import { WechatReader, validateRegion } from "./server/wechat-reader.mjs";
import { flatName } from "./server/wechat-windows.mjs";
import { parseWechatExportBatch } from "./server/wechat-export.mjs";
import { WxCliClient } from "./server/wx-cli.mjs";
import { WechatExpService } from "./server/wechat-exp.mjs";
import { WeChatMacBridge } from "./server/wechat-bridge.mjs";
import { createDesktopAdapter } from "./adapters/desktop.mjs";
import { createWxCliAdapter } from "./adapters/wxcli.mjs";
import { createImportAdapter } from "./adapters/import.mjs";

// One plugin owns three WeChat adapters. The service also exposes the moved
// reader/import classes so fixed-region modules (chat-followups until T7.3)
// can construct their legacy pipelines without importing plugin files.
export function createWechatService({
  db,
  vault,
  dataDir = process.cwd(),
  channel = null,
  getChat = () => null,
  reader = null,
  exp = null,
  bridge = null,
  wxcli = null,
  createReader = null,
  createExp = null,
  options = {},
  log = () => {},
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  const wechatReader =
    reader || (createReader ? createReader() : new WechatReader(options.reader));
  const wechatExp =
    exp ||
    (createExp
      ? createExp()
      : new WechatExpService({
          dataDir,
          port: options.expPort,
          log,
          fetchImpl,
          spawnTool: options.spawnTool,
          now: options.expNow,
        }));
  const wechatBridge = bridge || new WeChatMacBridge(options.bridge);
  const wxCli = wxcli || new WxCliClient({ fetch: fetchImpl, now });
  const adapters = [
    createDesktopAdapter({ getReader: () => wechatReader, getChat }),
    createWxCliAdapter({ db, vault, WxCliClient: options.WxCliClient || WxCliClient }),
    createImportAdapter({ getExp: () => wechatExp }),
  ];
  let started = false;
  let starting = false;
  const registered = new Set();

  const service = {
    apiVersion: 1,
    reader: wechatReader,
    wechatExp,
    bridge: wechatBridge,
    wxcli: wxCli,
    adapters,
    WechatReader,
    WeChatMacBridge,
    WechatExpService,
    WxCliClient,
    parseWechatExportBatch,
    validateRegion,
    flatName,
    get started() {
      return started;
    },
    get timer() {
      return wechatExp.timer || null;
    },
    adapter(id) {
      return adapters.find((adapter) => adapter.id === id) || null;
    },
    async start() {
      if (started || starting) return;
      starting = true;
      try {
        wechatExp.start(getChat());
        if (channel) {
          for (const adapter of adapters) {
            channel.register(adapter);
            registered.add(adapter.id);
          }
        }
        started = true;
      } finally {
        starting = false;
      }
    },
    async stop() {
      started = false;
      if (channel) {
        for (const id of registered) channel.unregister?.(id);
      }
      registered.clear();
      await wechatExp.stop?.();
    },
  };
  return Object.freeze(service);
}
