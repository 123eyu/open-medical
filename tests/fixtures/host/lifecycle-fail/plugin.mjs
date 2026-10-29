import { definePlugin } from "../../../../server/plugin-host/define.mjs";

export default definePlugin({
  id: "lifecycle-fail",
  version: "1.0.0",
  title: "lifecycle-fail",
  enabledByDefault: true,
  setup() {
    return { id: "lifecycle-fail" };
  },
  lifecycle: {
    async start() {
    (globalThis.__pluginLifecycleLog ||= []).push("lifecycle-fail:start");
    throw new Error("fixture lifecycle start failed");
    },
    async stop() {
      (globalThis.__pluginLifecycleLog ||= []).push("lifecycle-fail:stop");
    },
  },
});
