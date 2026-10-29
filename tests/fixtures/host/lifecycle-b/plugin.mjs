import { definePlugin } from "../../../../server/plugin-host/define.mjs";

export default definePlugin({
  id: "lifecycle-b",
  version: "1.0.0",
  title: "lifecycle-b",
  enabledByDefault: true,
  requires: { plugins: { "lifecycle-a": "^1.0.0" } },
  setup() {
    return { id: "lifecycle-b" };
  },
  lifecycle: {
    async start() {
    (globalThis.__pluginLifecycleLog ||= []).push("lifecycle-b:start");
    },
    async stop() {
      (globalThis.__pluginLifecycleLog ||= []).push("lifecycle-b:stop");
    },
  },
});
