import { definePlugin } from "../../server/plugin-host/define.mjs";
import { check, identifier } from "../../server/errors.mjs";
import { CareTasks } from "./server/care-tasks.mjs";
import { careTasksAgendaSources } from "./agenda.mjs";

const REPLY = (send, status, value) => {
  send(status, value);
  return true;
};

const serviceOf = (ctx) => ctx.plugins["care-tasks"]?.service;

function createCareTasksApi(ctx) {
  return async function careTasksApi(req, url, io) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (
      parts[0] !== "api" ||
      parts[1] !== "patients" ||
      parts[3] !== "care-tasks"
    )
      return false;
    const pid = identifier(parts[2]);
    const service = serviceOf(ctx);
    if (parts.length === 4 && req.method === "GET")
      return REPLY(
        io.send,
        200,
        service.list(pid, {
          status: url.searchParams.get("status") || "active",
          offset: Number(url.searchParams.get("offset") || 0),
          limit: Number(url.searchParams.get("limit") || 20),
        }),
      );
    if (parts.length === 4 && req.method === "POST")
      return REPLY(io.send, 201, service.create(pid, await io.body()));
    if (parts.length === 5 && req.method === "PATCH")
      return REPLY(
        io.send,
        200,
        service.update(pid, identifier(parts[4]), await io.body()),
      );
    return false;
  };
}

export default definePlugin({
  id: "care-tasks",
  version: "1.0.0",
  title: "检查与转诊跟进",
  enabledByDefault: true,
  provides: { service: "care-tasks", apiVersion: 1 },
  migrations: "./migrations",
  tablePrefix: ["care_"],
  legacyApiPaths: [
    { method: "*", path: "/api/patients/:id/care-tasks" },
    { method: "*", path: "/api/patients/:id/care-tasks/*" },
  ],
  agendaSources: careTasksAgendaSources,
  patientBrief(ctx, patientId) {
    return ctx.plugins["care-tasks"]?.service?.patientBrief(patientId) || {};
  },
  hooks: {
    "patient.deleted": (payload, ctx) =>
      ctx.plugins["care-tasks"]?.service?.removePatient(payload.patientId),
  },
  demo: {
    async install(ctx, demo) {
      const service = ctx.plugins["care-tasks"]?.service;
      const patient = demo.patient(2);
      if (!service || !patient || patient.archived) return;
      demo.own("tracking", "tracking", () =>
        service.create(patient.id, {
          title: "示例·术后血常规报告跟进",
          kind: "test",
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          note: "练习登记结果、医生复核与告知状态，不创建真实检查医嘱。",
        }),
      );
    },
    async clear(ctx, demo) {
      const service = ctx.plugins["care-tasks"]?.service;
      if (!service) return;
      for (const row of demo.resources().filter((item) => item.kind === "patient"))
        service.removePatient(row.id);
    },
    exists(ctx, kind, id) {
      return (
        kind === "tracking" &&
        Boolean(ctx.db.prepare("SELECT 1 FROM care_tasks WHERE id=?").get(id))
      );
    },
  },
  setup(ctx) {
    // The followup plugin may be disabled while care tracking still works.
    // Resolve its service lazily and only when a completion asks for a new
    // follow-up; setup order must not decide whether that link is available.
    const followups = {
      create(...args) {
        check(
          ctx.services.followupHost?.isActive?.("followup"),
          "FOLLOWUP_UNAVAILABLE",
          "随访功能未启用，无法创建下次随访",
          503,
        );
        return ctx.services.followups.create(...args);
      },
    };
    return new CareTasks(
      ctx.store,
      ctx.services.patients,
      followups,
      { resolvePatientFile: ctx.services.careTasksHost?.resolvePatientFile },
    );
  },
  api: (ctx, req, url, io) => createCareTasksApi(ctx)(req, url, io),
});
