import { check } from "../../server/errors.mjs";

// Proposal types that predate the plugin boundary keep their exact strings and
// payload shapes. The host still owns pending_actions and the transaction; the
// plugin only supplies deterministic validate/apply for its own types.
const CARE_TYPES = [
  "care-message",
  "care-campaign",
  "care-settings",
  "care-bind",
  "care-group-message",
  "care-education-broadcast",
];

const followupService = (ctx) => ctx.plugins.followup.service;

const careHandler = (type) => ({
  validate({ patientId, payload }, ctx) {
    return followupService(ctx).care.normalizeProposal(type, {
      ...payload,
      ...(patientId ? { patientId } : {}),
    });
  },
  apply(payload, ctx, _tx, meta) {
    const action = meta?.action;
    return followupService(ctx).care.applyProposal({
      id: action?.id,
      type,
      patientId: action?.patientId ?? payload?.patientId ?? null,
      payload,
    });
  },
});

export function legacyFollowupProposals() {
  return {
    "followup-create": {
      revisionScoped: true,
      validate({ patientId, payload }, _ctx) {
        check(patientId, "INVALID_INPUT", "该提案需要患者编号");
        check(
          payload && typeof payload.name === "string" && payload.name.trim(),
          "INVALID_INPUT",
          "随访提案需要 name",
        );
        return payload;
      },
      apply(payload, ctx, _tx, meta) {
        const action = meta?.action;
        return followupService(ctx).followups.create(
          action?.patientId,
          payload,
        );
      },
    },
    ...Object.fromEntries(CARE_TYPES.map((type) => [type, careHandler(type)])),
  };
}
