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
  legacyTables: ["follow_ups", "followup_plans"],
  migrations: "./migrations",
  // The plugin owns three historical table families. They stay in their
  // original names and shapes; migrations only add missing tables.
  tablePrefix: ["followup_", "chat_", "care_"],
  legacyApiPaths: FOLLOWUP_LEGACY_API_PATHS,
  prompt: "./prompt.md",
  agendaSources: followupAgendaSources,
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
