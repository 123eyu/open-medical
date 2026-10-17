import { check } from "../errors.mjs";

// 确定性花名册统计：回答「多少 / 占比 / 达标率」类问题。与 patient_scan
// 互补——scan 返回患者名单与依据，stats 只算数字与分布，不逐人列名。
// 全部本地计算，不调用模型；年龄段按出生年换算，缺失不计入该桶。
const AGE_BANDS = [
  { key: "≤44", min: 0, max: 44 },
  { key: "45–59", min: 45, max: 59 },
  { key: "60–74", min: 60, max: 74 },
  { key: "≥75", min: 75, max: 200 },
];
const OPS = {
  ">": (a, b) => a > b,
  "<": (a, b) => a < b,
  ">=": (a, b) => a >= b,
  "<=": (a, b) => a <= b,
};

function parseCriteria(spec = {}) {
  check(spec && typeof spec === "object" && !Array.isArray(spec), "INVALID_INPUT", "统计条件无效");
  const countBy = spec.countBy;
  check(countBy === undefined || ["group", "gender", "ageBand"].includes(countBy), "INVALID_INPUT", "countBy 须为 group、gender 或 ageBand");
  const diagnosisContains =
    spec.diagnosisContains === undefined ? null : keyword(spec.diagnosisContains, "诊断关键词");
  const tag = spec.tag === undefined ? null : keyword(spec.tag, "标签");
  let lab = null;
  if (spec.lab !== undefined) {
    check(spec.lab && typeof spec.lab === "object" && !Array.isArray(spec.lab), "INVALID_INPUT", "检验条件无效");
    const op = spec.lab.op;
    check(typeof op === "string" && OPS[op], "INVALID_INPUT", "检验比较符须为 >、<、>=、<=");
    check(typeof spec.lab.value === "number" && Number.isFinite(spec.lab.value), "INVALID_INPUT", "检验阈值必须为数字");
    lab = { item: keyword(spec.lab.item, "检验项目"), op, value: spec.lab.value };
  }
  check(
    Boolean(countBy || diagnosisContains || tag || lab),
    "INVALID_INPUT",
    "至少提供一个统计维度（countBy / diagnosisContains / tag / lab）",
  );
  return { countBy, diagnosisContains, tag, lab };
}
function keyword(value, name) {
  check(
    typeof value === "string" && value.trim().length >= 1 && value.length <= 60,
    "INVALID_INPUT",
    `${name}须为 1–60 字符的文本`,
  );
  return value.trim();
}

export function patientStats(patients, spec, now = Date.now()) {
  const { countBy, diagnosisContains, tag, lab } = parseCriteria(spec);
  const active = patients.all().filter((p) => !p.archived);
  const year = new Date(now).getFullYear();
  // lab 维度取每位患者该项目（按名称包含匹配）最近一次数值参与统计；
  // 无该检验的患者不计入分母，避免把「没查过」当成「未达标」。
  let labTested = 0;
  let labMatched = 0;
  let diagnosisCount = 0;
  let tagCount = 0;
  const buckets = new Map();
  const bump = (key) => buckets.set(key, (buckets.get(key) || 0) + 1);
  for (const patient of active) {
    if (diagnosisContains) {
      const hit = (patient.diagnoses || []).some((d) => String(d.name || "").includes(diagnosisContains));
      if (!hit) continue;
      diagnosisCount++;
    }
    if (tag) {
      if (!(patient.tags || []).some((t) => String(t).includes(tag))) continue;
      tagCount++;
    }
    if (lab) {
      const values = (patient.labs || [])
        .filter((l) => String(l.item || "").toLowerCase().includes(lab.item.toLowerCase()) && typeof l.value === "number")
        .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
      if (!values.length) continue;
      labTested++;
      if (OPS[lab.op](values[0].value, lab.value)) labMatched++;
    }
    if (countBy === "group") for (const group of patient.groups || []) bump(group);
    else if (countBy === "gender") bump(patient.gender || "unknown");
    else if (countBy === "ageBand") {
      const age = patient.birthYear ? year - patient.birthYear : null;
      const band = age === null ? "未知" : AGE_BANDS.find((b) => age >= b.min && age <= b.max)?.key || "未知";
      bump(band);
    }
  }
  const result = {
    totalActive: active.length,
    ...(diagnosisContains ? { diagnosisCount } : {}),
    ...(tag ? { tagCount } : {}),
    ...(lab
      ? {
          lab: {
            item: lab.item,
            tested: labTested,
            matched: labMatched,
            note: "按每位患者该检验项目最近一次数值统计；未查过该项目的患者不计入分母",
          },
        }
      : {}),
    ...(countBy
      ? { buckets: [...buckets.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count })) }
      : {}),
    readOnly: true,
  };
  return result;
}
