import { definePlugin } from "../../../../server/plugin-host/define.mjs";

export default definePlugin({
  id: "service-consumer",
  version: "1.0.0",
  title: "服务消费者",
  enabledByDefault: true,
  requires: { plugins: { "service-provider": "^1.0.0" } },
  setup(ctx) {
    const service = ctx.service("echo", { apiVersion: 2 });
    return {
      call(text) {
        return service.echo(text);
      },
      sameAsPlugins: ctx.plugins["service-provider"].service === service,
      apiVersion: ctx.plugins["service-provider"].apiVersion,
    };
  },
});
