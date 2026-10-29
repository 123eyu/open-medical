import { definePlugin } from "../../../../server/plugin-host/define.mjs";

export default definePlugin({
  id: "setup-throws",
  version: "1.0.0",
  title: "初始化抛错",
  enabledByDefault: true,
  setup() {
    throw new Error("fixture setup failed");
  },
});
