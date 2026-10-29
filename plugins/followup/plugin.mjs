import { definePlugin } from "../../server/plugin-host/define.mjs";
import { createFollowupService } from "./service.mjs";
import { createFollowupApi, FOLLOWUP_LEGACY_API_PATHS } from "./api/followup.mjs";
import { registerFollowupTools } from "./tools.mjs";
import { followupAgendaSources } from "./agenda.mjs";
import { legacyFollowupProposals } from "./proposals.mjs";

// A followup channel is connected only when it is enabled and its adapter
// reports ready. Built-in chat connections are summarized by ChatFollowups;
// channel plugins (including test fixtures) expose followupChannels().
function connectedChannels(ctx) {
  const states = [];
  for (const entry of Object.values(ctx.plugins || {})) {
    if (!entry?.service || entry.enabled === false) continue;
    if (typeof entry.service.followupChannels !== "function") continue;
    try {
      const list = entry.service.followupChannels();
      if (Array.isArray(list)) states.push(...list);
    } catch {
      // A broken channel must not make the followup plugin unavailable.
    }
  }
  const chat = ctx.plugins?.followup?.service?.chatFollowups;
  if (chat && typeof chat.connectionStates === "function")
    states.push(...chat.connectionStates());
  return states;
}

export default definePlugin({
  id: "followup",
  version: "1.0.0",
  title: "随访与患者消息",
  enabledByDefault: true,
  requires: {
    plugins: { channel: "*" },
    anyOf: [["channel-wecom", "channel-wechat"]],
  },
  provides: { service: "followup", apiVersion: 1 },
  activation: { requiresConnection: true },
  capabilities: ["followup.agenda", "followup.tools"],
  legacyProposalTypes: legacyFollowupProposals(),
  migrations: "./migrations",
  // The plugin owns four historical table families. They stay in their
  // original names and shapes; migrations only add missing tables.
  tablePrefix: ["follow_", "followup_", "chat_", "care_"],
  legacyApiPaths: FOLLOWUP_LEGACY_API_PATHS,
  prompt: "./prompt.md",
  agendaSources: followupAgendaSources,
  patientSummary(ctx, patientIds, options) {
    return ctx.plugins.followup?.service?.patientSummary(patientIds, options) || {};
  },
  hooks: {
    "patient.deleted": (payload, ctx) =>
      ctx.plugins.followup?.service?.removePatient(payload.patientId),
  },
  demo: {
    async install(ctx, demo) {
      const service = ctx.plugins.followup?.service;
      const patient = demo.patient(1);
      if (!service || !patient || patient.archived) return;
      if (
        !service.followups
          .list(patient.id)
          .some((job) => job.questionnaire)
      ) {
        const job = service.followups.create(patient.id, {
          name: "示例·血糖控制季度随访",
          once: false,
          intervalDays: 90,
          firstDueAt: new Date(Date.now() + 60000).toISOString(),
          checklist: ["近期血糖记录", "用药依从性"],
          questionnaire: {
            title: "示例·复诊资料回收",
            questions: [
              {
                id: "q1",
                type: "single",
                text: "是否已准备近期测量记录？",
                options: [{ label: "已准备" }, { label: "尚未准备" }],
              },
              {
                id: "q2",
                type: "text",
                text: "这次希望医生帮助核对什么？",
              },
            ],
          },
        });
        // Materialize one occurrence with the normal workflow, then leave the
        // next occurrence in the future so the scheduler cannot duplicate it.
        job.nextDue = Date.now() - 2 * 86400000;
        await service.followups.execute(job);
      }
      const care = service.care;
      if (!care) return;
      const message = care.ingest({
        patientId: patient.id,
        text: "【虚构示例】我已整理好近期测量记录，复诊还需要准备哪些资料？",
        channel: "manual",
        externalId: `demo:${patient.id}:message`,
        historical: true,
      });
      demo.own("reply", "reply", () =>
        care.createReply({
          patientId: patient.id,
          messageId: message.id,
          channel: "manual",
          mode: "manual",
          text: "【示例草稿】复诊前请准备上次就诊记录、近期检验报告和当前用药清单；测量记录请保留日期、数值和单位。",
          reason: "内置虚构草稿，供编辑和复核体验",
        }),
      );
      demo.own("alert", "alert", () =>
        care.createAlert({
          patientId: patient.id,
          messageId: message.id,
          level: "attention",
          reason: "示例·复诊资料需要医生核对",
          localOnly: true,
        }),
      );
    },
    async clear(ctx, demo) {
      const service = ctx.plugins.followup?.service;
      if (!service) return;
      for (const row of demo.resources().filter((item) => item.kind === "patient"))
        service.removePatient(row.id);
    },
    exists(ctx, kind, id) {
      const db = ctx.db;
      if (kind === "reply")
        return Boolean(db.prepare("SELECT 1 FROM care_replies WHERE id=?").get(id));
      if (kind === "alert")
        return Boolean(db.prepare("SELECT 1 FROM care_alerts WHERE id=?").get(id));
      return false;
    },
  },
  setup(ctx) {
    const host = ctx.services.followupHost || {};
    return createFollowupService({
      store: ctx.store,
      runtime: host.runtime,
      patients: host.patients,
      host,
      channelWecom: ctx.plugins["channel-wecom"]?.service || null,
      channelWechat: ctx.plugins["channel-wechat"]?.service || null,
      options: host.options || {},
    });
  },
  status(ctx) {
    const connected = connectedChannels(ctx).some(
      (channel) =>
        channel &&
        channel.enabled === true &&
        channel.state === "ready",
    );
    return { connected };
  },
  tools(ctx, { registry }) {
    registerFollowupTools(ctx, { registry });
  },
  api(ctx, req, url, io) {
    return createFollowupApi(ctx)(req, url, io);
  },
  lifecycle: {
    start(ctx) {
      return ctx.plugins.followup.service.start();
    },
    stop(ctx) {
      return ctx.plugins.followup.service.stop();
    },
    drain(ctx) {
      return ctx.plugins.followup.service.drain();
    },
  },
});
