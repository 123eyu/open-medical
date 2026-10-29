import { definePlugin } from "../../server/plugin-host/define.mjs";
import { createChannelService } from "./service.mjs";
import { MessageGateway, messagingApi } from "./server/gateway.mjs";

// The channel foundation owns the generic message gateway only. Concrete
// WeCom/WeChat adapters are separate plugins that register through the
// `channel` service, so this plugin has no business-specific adapters yet.
export default definePlugin({
  id: "channel",
  version: "1.0.0",
  title: "消息渠道",
  enabledByDefault: true,
  provides: { service: "channel", apiVersion: 1 },
  legacyTables: ["message_channels", "message_peers", "message_inbox"],
  legacyApiPaths: [
    { method: "*", path: "/api/message-channels" },
    { method: "*", path: "/api/message-channels/*" },
  ],
  setup(ctx) {
    const host = ctx.services.channelHost || {};
    const gateway = new MessageGateway({
      store: ctx.services.store,
      vault: host.vault,
      bridge: host.bridge,
      getProvider: host.getProvider,
      getKnowledgeBot: host.getKnowledgeBot,
      ...(host.options || {}),
    });
    return createChannelService({ gateway });
  },
  lifecycle: {
    // Lifecycle must still be able to clean up after a plugin is disabled at
    // runtime, so use the provided-service record rather than ctx.service(),
    // which correctly rejects disabled plugins for request-time calls.
    start(ctx) {
      ctx.plugins.channel.service.gateway.start();
    },
    async stop(ctx) {
      await ctx.plugins.channel.service.gateway.stop();
    },
  },
  async api(ctx, req, url, io) {
    return messagingApi(ctx.service("channel").gateway, req, url, {
      body: io.body,
      send: io.send,
    });
  },
});
