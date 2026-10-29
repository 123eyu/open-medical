import { definePlugin } from "../../../../server/plugin-host/define.mjs";

export default definePlugin({
  id: "service-provider",
  version: "1.2.3",
  title: "服务提供者",
  enabledByDefault: true,
  provides: { service: "echo", apiVersion: 2 },
  setup() {
    return {
      apiVersion: 2,
      echo(text) {
        return { text: String(text ?? ""), apiVersion: 2 };
      },
    };
  },
});
