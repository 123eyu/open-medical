import { check } from "../errors.mjs";

// Deterministic CSV profiling belongs to the fixed-region @all-patients
// assistant surface (cohort_profile). It is a pure helper: the research-stats
// plugin reuses it for its own page/API without the fixed shell importing any
// plugin file.
export function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function variance(values) {
  const m = mean(values);
  return values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
}

export const quantile = (sorted, q) => {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
};

export const asNumber = (value) => {
  const parsed = Number(value);
  return value !== "" && Number.isFinite(parsed) ? parsed : null;
};

export function parseCsv(text) {
  const rows = [];
  let row = [],
    field = "",
    inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (field !== "" || row.length) {
        row.push(field.trim());
        rows.push(row);
        row = [];
        field = "";
      }
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field.trim());
    rows.push(row);
  }
  check(rows.length >= 2, "INVALID_INPUT", "CSV 需要表头和至少一行数据");
  const header = rows[0];
  const records = rows.slice(1).map((r) => {
    const record = {};
    header.forEach((name, i) => (record[name] = r[i] ?? ""));
    return record;
  });
  return { header, records };
}

export function findSource(sources, sourceId) {
  check(sourceId && typeof sourceId === "string", "INVALID_INPUT", "请提供 sourceId");
  const source = sources.find((s) => s.id === sourceId);
  check(source, "NOT_FOUND", "找不到该资料", 404);
  return source;
}

export function profileSources({ sources = [], sourceId, columns } = {}) {
  const source = findSource(sources, sourceId);
  const { header, records } = parseCsv(source.text);
  const fields = Array.isArray(columns) && columns.length ? columns : header;
  check(fields.length <= 30, "INVALID_INPUT", "最多分析 30 列");
  const summary = {};
  for (const field of fields) {
    check(header.includes(field), "INVALID_INPUT", `列不存在：${field}`);
    const numeric = records
      .map((record) => asNumber(record[field]))
      .filter((v) => v !== null);
    if (numeric.length >= records.length * 0.6 && numeric.length >= 3) {
      const sorted = numeric.slice().sort((x, y) => x - y);
      summary[field] = {
        type: "numeric",
        n: numeric.length,
        missing: records.length - numeric.length,
        mean: mean(numeric),
        sd: numeric.length > 1 ? Math.sqrt(variance(numeric)) : null,
        min: sorted[0],
        p25: quantile(sorted, 0.25),
        median: quantile(sorted, 0.5),
        p75: quantile(sorted, 0.75),
        max: sorted.at(-1),
      };
    } else {
      const counts = new Map();
      for (const record of records) {
        const key = record[field] === "" ? "(缺失)" : record[field];
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      summary[field] = {
        type: "categorical",
        n: records.length,
        levels: [...counts.entries()]
          .sort((x, y) => y[1] - x[1])
          .slice(0, 12)
          .map(([level, count]) => ({ level, count })),
      };
    }
  }
  return {
    sourceId,
    sourceName: source.name,
    rows: records.length,
    columns: summary,
    note: "描述统计为待复核草稿结果，请在解读前核对原始数据。",
  };
}

export function cohortProfileTool() {
  return {
    definition: {
      type: "function",
      function: {
        name: "cohort_profile",
        description:
          "对会话中的 CSV 资料做描述统计（数值列：均值/中位数/四分位；分类列：频数）。",
        parameters: {
          type: "object",
          properties: {
            sourceId: { type: "string" },
            columns: { type: "array", items: { type: "string" } },
          },
          required: ["sourceId"],
          additionalProperties: false,
        },
      },
    },
    capability: { backend: "local" },
    execute: (args, context) =>
      profileSources({ ...args, sources: context.sources }),
  };
}
