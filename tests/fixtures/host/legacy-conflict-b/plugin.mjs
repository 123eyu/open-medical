import { definePlugin } from "../../../../server/plugin-host/define.mjs";

export default definePlugin({
  id: "legacy-conflict-b",
  version: "1.0.0",
  title: "路由冲突 B",
  enabledByDefault: true,
  legacyApiPaths: [{ method: "GET", path: "/api/legacy/conflict" }],
  api(ctx, req, url, io) {
    io.send(200, { plugin: ctx.plugin.id });
    return true;
  },
});
