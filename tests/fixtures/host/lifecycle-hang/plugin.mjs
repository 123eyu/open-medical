import { definePlugin } from "../../../../server/plugin-host/define.mjs";

export default definePlugin({
  id: "lifecycle-hang",
  version: "1.0.0",
  title: "lifecycle-hang",
  enabledByDefault: true,
  setup() {
    return { id: "lifecycle-hang" };
  },
  lifecycle: {
    async start() {
    (globalThis.__pluginLifecycleLog ||= []).push("lifecycle-hang:start");
    },
    async stop() {
      (globalThis.__pluginLifecycleLog ||= []).push("lifecycle-hang:stop");
    },
    async drain() {
      (globalThis.__pluginLifecycleLog ||= []).push("lifecycle-hang:drain");
      await new Promise(() => {});
    },
  },
});
