import { definePlugin } from "../../../../server/plugin-host/define.mjs";

export default definePlugin({
  id: "service-version",
  version: "1.0.0",
  title: "版本不匹配",
  enabledByDefault: true,
  requires: { plugins: { "service-provider": "^2.0.0" } },
  setup() {
    return {};
  },
});
