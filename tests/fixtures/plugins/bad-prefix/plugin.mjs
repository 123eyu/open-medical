import { definePlugin } from "../../../../server/plugin-host/define.mjs";

export default definePlugin({
  id: "bad-prefix",
  version: "1.0.0",
  title: "错误表名前缀",
  enabledByDefault: true,
  migrations: "./migrations",
  tablePrefix: "bad_prefix_",
  setup() {
    return { loaded: true };
  },
});
