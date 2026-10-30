// A patient channel (WeChat / WeCom) is connected only when it is enabled and
// its adapter reports ready. Built-in chat connections are summarized by
// ChatFollowups; channel plugins (including test fixtures) expose
// followupChannels().
//
// The connection only gates patient-facing messaging: inbox, replies,
// campaigns, questionnaires and chat follow-ups. The doctor's own follow-up
// plans and reminders never need a channel.
export function connectedChannels(ctx) {
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

export function messagingConnected(ctx) {
  return connectedChannels(ctx).some(
    (channel) => channel && channel.enabled === true && channel.state === "ready",
  );
}

export const MESSAGING_DISCONNECTED = Object.freeze({
  code: "PATIENT_CHANNEL_NOT_CONNECTED",
  error: "患者消息需要先连接微信或企业微信；随访计划和提醒不受影响",
});
