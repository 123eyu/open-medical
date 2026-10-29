import { definePlugin } from "../../../../server/plugin-host/define.mjs";

export default definePlugin({
  id: "service-any",
  version: "1.0.0",
  title: "anyOf 满足",
  enabledByDefault: true,
  requires: { anyOf: [["missing-a"], ["service-provider"]] },
  setup(ctx) {
    return { echo: ctx.service("echo").echo("any") };
  },
});
