// Deterministic patient-material classification for the report-folder view.
// Keyword rules over the file name (highest signal) then the extracted text
// head; automatic categories remain editable and never overwrite manual choices.
export const MATERIAL_CATEGORIES = ["检验报告", "影像报告", "病理报告", "门诊病历", "住院记录", "用药记录", "其他"];

const RULES = [
  { category: "病理报告", keywords: ["病理"] },
  { category: "用药记录", keywords: ["处方", "用药医嘱", "用药清单", "医嘱单", "用药记录"] },
  { category: "检验报告", keywords: ["检验", "化验", "血常规", "生化", "肝功", "肾功", "甲功", "凝血功能", "肿瘤标志物", "血气", "尿常规", "免疫检验", "糖化血红蛋白"] },
  { category: "影像报告", keywords: ["CT", "MRI", "磁共振", "超声", "B超", "X线", "X光", "DR", "造影", "影像", "PET", "心电图报告"] },
  { category: "住院记录", keywords: ["出院记录", "出院小结", "住院记录", "入院记录", "手术记录", "病程记录", "住院病历"] },
  { category: "门诊病历", keywords: ["门诊病历", "急诊病历", "门诊记录", "就诊记录", "诊疗记录"] },
];

const normalize = (value) => String(value || "").toLowerCase();

// First matching rule wins; the file name outranks the text body because it
// usually states the document type explicitly (「生化检验报告单.pdf」).
export function classifyMaterial({ name, text } = {}) {
  const hayName = normalize(name);
  const hayText = normalize(text).slice(0, 6000);
  // A generic chart title remains a chart even when it contains lab results.
  if (/病历/.test(hayName) && !/住院|入院|出院|影像报告|检验报告|化验报告|生化报告|超声报告|病理报告/.test(hayName))
    return { category: "门诊病历", reason: "文件名含「病历」" };

  for (const source of [
    { haystack: hayName, field: "文件名" },
    { haystack: hayText, field: "正文" },
  ]) {
    if (!source.haystack) continue;
    if (source.field === "正文") {
      // Prefer an explicit report heading to tests mentioned later in a discharge note.
      const headings = [
        ["住院记录", /出院记录|出院小结|住院记录|入院记录|手术记录|病程记录|住院病历/],
        ["门诊病历", /门诊病历|急诊病历|门诊记录|就诊记录|诊疗记录/],
        ["检验报告", /检验报告|化验报告|生化报告|血常规报告/],
        ["病理报告", /病理报告|病理诊断/],
        ["影像报告", /影像报告|超声报告|心电图报告/],
        ["用药记录", /处方笺|用药清单|用药记录|医嘱单/],
      ].map(([category, pattern]) => ({ category, match: source.haystack.match(pattern) }))
        .filter(hit => hit.match).sort((a, b) => a.match.index - b.match.index);
      if (headings.length) return { category: headings[0].category, reason: `正文含「${headings[0].match[0]}」` };
    }

    for (const rule of RULES)
      for (const keyword of rule.keywords)
        if (/^[a-z]+$/i.test(keyword)
          ? new RegExp(`(?<![a-z])${keyword}(?![a-z])`, "i").test(source.haystack)
          : source.haystack.includes(keyword.toLowerCase()))
          return { category: rule.category, reason: `${source.field}含「${keyword}」` };
  }
  return null;
}

const DATE_RE = /(\d{4})\s*[-年/.]\s*(\d{1,2})\s*[-月/.]\s*(\d{1,2})/;
// 相机/微信导出的紧凑时间戳：8 位「20230706」或 14 位「20250713220308」。
// 只从文件名取，避免把正文里的编号/条码误认成日期。
const COMPACT14_RE = /(?<!\d)(20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])\d{6}(?!\d)/;
const COMPACT8_RE = /(?<!\d)(20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])(?!\d)/;

function validDate(match) {
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const iso = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const time = Date.parse(iso);
  return year >= 1900 && year <= 2100 && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === iso ? iso : null;
}

// Body dates need an explicit document/encounter label. A diagnosis or birth
// date is not the date of this document; ambiguity is left for doctor review.
export function documentDateCandidates({ name, text } = {}) {
  const filename = normalize(name);
  const fromName = [DATE_RE, COMPACT14_RE, COMPACT8_RE].flatMap((pattern) =>
    [...filename.matchAll(new RegExp(pattern.source, "g"))].map(validDate).filter(Boolean));
  const body = normalize(text).slice(0, 6000);
  const fromBody = [...body.matchAll(new RegExp(`(?:报告日期|报告时间|检验日期|检验时间|检查日期|检查时间|就诊日期|就诊时间|门诊日期|记录日期|出院日期|入院日期|文书日期)[：:\\s]*${DATE_RE.source}`, "g"))]
    .map(validDate).filter(Boolean);
  return [
    ...[...new Set(fromName)].map((date) => ({ date, source: "文件名" })),
    ...[...new Set(fromBody)].map((date) => ({ date, source: "正文文书日期" })),
  ];
}

export function suggestDocumentDate(file = {}) {
  const unique = [...new Set(documentDateCandidates(file).map((item) => item.date))];
  return unique.length === 1 ? unique[0] : null;
}

export function isCalendarDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString().slice(0, 10) === value;
}

// Apply on ingestion and after OCR; legacy explicit categories count as manual.
export function autoClassifyMaterial(file) {
  const suggestion = classifyMaterial(file);
  const manual = file.categorySource === "manual" || (file.category && file.categorySource !== "auto");
  return {
    ...file,
    ...(!manual ? {
      category: suggestion?.category || "其他",
      categorySource: "auto",
      categorySuggestion: suggestion,
    } : {}),
  };
}
