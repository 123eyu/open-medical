// Optional patient-detail data can be owned by plugins (followup messages and
// reminders today). A disabled plugin makes those routes 404; that must never
// prevent the fixed patient record itself from opening.
const optional = (promise, fallback) =>
  promise.catch(() => fallback);

export async function loadPatientOptional(
  api,
  id,
  { followupEnabled = false } = {},
) {
  if (!followupEnabled) return { messages: [], followups: [] };
  const [messages, followups] = await Promise.all([
    optional(api(`/api/patients/${id}/messages`), { messages: [] }),
    optional(api(`/api/patients/${id}/followups`), { jobs: [] }),
  ]);
  return {
    messages: Array.isArray(messages?.messages) ? messages.messages : [],
    followups: Array.isArray(followups?.jobs) ? followups.jobs : [],
  };
}

export async function loadPatientCore(
  api,
  id,
  { riskEnabled = true } = {},
) {
  const [patient, risk] = await Promise.all([
    api(`/api/patients/${encodeURIComponent(id)}`),
    riskEnabled
      ? optional(api(`/api/risk-alerts?patientId=${id}`), { alerts: [] })
      : Promise.resolve({ alerts: [] }),
  ]);
  return {
    patient,
    risks: Array.isArray(risk?.alerts) ? risk.alerts : [],
  };
}

export async function loadPatientBundle(
  api,
  id,
  { followupEnabled = false, riskEnabled = true } = {},
) {
  const [core, optionalData] = await Promise.all([
    loadPatientCore(api, id, { riskEnabled }),
    loadPatientOptional(api, id, { followupEnabled }),
  ]);
  return { ...core, ...optionalData };
}
