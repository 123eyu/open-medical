import { definePlugin } from "../../../../server/plugin-host/define.mjs";

export default definePlugin({
  id: "needs-missing",
  version: "1.0.0",
  title: "缺少依赖",
  enabledByDefault: true,
  requires: { plugins: { "not-installed": "*" } },
  setup() {
    return { loaded: true };
  },
});
