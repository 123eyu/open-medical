import { definePlugin } from "../../server/plugin-host/define.mjs";
import { check, identifier } from "../../server/errors.mjs";
import { TrialRegistry } from "./server/trial-registry.mjs";
import { TrialScreening } from "./server/trial-screening.mjs";
import { TrialCandidates } from "./server/trial-candidates.mjs";
import { TrialEligibilityJobs } from "./server/trial-eligibility-jobs.mjs";
import {
  configureTrialTools,
  TRIAL_GUIDANCE,
  trialAnswer,
} from "./server/trial-eligibility-tools.mjs";
import { trialTools } from "./server/trial-tools.mjs";
import { trialAgendaSources } from "./agenda.mjs";

const REPLY = (send, status, value) => {
  send(status, value);
  return true;
};

const serviceOf = (ctx) => ctx.plugins.trials?.service;

function createTrialApi(ctx) {
  return async function trialApi(req, url, io) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "api" || parts[1] !== "trials") return false;
    const service = serviceOf(ctx);
    const { screening, jobs, candidates, registry } = service;
    if (
      parts.length === 6 &&
      parts[3] === "screenings" &&
      parts[5] === "ai"
    ) {
      const trialId = identifier(parts[2]),
        patientId = identifier(parts[4]);
      screening.get(trialId);
      ctx.services.patients.get(patientId);
      if (req.method === "GET")
        return REPLY(io.send, 200, {
          jobs: jobs.list(trialId, patientId).map((job) => jobs.public(job)),
        });
      if (req.method === "POST")
        return REPLY(
          io.send,
          202,
          jobs.start(trialId, patientId, await io.body()),
        );
    }
    if (
      parts.length === 7 &&
      parts[3] === "screenings" &&
      parts[5] === "ai" &&
      req.method === "DELETE"
    ) {
      const job = jobs.get(identifier(parts[6]));
      check(
        job.trialId === parts[2] && job.patientId === parts[4],
        "NOT_FOUND",
        "初筛任务不存在",
        404,
      );
      return REPLY(io.send, 200, jobs.cancel(job.id));
    }
    if (parts.length === 4 && parts[2] === "registry" && req.method === "GET")
      return REPLY(io.send, 200, await registry.lookup(parts[3]));
    if (
      parts.length === 4 &&
      parts[3] === "candidates" &&
      req.method === "GET"
    )
      return REPLY(
        io.send,
        200,
        candidates.candidates(parts[2], {
          stage: url.searchParams.get("stage") || undefined,
          status: url.searchParams.get("status") || undefined,
        }),
      );
    if (parts.length === 4 && parts[3] === "batches" && req.method === "POST")
      return REPLY(io.send, 202, candidates.startBatch(parts[2], await io.body()));
    if (
      parts.length === 6 &&
      parts[3] === "batches" &&
      parts[5] === "cancel" &&
      req.method === "POST"
    ) {
      const batch = candidates.getBatch(parts[4]);
      check(batch.trialId === parts[2], "NOT_FOUND", "批量初筛不存在", 404);
      return REPLY(io.send, 200, candidates.cancelBatch(batch.id));
    }
    if (parts.length === 5 && parts[3] === "enrollments") {
      if (req.method === "GET")
        return REPLY(
          io.send,
          200,
          candidates.enrollment(identifier(parts[2]), identifier(parts[4])),
        );
      if (req.method === "PUT")
        return REPLY(
          io.send,
          200,
          candidates.setEnrollment(parts[2], parts[4], await io.body()),
        );
    }
    if (parts.length === 2 && req.method === "GET")
      return REPLY(io.send, 200, { trials: screening.list() });
    if (parts.length === 2 && req.method === "POST")
      return REPLY(io.send, 201, screening.create(await io.body()));
    if (parts.length === 3 && req.method === "GET")
      return REPLY(io.send, 200, screening.get(identifier(parts[2])));
    if (parts.length === 5 && parts[3] === "screenings") {
      const trialId = identifier(parts[2]),
        patientId = identifier(parts[4]);
      if (req.method === "GET")
        return REPLY(io.send, 200, screening.screening(trialId, patientId));
      if (req.method === "PUT")
        return REPLY(
          io.send,
          200,
          screening.save(trialId, patientId, await io.body()),
        );
    }
    return false;
  };
}

// Historical proposal strings and payloads stay unchanged. The host still owns
// pending_actions and the transaction; the plugin supplies deterministic
// normalize/apply for its own types.
const proposalHandler = (type) => ({
  validate({ patientId, payload }, ctx) {
    return serviceOf(ctx).candidates.normalizeProposal(type, {
      ...payload,
      ...(patientId ? { patientId } : {}),
    });
  },
  apply(payload, ctx, _tx, meta) {
    const action = meta?.action;
    return serviceOf(ctx).candidates.applyProposal({
      id: action?.id,
      type,
      patientId: action?.patientId ?? payload?.patientId ?? null,
      payload,
    });
  },
});


