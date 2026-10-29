import { definePlugin } from "../../../../server/plugin-host/define.mjs";

// Test-only channel adapter used to put followup into its active state without
// connecting a real WeChat/WeCom account. It is injected through
// MEDICAL_PLUGIN_DIRS / pluginDirs and is never enabled in production.
let connected = true;
const adapter = {
  id: "channel-fake",
  label: "测试渠道（已连接）",
  capabilities: {
    receive: "none",
    send: "none",
    history: false,
    groups: false,
    contacts: false,
    binding: false,
    qr: false,
  },
  async status() {
    return {
      state: connected ? "ready" : "unconfigured",
      account: "fixture",
      lastError: connected ? null : "fixture disconnected",
    };
  },
  async start() {},
  async stop() {},
};

export default definePlugin({
  id: "channel-fake",
  version: "1.0.0",
  title: "测试渠道",
  enabledByDefault: true,
  requires: { plugins: { channel: "*" } },
  provides: { service: "channel-fake", apiVersion: 1 },
  capabilities: ["channel.adapters"],
  setup(ctx) {
    const channel = ctx.plugins.channel?.service || null;
    let registered = false;
    const register = () => {
      if (registered || !channel) return;
      channel.register(adapter);
      registered = true;
    };
    register();
    return {
      adapter,
      get registered() {
        return registered;
      },
      // Consumed by the followup plugin's activation status.
      followupChannels() {
        return [
          {
            id: adapter.id,
            enabled: connected,
            state: connected ? "ready" : "unconfigured",
          },
        ];
      },
      setConnected(value) {
        connected = Boolean(value);
        return connected;
      },
      start() {
        register();
      },
      stop() {
        if (registered) channel?.unregister?.(adapter.id);
        registered = false;
      },
    };
  },
  lifecycle: {
    start(ctx) {
      return ctx.plugins["channel-fake"].service.start();
    },
    stop(ctx) {
      return ctx.plugins["channel-fake"].service.stop();
    },
  },
});
