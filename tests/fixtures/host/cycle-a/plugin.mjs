import { definePlugin } from "../../../../server/plugin-host/define.mjs";

export default definePlugin({
  id: "cycle-a",
  version: "1.0.0",
  title: "循环 A",
  enabledByDefault: true,
  requires: { plugins: { "cycle-b": "*" } },
  setup() {
    return {};
  },
});
