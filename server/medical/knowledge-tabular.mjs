import { check } from "../errors.mjs";
import { KNOWLEDGE_TEXT_LIMIT } from "./knowledge-content.mjs";
import { normalizeSpreadsheetNotes } from "../../shared/office-text.mjs";

const cellText = (cell) => {
  const v = cell.value;
  if (v && typeof v === "object" && ("formula" in v || "sharedFormula" in v))
    return v.result === undefined
      ? "[公式无缓存结果，未计算]"
      : `${v.result} [公式缓存值，未重新计算]`;
  if (v instanceof Date) return v.toISOString();
  return cell.text || "";
};

export async function extractKnowledgeWorkbook(bytes) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await normalizeSpreadsheetNotes(bytes));
  const parts = [];
  let total = 0;
  workbook.eachSheet((sheet) => {
    let headers = new Map(),
      headerRow = null;
    sheet.eachRow((row, rowNumber) => {
      const values = [];
      row.eachCell((cell) => {
        const value = cellText(cell);
        if (!value.trim()) return;
        // Merged cells retain their master location instead of inventing values.
        values.push({
          address: cell.address,
          col: cell.col,
          value,
          master: cell.isMerged ? cell.master.address : null,
        });
      });
      if (!values.length) return;
      if (headerRow === null) {
        // A single-cell title is retained but not treated as a multi-column header.
        if (
          values.filter((v) => !v.master || v.master === v.address).length > 1
        ) {
          headerRow = rowNumber;
          headers = new Map(values.map((v) => [v.col, v.value]));
        }
      }
      const text =
        `[工作表：${sheet.name}]\n行 ${rowNumber}: ` +
        values
          .map(
            (v) =>
              `${v.address}${headers.has(v.col) && rowNumber !== headerRow ? `【${headers.get(v.col)}】` : ""}=${v.value}${v.master && v.master !== v.address ? ` [合并自 ${v.master}]` : ""}`,
          )
          .join(" | ");
      total += text.length + 1;
      check(
        total <= KNOWLEDGE_TEXT_LIMIT,
        "TEXT_LIMIT",
        "表格提取内容超过 200 万字符，请按工作表拆分",
      );
      parts.push({
        text,
        kind: "table-row",
        sheet: sheet.name,
        row: rowNumber,
        headerRow,
        cells: values.map((v) => v.address),
        values: values.map((v) => ({
          address: v.address,
          column: v.col,
          header: headers.get(v.col) || "",
          value: v.value,
          mergedFrom: v.master && v.master !== v.address ? v.master : null,
        })),
        hidden: sheet.state !== "visible" || row.hidden === true,
      });
    });
  });
  check(parts.length, "EXTRACTION_EMPTY", "表格没有可提取的非空单元格");
  return parts;
}

export function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || !cell) quoted = !quoted;
      else cell += ch;
    } else if (ch === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  check(!quoted, "TABLE_FORMAT", "表格存在未闭合引号，请检查 CSV/TSV 原文件");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function extractKnowledgeDelimited(text, name) {
  const rows = parseDelimited(
    text.replace(/^\uFEFF/, ""),
    /\.tsv$/i.test(name) ? "\t" : ",",
  );
  const headers = rows.find((r) => r.some((c) => c.trim())) || [];
  return rows.flatMap((row, i) =>
    row.some((c) => c.trim())
      ? [
          {
            kind: "table-row",
            sheet: name,
            row: i + 1,
            values: row.map((value, c) => ({
              address: `列 ${c + 1}`,
              column: c + 1,
              header: headers[c] || "",
              value,
            })),
            text:
              `[工作表：${name}]\n行 ${i + 1}: ` +
              row
                .map(
                  (value, c) =>
                    `列 ${c + 1}${i && headers[c] ? `【${headers[c]}】` : ""}=${value}`,
                )
                .join(" | "),
          },
        ]
      : [],
  );
}
