import { definePlugin } from "__ROOT_REL__/server/plugin-host/define.mjs";
import { check } from "__ROOT_REL__/server/errors.mjs";

// 模板约定：所有新表使用 __PLUGIN_TABLE___ 前缀；迁移只追加，不改旧表。
const NOTES = "__PLUGIN_TABLE___notes";

export default definePlugin({
  id: "__PLUGIN_ID__",
  version: "1.0.0",
  title: "__PLUGIN_TITLE__",
  enabledByDefault: true,
  migrations: "./migrations",
  tablePrefix: "__PLUGIN_TABLE___",
  prompt: "./prompt.md",
  provides: { service: "__PLUGIN_ID__", apiVersion: 1 },

  setup(ctx) {
    return {
      list(patientId) {
        check(typeof patientId === "string" && patientId.trim(), "INVALID_INPUT", "缺少患者");
        return ctx.db
          .prepare(
            `SELECT id,patient_id,text,created_at FROM ${NOTES}
             WHERE patient_id=? ORDER BY created_at DESC,id DESC`,
          )
          .all(patientId)
          .map((row) => ({
            id: row.id,
            patientId: row.patient_id,
            text: row.text,
            createdAt: row.created_at,
          }));
      },
      due(now = new Date().toISOString()) {
        return ctx.db
          .prepare(
            `SELECT id,patient_id,text,due_at FROM ${NOTES}
             WHERE due_at IS NOT NULL AND due_at<=? ORDER BY due_at ASC`,
          )
          .all(now);
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
          name: "__PLUGIN_TOOL___notes_list",
          description: "读取某位患者的模板记录；只读，不修改档案。",
          parameters: {
            type: "object",
            properties: { patientId: { type: "string" } },
            required: ["patientId"],
            additionalProperties: false,
          },
        },
      },
      execute: ({ patientId }) => ({
        notes: ctx.plugins["__PLUGIN_ID__"].service.list(patientId),
      }),
    });
  },

  proposals: {
    "__PLUGIN_ID__.note.create": {
      revisionScoped: true,
      validate(input) {
        check(
          input && typeof input.patientId === "string" && input.patientId.trim(),
          "INVALID_INPUT",
          "记录需要患者",
        );
        check(
          typeof input.text === "string" && input.text.trim(),
          "INVALID_INPUT",
          "记录内容不能为空",
        );
        return {
          patientId: input.patientId,
          text: input.text.trim().slice(0, 2000),
          dueAt: input.dueAt ? String(input.dueAt) : null,
        };
      },
      apply(input, ctx, tx) {
        const createdAt = ctx.now();
        tx.prepare(
          `INSERT INTO ${NOTES}(patient_id,text,due_at,created_at)
           VALUES (?,?,?,?)`,
        ).run(input.patientId, input.text, input.dueAt, createdAt);
        return { patientId: input.patientId, text: input.text };
      },
    },
  },

  agendaSources: [
    {
      kind: "__PLUGIN_ID__",
      label: "__PLUGIN_TITLE__",
      order: 100,
      read(ctx, { now }) {
        return ctx.plugins["__PLUGIN_ID__"].service.due(now).map((row) => ({
          id: `__PLUGIN_ID__:${row.id}`,
          kind: "__PLUGIN_ID__",
          patientId: row.patient_id,
          title: row.text,
          at: row.due_at,
          action: { type: "patient", tab: "p:__PLUGIN_ID__:notes", label: "查看记录" },
        }));
      },
    },
  ],

  async api(ctx, req, url, io) {
    if (url.pathname === "/api/p/__PLUGIN_ID__/ping" && req.method === "GET") {
      io.send(200, { ok: true, plugin: ctx.plugin.id });
      return true;
    }
    if (url.pathname === "/api/p/__PLUGIN_ID__/notes" && req.method === "GET") {
      const patientId = url.searchParams.get("patientId") || "";
      io.send(200, {
        notes: ctx.plugins["__PLUGIN_ID__"].service.list(patientId),
      });
      return true;
    }
    if (url.pathname === "/api/p/__PLUGIN_ID__/notes" && req.method === "POST") {
      const input = await io.body();
      const proposal = ctx.proposals.create({
        kind: "__PLUGIN_ID__.note.create",
        patientId: input.patientId,
        input,
        summary: "新增模板记录",
      });
      io.send(201, { proposal });
      return true;
    }
    return false;
  },

  hooks: {
    "patient.deleted": ({ patientId }, ctx) => {
      ctx.db.prepare(`DELETE FROM ${NOTES} WHERE patient_id=?`).run(patientId);
    },
  },
});
