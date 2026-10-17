export function parsePastedMessages(raw) {
  const lines = raw.split(/\n/).map(line => line.trim()).filter(Boolean);
  // A free-text paragraph is one statement, not one speaker per line.
  if (!lines.some(line => /[|｜]/.test(line))) return raw.trim() ? [{ direction: "in", speaker: "unknown", timeUnknown: true, rawTime: "未提供", time: "", text: raw.trim() }] : [];
  return lines.map(line => {
    const parts = line.split(/\s*[|｜]\s*/);
    const role = parts.length >= 3 ? parts[1] : parts.length === 2 ? parts[0] : "";
    const rawTime = parts.length >= 3 ? parts[0] : "未提供";
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(rawTime);
    const validDay = match && Number(match[2]) >= 1 && Number(match[2]) <= 12 && Number(match[3]) >= 1 && Number(match[3]) <= new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
    const parsed = validDay ? Date.parse(rawTime) : NaN;
    const speaker = /^(医生|out)$/i.test(role) ? "doctor" : /^(患者|本人|in)$/i.test(role) ? "patient" : /家属/.test(role) ? "family" : "unknown";
    return { direction: speaker === "doctor" ? "out" : "in", speaker, rawSpeaker: role, rawTime,
      timeUnknown: !Number.isFinite(parsed), time: Number.isFinite(parsed) ? new Date(parsed).toISOString() : "",
      text: parts.length >= 3 ? parts.slice(2).join(" | ") : parts.length === 2 ? parts[1] : line };
  });
}
