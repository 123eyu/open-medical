import { definePlugin } from "../../../../server/plugin-host/define.mjs";

export default definePlugin({
  id: "lifecycle-drain",
  version: "1.0.0",
  title: "lifecycle-drain",
  enabledByDefault: true,
  setup() {
    return { id: "lifecycle-drain" };
  },
  lifecycle: {
    async start() {
    (globalThis.__pluginLifecycleLog ||= []).push("lifecycle-drain:start");
    },
    async stop() {
      (globalThis.__pluginLifecycleLog ||= []).push("lifecycle-drain:stop");
    },
    async drain() {
      (globalThis.__pluginLifecycleLog ||= []).push("lifecycle-drain:drain");
      await new Promise((resolve) => setTimeout(resolve, 10));
    },
  },
});
