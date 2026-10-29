import { definePlugin } from "../../../../server/plugin-host/define.mjs";

export default definePlugin({
  id: "lifecycle-a",
  version: "1.0.0",
  title: "lifecycle-a",
  enabledByDefault: true,
  setup() {
    return { id: "lifecycle-a" };
  },
  lifecycle: {
    async start() {
    (globalThis.__pluginLifecycleLog ||= []).push("lifecycle-a:start");
    },
    async stop() {
      (globalThis.__pluginLifecycleLog ||= []).push("lifecycle-a:stop");
    },
  },
});
