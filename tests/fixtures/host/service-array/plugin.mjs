import { definePlugin } from "../../../../server/plugin-host/define.mjs";

export default definePlugin({
  id: "service-array",
  version: "1.0.0",
  title: "数组依赖写法",
  enabledByDefault: true,
  requires: { plugins: ["service-provider"] },
  setup(ctx) {
    return { call: (text) => ctx.service("echo").echo(text) };
  },
});
