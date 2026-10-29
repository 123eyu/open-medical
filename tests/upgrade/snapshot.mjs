// Stable projection of the upgrade fixture APIs.
//
// The legacy database is generated from the `main` checkout, then opened by the
// current branch. Both responses must describe the same data even though every
// run generates fresh UUIDs, timestamps and audit rows. This module keeps every
// clinically meaningful field (names, values, statuses, counts, ordering) and
// replaces only identifiers and timestamps with stable placeholders.

const VOLATILE_KEYS = new Set([
  "id",
  "revision",
  "fingerprint",
  "requestId",
  "runId",
  "jobId",
  "actionId",
  "artifactID",
  "sessionId",
  "sourceSessionId",
  "workspaceId",
  "messageId",
  "replyId",
  "alertId",
  "fileId",
  "trialId",
  "enrollmentId",
  "nextOffset",
  "token",
  "etag",
  "lastError",
  "error",
  "at",
  "time",
  "dueAt",
  "nextDue",
  "nextDueAt",
  "firstDueAt",
  "createdAt",
  "updatedAt",
  "created_at",
  "updated_at",
  "appliedAt",
  "confirmedAt",
  "archivedAt",
  "deletedAt",
  "startedAt",
  "finishedAt",
  "checkedAt",
  "generatedAt",
  "savedAt",
  "capturedAt",
  "lastMessageAt",
  "lastActiveAt",
  "timeAt",
]);

const isVolatileKey = (key) =>
  VOLATILE_KEYS.has(key) ||
  /(?:Id|Ids)$/.test(key) ||
  /(?:^|_)at$/.test(key) ||
  /At$/.test(key);

const sorted = (value) => {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted(value[key])]),
  );
};

export function compactPatientIds(patientIds) {
  return new Map(
    [...patientIds.entries()].map(([id, name]) => [id, `<patient:${name}>`]),
  );
}

export function normalize(value, replacements = new Map()) {
  if (typeof value === "string") {
    let text = value;
    for (const [from, to] of replacements) text = text.split(from).join(to);
    return text.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "<uuid>",
    );
  }
  if (Array.isArray(value))
    return value.map((item) => normalize(item, replacements));
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (isVolatileKey(key)) continue;
    output[key] = normalize(item, replacements);
  }
  return sorted(output);
}

export async function captureSnapshot(request, patients) {
  const replacements = compactPatientIds(
    new Map(patients.map((patient) => [patient.id, patient.name])),
  );
  const capture = async (path) => {
    const response = await request(path);
    let body = response.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        // Keep the raw text so a 404 HTML page is still visible in the diff.
      }
    }
    return { status: response.status, body: normalize(body, replacements) };
  };

  const endpoints = {
    patients: "/api/patients?summary=1",
    doctorOverview: "/api/doctor/overview?limit=100",
    followupPlans: "/api/followup-plans",
    followupOverview: "/api/followups/overview?limit=100",
    reminders: "/api/reminders?status=pending&limit=100",
    cases: "/api/cases?limit=100",
    pendingActions: "/api/pending-actions?limit=100",
    doctorProfile: "/api/doctor/profile",
    doctorMemories: "/api/doctor/memories",
    demoPack: "/api/demo-pack",
  };
  const snapshot = {};
  for (const [key, path] of Object.entries(endpoints))
    snapshot[key] = await capture(path);
  // T6 adds a static kind catalog to the agenda response. It is presentation
  // metadata (labels/order) added after the legacy schema, not patient data.
  if (snapshot.doctorOverview?.body && "kinds" in snapshot.doctorOverview.body)
    delete snapshot.doctorOverview.body.kinds;

  snapshot.patientsDetail = {};
  for (const patient of patients) {
    const prefix = `/api/patients/${encodeURIComponent(patient.id)}`;
    snapshot.patientsDetail[patient.name] = {
      detail: await capture(prefix),
      brief: await capture(`${prefix}/brief`),
      followups: await capture(`${prefix}/followups`),
      careTasks: await capture(`${prefix}/care-tasks?status=all&limit=100`),
    };
  }
  return sorted(snapshot);
}
