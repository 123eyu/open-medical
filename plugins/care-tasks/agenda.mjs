// Care-task source moved from the transitional legacy-agenda plugin. Lab
// results awaiting review belong to the fixed patient chart and stay in the
// shell agenda; this source only reports the doctor's tracking records.
const moment = (now) => (typeof now === "number" ? now : Date.parse(now) || Date.now());

export const careTasksAgendaSources = Object.freeze([
  {
    kind: "tracking",
    label: "检查检验",
    order: 40,
    read(ctx, { now } = {}) {
      const current = moment(now);
      const items = [];
      for (const row of ctx.db
        .prepare(
          "SELECT id,patient_id,status,due_at,data FROM care_tasks WHERE status IN ('awaiting_review','awaiting_communication') OR (status='waiting_result' AND due_at<=?)",
        )
        .all(current)) {
        const task = JSON.parse(row.data);
        const label = {
          waiting_result: "结果尚未收到，跟进时间已到",
          awaiting_review: "结果已收到，等待医生核对",
          awaiting_communication: "医生已核对，需告知患者",
        }[row.status];
        items.push({
          id: `tracking:${row.id}`,
          kind: "tracking",
          patientId: row.patient_id,
          title: task.title,
          detail: label,
          at: row.due_at,
          weight: row.status === "awaiting_review" ? 3 : 5,
          action: { type: "patient", tab: "tracking", label: "继续跟进" },
        });
      }
      return items;
    },
  },
]);
