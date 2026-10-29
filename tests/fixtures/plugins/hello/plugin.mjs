import { definePlugin } from "../../../../server/plugin-host/define.mjs";
import { AppError } from "../../../../server/errors.mjs";

export default definePlugin({
  id: "hello",
  version: "1.0.0",
  title: "Hello 示例插件",
  enabledByDefault: false,
  migrations: "./migrations",
  tablePrefix: "hello_",
  prompt: "./prompt.md",
  setup(ctx) {
    const db = ctx.db;
    return {
      echo(text) {
        return { text: String(text ?? ""), plugin: "hello" };
      },
      greetingCount() {
        return db.prepare("SELECT COUNT(*) AS n FROM hello_greetings").get().n;
      },
      listGreetings() {
        return db
          .prepare(
            "SELECT id,name,message,created_at FROM hello_greetings ORDER BY id",
          )
          .all();
      },
    };
  },
  tools(ctx, { registry }) {
    registry.register({
      permission: "tools.execute",
      capability: { backend: "local" },
      definition: {
        type: "function",
        function: {
          name: "hello_echo",
          description: "原样回显一段文本，用于验证领域插件工具已注册并可被 Agent 调用。",
          parameters: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false,
          },
        },
      },
      execute: ({ text }) => ctx.services.hello.echo(text),
    });
  },
  proposals: {
    "hello.greet": {
      validate(input) {
        if (!input || typeof input.name !== "string" || !input.name.trim())
          throw new Error("问候提案需要 name");
        if (typeof input.message !== "string" || !input.message.trim())
          throw new Error("问候提案需要 message");
        return input;
      },
      apply(input, ctx, tx) {
        const createdAt = new Date().toISOString();
        tx.prepare(
          "INSERT INTO hello_greetings(name,message,created_at) VALUES (?,?,?)",
        ).run(input.name.trim(), input.message.trim(), createdAt);
        if (input.fail === true) throw new AppError("HELLO_APPLY_FAILED", "hello.greet apply failed", 422);
        return { name: input.name.trim(), message: input.message.trim() };
      },
    },
  },
  agendaSources: [
    {
      kind: "hello",
      label: "问候",
      read(ctx, { now }) {
        const count = ctx.services.hello.greetingCount();
        return count
          ? [
              {
                id: "hello-greetings",
                kind: "hello",
                title: `已问候 ${count} 次`,
                dueAt: now,
              },
            ]
          : [];
      },
    },
  ],
  api(ctx, req, url, io) {
    if (url.pathname === "/api/p/hello/ping" && req.method === "GET") {
      io.send(200, {
        ok: true,
        plugin: ctx.plugin.id,
        greetings: ctx.services.hello.greetingCount(),
      });
      return true;
    }
    if (url.pathname === "/api/p/hello/greet" && req.method === "POST") {
      return io
        .body(req)
        .then((input) => {
          const proposal = ctx.proposals.create({
            kind: "hello.greet",
            patientId: input.patientId,
            input: {
              name: input.name,
              message: input.message,
              fail: input.fail,
            },
            summary: `向 ${input.name || "患者"} 发送问候`,
          });
          io.send(201, { proposal });
          return true;
        })
        .catch((error) => {
          io.error(error);
          return true;
        });
    }
    return false;
  },
});
