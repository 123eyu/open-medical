import { definePlugin } from "../../../../server/plugin-host/define.mjs";

export default definePlugin({
  id: "cycle-b",
  version: "1.0.0",
  title: "循环 B",
  enabledByDefault: true,
  requires: { plugins: { "cycle-a": "*" } },
  setup() {
    return {};
  },
});
