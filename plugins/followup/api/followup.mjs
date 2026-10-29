import { check, identifier } from "../../../server/errors.mjs";
import { careApi } from "./care.mjs";
import { chatFollowupsApi } from "../core/chat-followups-api.mjs";
import { chatAutoFollowApi } from "../core/chat-autofollow-api.mjs";
import { chatAibotApi } from "../core/aibot.mjs";

const REPLY = (send, status, value) => {
  send(status, value);
  return true;
};

// All followup-private legacy routes. Paths, status codes and response bodies
// are unchanged; /api/reminders (the shared reminder bus) remains fixed.
export function createFollowupApi(ctx) {
  const service = () => ctx.plugins.followup.service;
  return async function followupApi(req, url, io) {
    const send = io.send;
    const body = io.body;
    const path = url.pathname;
    const parts = path.split("/").filter(Boolean);
    const svc = service();
    const followups = svc.followups;
    const surveys = svc.surveys;
    const risks = ctx.services.risks || null;

    if (path === "/api/followup-plans" && req.method === "GET")
      return REPLY(send, 200, { plans: followups.listPlans() });
    if (path === "/api/followup-plans" && req.method === "POST")
      return REPLY(send, 201, followups.createPlan(await body()));
    if (
      parts[0] === "api" &&
      parts[1] === "followup-plans" &&
      parts.length === 3 &&
      req.method === "DELETE"
    )
      return REPLY(send, 200, followups.removePlan(parts[2]));
    if (
      parts[0] === "api" &&
      parts[1] === "followups" &&
      parts[2] === "overview" &&
      req.method === "GET"
    )
      return REPLY(
        send,
        200,
        followups.overviewPage({
          limit: url.searchParams.has("limit")
            ? Number(url.searchParams.get("limit"))
            : undefined,
          offset: url.searchParams.has("offset")
            ? Number(url.searchParams.get("offset"))
            : undefined,
        }),
      );

    if (parts[0] === "api" && parts[1] === "reminders") {
      if (
        parts.length === 4 &&
        parts[3] === "addendum" &&
        req.method === "POST"
      )
        return REPLY(
          send,
          200,
          followups.addContactAddendum(identifier(parts[2]), await body()),
        );
      if (
        parts.length === 4 &&
        parts[3] === "complete" &&
        req.method === "POST"
      ) {
        const reminder = followups.completeReminder(
          identifier(parts[2]),
          await body(),
        );
        risks?.evaluatePatient(reminder.patientId);
        return REPLY(send, 200, reminder);
      }
      if (parts.length === 4 && parts[3] === "ack" && req.method === "POST")
        return REPLY(send, 200, followups.ackReminder(identifier(parts[2])));
    }

    if (parts[0] === "api" && parts[1] === "patients" && parts[2]) {
      const pid = identifier(parts[2]);
      if (
        parts[3] === "followup-records" &&
        parts.length === 4 &&
        req.method === "POST"
      ) {
        const record = followups.recordContact(pid, await body());
        risks?.evaluatePatient(pid);
        return REPLY(send, 201, record);
      }
      if (parts[3] === "followup-surveys") {
        if (parts.length === 4 && req.method === "GET")
          return REPLY(send, 200, {
            surveys: surveys.list(pid, {
              reminderId: url.searchParams.get("reminderId"),
              surveyId: url.searchParams.get("surveyId"),
            }),
          });
        if (parts.length === 6 && req.method === "POST") {
          const surveyId = identifier(parts[4]);
          if (parts[5] === "send")
            return REPLY(send, 200, await surveys.send(pid, surveyId, await body()));
          if (parts[5] === "collect") {
            const row = surveys.collect(pid, surveyId, await body());
            risks?.evaluatePatient(pid);
            return REPLY(send, 200, row);
          }
          if (parts[5] === "cancel")
            return REPLY(send, 200, surveys.cancel(pid, surveyId, await body()));
          if (parts[5] === "ai-parse")
            return REPLY(send, 200, await surveys.aiParse(pid, surveyId));
        }
      }
      if (parts[3] === "followups") {
        if (parts.length === 4 && req.method === "GET")
          return REPLY(send, 200, { jobs: followups.list(pid) });
        if (parts.length === 4 && req.method === "POST")
          return REPLY(send, 201, followups.create(pid, await body()));
        if (parts.length === 5 && parts[4] === "apply" && req.method === "POST")
          return REPLY(
            send,
            201,
            followups.applyTemplate(pid, await body()),
          );
        if (parts.length === 5) {
          const job = followups.row(parts[4]);
          check(
            job.patientId === pid,
            "NOT_FOUND",
            "随访计划不属于当前患者",
            404,
          );
          if (req.method === "PATCH")
            return REPLY(send, 200, followups.update(job.id, await body()));
          if (req.method === "DELETE") {
            followups.remove(job.id, (await body()).revision);
            return REPLY(send, 200, { ok: true });
          }
        }
      }
    }

    if (path.startsWith("/api/care/"))
      return careApi(svc.care, req, url, {
        body,
        send,
        pending: ctx.services.pending,
      });

    if (path.startsWith("/api/chat-followups/"))
      return chatFollowupsApi(svc.chatFollowups, req, url, { body, send });
    if (path.startsWith("/api/chat-autofollow/"))
      return chatAutoFollowApi(svc.chatAutoFollow, req, url, { body, send });
    if (path.startsWith("/api/chat-aibot/"))
      return chatAibotApi(svc.aibot, req, url, { body, send });
    return false;
  };
}

export const FOLLOWUP_LEGACY_API_PATHS = [
  { method: "*", path: "/api/followup-plans" },
  { method: "DELETE", path: "/api/followup-plans/:id" },
  { method: "GET", path: "/api/followups/overview" },
  { method: "POST", path: "/api/reminders/:id/addendum" },
  { method: "POST", path: "/api/reminders/:id/complete" },
  { method: "POST", path: "/api/reminders/:id/ack" },
  { method: "POST", path: "/api/patients/:id/followup-records" },
  { method: "GET", path: "/api/patients/:id/followup-surveys" },
  { method: "POST", path: "/api/patients/:id/followup-surveys/:surveyId/*" },
  { method: "*", path: "/api/patients/:id/followups" },
  { method: "*", path: "/api/patients/:id/followups/*" },
  { method: "*", path: "/api/care/*" },
  { method: "*", path: "/api/chat-followups/*" },
  { method: "*", path: "/api/chat-autofollow/*" },
  { method: "*", path: "/api/chat-aibot/*" },
];
