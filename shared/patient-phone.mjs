export const PATIENT_PHONE_HINT = "可含区号、空格、横线或括号；5–15 位数字，最多 20 字符；没有可留空。";
export const PATIENT_PHONE_ERROR = "请填写联系电话，可含区号、空格、横线或括号（5–15 位数字，最多 20 字符）；没有可留空。";

// Format checking only: preserve readable formatting and leading zeroes.
export function patientPhone(value) {
  if (value === undefined) return { value: "", error: "" };
  if (typeof value !== "string" || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return { value, error: PATIENT_PHONE_ERROR };
  const normalized = value.trim();
  if (!normalized) return { value: "", error: "" };
  const digits = normalized.replace(/\D/g, "").length;
  const valid = normalized.length <= 20 && /^\+?[0-9 ()-]+$/.test(normalized) && digits >= 5 && digits <= 15;
  return { value: normalized, error: valid ? "" : PATIENT_PHONE_ERROR };
}
