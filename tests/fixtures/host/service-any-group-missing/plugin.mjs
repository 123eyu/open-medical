import { definePlugin } from "../../../../server/plugin-host/define.mjs";

export default definePlugin({
  id: "service-any-group-missing",
  version: "1.0.0",
  title: "anyOf 缺少其中一组",
  enabledByDefault: true,
  requires: {
    anyOf: [
      ["service-provider"],
      ["missing-group-only"],
    ],
  },
  setup() {
    return {};
  },
});
