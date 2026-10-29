import { definePlugin } from "../../../../server/plugin-host/define.mjs";

export default definePlugin({
  id: "service-api-version",
  version: "1.0.0",
  title: "接口版本不匹配",
  enabledByDefault: true,
  requires: { plugins: { "service-provider": "*" } },
  setup(ctx) {
    ctx.service("echo", { apiVersion: 99 });
    return {};
  },
});
