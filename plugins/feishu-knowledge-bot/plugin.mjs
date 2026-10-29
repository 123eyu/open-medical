import { definePlugin } from "../../server/plugin-host/define.mjs";
import { FeishuKnowledgeBot } from "./server/feishu-knowledge-bot.mjs";

const REPLY = (send, status, value) => {
  send(status, value);
  return true;
};

const botOf = (ctx) => ctx.plugins["feishu-knowledge-bot"]?.service;

// Historical knowledge-bot routes. The scan binding endpoints stay here
// because they only operate on this bot's registration; the registration
// implementation itself comes from the channel plugin service.
function createKnowledgeBotApi(ctx) {
  return async function knowledgeBotApi(req, url, io) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "api" || parts[1] !== "knowledge-bot") return false;
    const bot = botOf(ctx);
    if (!bot) return false;

    if (parts.length === 2 && req.method === "GET")
      return REPLY(io.send, 200, bot.settings());
    if (parts.length === 2 && req.method === "DELETE")
      return REPLY(
        io.send,
        200,
        await bot.disconnect((await io.body()).expectedRevision),
      );
    if (parts.length === 3 && parts[2] === "reset-context" && req.method === "POST")
      return REPLY(
        io.send,
        200,
        await bot.resetContext((await io.body()).expectedRevision),
      );
    if (parts.length === 3 && parts[2] === "feishu-binding") {
      const binding = bot.bindingOrNull();
      if (!binding) return false;
      if (req.method === "POST") return REPLY(io.send, 200, await binding.begin());
      if (req.method === "DELETE")
        return REPLY(io.send, 200, binding.cancel((await io.body()).id));
      return false;
    }
    if (
      parts.length === 4 &&
      parts[2] === "feishu-binding" &&
      parts[3] === "status" &&
      req.method === "POST"
    ) {
      const binding = bot.bindingOrNull();
      if (!binding) return false;
      return REPLY(io.send, 200, await binding.poll((await io.body()).id));
    }
    if (parts.length === 2 && req.method === "PUT") {
      const input = await io.body();
      // The knowledge bot must not share a Feishu app with the doctor chat
      // assistant; reading the channel's public rows keeps table ownership
      // inside the channel plugin.
      const channels = ctx.service("channel").rows("message_channels") || [];
      if (
        input.enabled &&
        channels.some(
          (channel) =>
            channel.enabled &&
            channel.platform === "feishu" &&
            channel.appId === input.appId,
        )
      )
        return REPLY(io.send, 409, {
          error: "该应用正在用于医生助手，请使用独立的知识库机器人应用。",
          code: "CONNECTION_CONFLICT",
        });
      return REPLY(io.send, 200, await bot.save(input));
    }
    return false;
  };
}

export default definePlugin({
  id: "feishu-knowledge-bot",
  version: "1.0.0",
  title: "飞书知识库机器人",
  enabledByDefault: true,
  requires: { plugins: { channel: "*" } },
  provides: { service: "feishu-knowledge-bot", apiVersion: 1 },
  migrations: "./migrations",
  tablePrefix: "knowledge_bot_",
  legacyApiPaths: [
    { method: "*", path: "/api/knowledge-bot" },
    { method: "*", path: "/api/knowledge-bot/*" },
  ],
  setup(ctx) {
    const host = ctx.services.knowledgeBotHost || {};
    return new FeishuKnowledgeBot(ctx.services.store, host.vault, host.library, {
      getProvider: host.getProvider,
      // The scan registration belongs to the channel plugin; resolve it
      // through the public service rather than importing plugin files.
      createFeishuRegistration: (input) =>
        ctx.service("channel").createFeishuRegistration(input),
      ...(host.options || {}),
    });
  },
  lifecycle: {
    start(ctx) {
      const bot = ctx.plugins["feishu-knowledge-bot"]?.service;
      bot?.bindingOrNull()?.start();
      bot?.start();
    },
    async stop(ctx) {
      const bot = ctx.plugins["feishu-knowledge-bot"]?.service;
      await bot?.bindingOrNull()?.stop();
      await bot?.stop();
    },
  },
  api: (ctx, req, url, io) => createKnowledgeBotApi(ctx)(req, url, io),
});
