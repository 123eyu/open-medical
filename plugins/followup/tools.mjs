import { check } from "../../server/errors.mjs";
import { careTools } from "./core/care/tools.mjs";

const text = { type: "string" };
const definition = (name, description, properties, required = []) => ({
  type: "function",
  function: {
    name,
    description,
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  },
});

// Followup-owned agent tools. Names and parameter schemas are unchanged from
// the fixed shell; proposal types also stay unchanged until T7.5.
// Patient-messaging tools (care_*, wecom_*) are only offered while a patient
// channel is connected; the doctor's own reminder tools are always present.
export function followupToolPlugins(ctx, { messaging = true } = {}) {
  const service = () => ctx.plugins.followup.service;
  const pending = ctx.services.pending;
  const care = () => service().care;
  return [
    {
      definition: definition(
        "followup_create_propose",
        "提议为患者创建本机随访提醒（单次或周期），到期提醒医生本人联系患者，不会给患者发消息。若要定时给患者发问题并自动收集回复，用 care_campaign_propose。只创建待确认提案；医生在对话中明确同意后用 proposal_confirm 生效。",
        {
          patientId: text,
          name: text,
          once: { type: "boolean" },
          intervalDays: { type: "integer" },
          firstDueAt: text,
          checklist: { type: "array", items: text },
          summary: text,
        },
        ["patientId", "name", "firstDueAt", "summary"],
      ),
      execute: (args) => {
        const { patientId, summary, ...payload } = args;
        return pending.propose({
          type: "followup-create",
          patientId,
          payload,
          summary,
        });
      },
    },
    {
      definition: definition(
        "followups_overview",
        "只读全部患者的在管随访计划概览（按下次到期时间排序）：患者、计划名、频率、状态、到期时间。",
        { limit: { type: "integer", description: "返回条数，默认 50" } },
      ),
      execute: ({ limit } = {}) => {
        const value = limit === undefined ? 50 : limit;
        check(
          Number.isInteger(value) && value >= 1 && value <= 200,
          "INVALID_INPUT",
          "limit 须为 1–200",
        );
        return { followups: service().followups.overview({ limit: value }), readOnly: true };
      },
    },
    ...(messaging ? careTools(care, pending) : []),
  ];
}

export function registerFollowupTools(ctx, { registry, messaging = true }) {
  for (const tool of followupToolPlugins(ctx, { messaging }))
    registry.register({
      permission: "tools.execute",
      capability: { backend: "local" },
      definition: tool.definition,
      execute: tool.execute,
    });
}
