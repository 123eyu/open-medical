import { definePlugin } from "../../../../server/plugin-host/define.mjs";

export default definePlugin({
  id: "status-provider",
  version: "1.0.0",
  title: "状态提供者",
  enabledByDefault: true,
  capabilities: ["echo"],
  setup() {
    return { echo: (text) => ({ text }) };
  },
  status(ctx) {
    const connected = ctx.config.get("connected");
    return {
      connected: connected === undefined ? true : Boolean(connected),
      capabilities: ["echo", "connected"],
    };
  },
});