// Trial rows are plugin-owned; both patient deletion and demo cleanup stay
// inside this module so the fixed region never names a trial_* table.
function removePatientTrials(db, patientId) {
  db.prepare("DELETE FROM trial_screenings WHERE patient_id=?").run(patientId);
  db.prepare("DELETE FROM trial_enrollments WHERE patient_id=?").run(patientId);
  db.prepare(
    "DELETE FROM trial_ai_jobs WHERE json_extract(data,'$.patientId')=?",
  ).run(patientId);
}

function removeTrial(db, trialId) {
  for (const table of [
    "trial_screenings",
    "trial_enrollments",
    "trial_batches",
  ])
    db.prepare(`DELETE FROM ${table} WHERE trial_id=?`).run(trialId);
  db.prepare(
    "DELETE FROM trial_ai_jobs WHERE json_extract(data,'$.trialId')=?",
  ).run(trialId);
  db.prepare("DELETE FROM trial_protocols WHERE id=?").run(trialId);
}

export default definePlugin({
  id: "trials",
  version: "1.0.0",
  title: "临床试验入组",
  enabledByDefault: true,
  provides: { service: "trials", apiVersion: 1 },
  migrations: "./migrations",
  tablePrefix: ["trial_"],
  legacyApiPaths: [{ method: "*", path: "/api/trials/*" }],
  legacyProposalTypes: {
    "trial-batch": proposalHandler("trial-batch"),
    "trial-enrollment": proposalHandler("trial-enrollment"),
  },
  agendaSources: trialAgendaSources,
  hooks: {
    "patient.deleted": (payload, ctx) =>
      removePatientTrials(ctx.db, payload.patientId),
  },
  demo: {
    async install(ctx, demo) {
      const screening = ctx.plugins.trials?.service?.screening;
      if (!screening) return;
      demo.own("trial", "trial", () =>
        screening.create({
          title: "示例·糖尿病随访观察方案（虚构）",
          version: "演示 v1",
          recruitment: "虚构练习，不招募",
          inclusion:
            "年龄 18–75 岁\n病历已记录2型糖尿病\n愿意提供近期血糖记录",
          exclusion: "拒绝参与随访\n资料不足以核对患者身份",
          protocolText:
            "本方案仅用于练习逐条筛选。未知信息必须标记待补充，不推断符合；不存在真实招募或试验注册。",
        }),
      );
    },
    async clear(ctx, demo) {
      for (const row of demo.pluginResources("trial"))
        removeTrial(ctx.db, row.id);
    },
    exists(ctx, kind, id) {
      return (
        kind === "trial" &&
        Boolean(ctx.db.prepare("SELECT 1 FROM trial_protocols WHERE id=?").get(id))
      );
    },
  },
  setup(ctx) {
    const host = ctx.services.trialHost;
    const screening = new TrialScreening(ctx.store, host.patients);
    const jobs = new TrialEligibilityJobs({
      store: ctx.store,
      patients: host.patients,
      trials: screening,
      bridge: host.bridge,
      workspaces: host.workspaces,
    });
    const candidates = new TrialCandidates({
      store: ctx.store,
      patients: host.patients,
      trials: screening,
      jobs,
    });
    return {
      screening,
      jobs,
      candidates,
      registry: new TrialRegistry(host.registryOptions),
    };
  },
  tools(ctx, { registry }) {
    const service = serviceOf(ctx);
    for (const plugin of trialTools(
      () => service.candidates,
      ctx.services.pending,
    ))
      registry.register({
        permission: "tools.execute",
        capability: plugin.capability || { backend: "local" },
        definition: plugin.definition,
        execute: plugin.execute,
      });
  },
  workflows: {
    "trial-eligibility": {
      artifactType: "trial_eligibility",
      guidance: () => TRIAL_GUIDANCE,
      configure(ctx, { registry, workspace, run }) {
        const jobs = serviceOf(ctx).jobs;
        configureTrialTools(registry, workspace, run, {
          load: (id) => jobs.get(id),
          save: (id, checks) => jobs.save(id, checks),
        });
      },
      prepared(workspace, runId) {
        const run = workspace?.runs?.find((item) => item.id === runId);
        if (run?.policy?.workflow !== "trial-eligibility") return undefined;
        const artifact = run.artifacts?.find(
          (item) => item.type === "trial_eligibility",
        );
        if (
          !artifact ||
          run.inputs?.some(
            (input) => input.createdAt >= new Date(artifact.createdAt).getTime(),
          )
        )
          return undefined;
        return {
          message: {
            role: "assistant",
            content: trialAnswer(workspace, runId, { text: "" }).text,
          },
        };
      },
      answer(workspace, runId, result) {
        return trialAnswer(workspace, runId, result);
      },
    },
  },
  api: (ctx, req, url, io) => createTrialApi(ctx)(req, url, io),
  lifecycle: {
    async stop(ctx) {
      const service = serviceOf(ctx);
      await Promise.allSettled([service.candidates.stop(), service.jobs.stop()]);
    },
  },
});
