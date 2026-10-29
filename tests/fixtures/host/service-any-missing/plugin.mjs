import { definePlugin } from "../../../../server/plugin-host/define.mjs";

export default definePlugin({
  id: "service-any-missing",
  version: "1.0.0",
  title: "anyOf 不满足",
  enabledByDefault: true,
  requires: { anyOf: [["missing-a", "missing-b"]] },
  setup() {
    return {};
  },
});
