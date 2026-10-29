import { definePlugin } from "../../../../server/plugin-host/define.mjs";

// Test-only plugin: its transactional patient.deleted hook always fails so the
// host's rollback contract can be verified without a real domain plugin.
export default definePlugin({
  id: "delete-throws",
  version: "1.0.0",
  title: "删除抛错测试",
  enabledByDefault: true,
  setup() {
    return {};
  },
  hooks: {
    "patient.deleted"() {
      throw new Error("delete hook failed");
    },
  },
});
