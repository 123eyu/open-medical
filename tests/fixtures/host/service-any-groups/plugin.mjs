import { definePlugin } from "../../../../server/plugin-host/define.mjs";

export default definePlugin({
  id: "service-any-groups",
  version: "1.0.0",
  title: "anyOf 多组同时满足",
  enabledByDefault: true,
  requires: {
    anyOf: [
      ["missing-groups-a", "service-provider"],
      ["missing-groups-b", "service-array"],
    ],
  },
  setup(ctx) {
    return { echo: ctx.service("echo").echo("groups") };
  },
});
