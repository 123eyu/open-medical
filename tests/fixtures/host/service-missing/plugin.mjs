import { definePlugin } from "../../../../server/plugin-host/define.mjs";

export default definePlugin({
  id: "service-missing",
  version: "1.0.0",
  title: "缺少服务",
  enabledByDefault: true,
  setup(ctx) {
    ctx.service("not-a-service");
    return {};
  },
});
