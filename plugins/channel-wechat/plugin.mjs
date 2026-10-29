import { definePlugin } from "../../server/plugin-host/define.mjs";
import { createWechatService } from "./service.mjs";
import { createWechatApi, WECHAT_LEGACY_API_PATHS } from "./api.mjs";

export default definePlugin({
  id: "channel-wechat",
  version: "1.0.0",
  title: "个人微信",
  enabledByDefault: true,
  requires: { plugins: { channel: "*" } },
  provides: { service: "channel-wechat", apiVersion: 1 },
  capabilities: ["channel.adapters"],
  legacyTables: ["chat_connections"],
  migrations: "./migrations",
  tablePrefix: "wechat_",
  legacyApiPaths: WECHAT_LEGACY_API_PATHS,
  setup(ctx) {
    const host = ctx.services.channelWechatHost || {};
    return createWechatService({
      db: ctx.db,
      vault: host.vault,
      dataDir: host.dataDir,
      channel: ctx.services.channel,
      getChat: host.getChat,
      reader: host.reader,
      exp: host.exp,
      bridge: host.bridge,
      wxcli: host.wxcli,
      createReader: host.createReader,
      createExp: host.createExp,
      options: host.options || {},
      log: host.log || ((message) => console.error(`[wechat-exp] ${message}`)),
      fetchImpl: host.fetch,
      now: host.now,
    });
  },
  api(ctx, req, url, io) {
    return createWechatApi(ctx.plugins["channel-wechat"].service)(
      ctx,
      req,
      url,
      io,
    );
  },
  lifecycle: {
    // Lifecycle still needs cleanup after a runtime disable, so use the
    // provided-service record instead of ctx.service() (which rejects disabled
    // plugins for request-time calls).
    start(ctx) {
      return ctx.plugins["channel-wechat"].service.start();
    },
    stop(ctx) {
      return ctx.plugins["channel-wechat"].service.stop();
    },
  },
});
