import { check, AppError } from "../errors.mjs";

// 检验结果表格导入（「能导出文件的医院」适配器）：医生从 LIS/Excel 导出
// CSV 或直接粘贴单元格，逐行匹配患者后生成 patient-update 档案提案——
// 写入仍走既有「AI 不直写」复核轨，本模块只做确定性解析与匹配。
const HEADERS = {
  姓名: "name", 患者姓名: "name", name: "name",
  患者编号: "patientNumber", 编号: "patientNumber", patientnumber: "patientNumber",
  项目: "item", 检验项目: "item", item: "item",
  数值: "value", 结果: "value", value: "value",
  单位: "unit", unit: "unit",
  日期: "date", 报告日期: "date", 检验日期: "date", date: "date",
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 与患者名单导入同一风格的 RFC 引号单元解析；拒绝畸形引号，
// 不执行任何表格表达式。
function parseRows(text, limit) {
  if (typeof text !== "string" || !text.trim() || text.length > 200000)
    throw new AppError("LAB_IMPORT_LIMIT", "请提供 200KB 以内的检验表格文本", 413);
  text = text.replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/, 1)[0];
  const delimiter = first.includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [], cell = "", quoted = false, closed = false;
  const pushCell = () => { row.push(cell.trim()); cell = ""; closed = false; };
  const pushRow = () => { pushCell(); if (row.some(Boolean)) rows.push(row); row = []; if (rows.length > limit + 1) throw new AppError("LAB_IMPORT_LIMIT", `一次最多导入 ${limit} 行，请分批处理`, 413); };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += char;
    } else if (char === delimiter) pushCell();
    else if (char === "\n" || char === "\r") { if (char === "\r" && text[i + 1] === "\n") i++; pushRow(); }
    else if (char === '"' && !cell && !closed) quoted = true;
    else { if ((closed && char.trim()) || char === '"') throw new AppError("LAB_IMPORT_FILE", "表格引号格式不正确，请直接粘贴 Excel 单元格或使用 CSV", 422); cell += char; }
  }
  if (quoted) throw new AppError("LAB_IMPORT_FILE", "表格中有未闭合的引号", 422);
  if (cell || row.length) pushRow();
  return rows;
}

export class LabImporter {
  // patients：PatientRegistry；pending：PendingActions（提案复用既有复核轨）。
  constructor(patients, pending) { this.patients = patients; this.pending = pending; }

  preview(text) {
    const rows = parseRows(text, 500);
    const columns = rows.shift()?.map((name) => Object.hasOwn(HEADERS, name.toLowerCase()) ? HEADERS[name.toLowerCase()] : undefined);
    if (!columns?.includes("item") || !columns?.includes("value"))
      throw new AppError("LAB_IMPORT_FILE", "首行必须包含「项目」和「数值」列", 422);
    if (!columns.includes("name") && !columns.includes("patientNumber"))
      throw new AppError("LAB_IMPORT_FILE", "首行必须包含「姓名」或「患者编号」列用于匹配患者", 422);
    if (columns.some((key) => !key) || new Set(columns.filter(Boolean)).size !== columns.filter(Boolean).length)
      throw new AppError("LAB_IMPORT_FILE", "表头包含未知或重复列；支持姓名、患者编号、项目、数值、单位、日期", 422);
    if (!rows.length) throw new AppError("LAB_IMPORT_FILE", "表格中没有检验记录", 422);
    const byNumber = new Map(), byName = new Map(), sameName = new Set();
    for (const patient of this.patients.all()) {
      const number = String(patient.patientNumber || "").trim();
      if (number && !byNumber.has(number)) byNumber.set(number, patient);
      const name = String(patient.name || "").trim();
      if (!name) continue;
      if (byName.has(name)) sameName.add(name);
      else byName.set(name, patient);
    }
    const out = rows.map((cells, index) => {
      const input = Object.fromEntries(columns.map((key, i) => [key, cells[i] || ""]));
      const row = { row: index + 2, item: input.item, unit: input.unit || "", ...input };
      const base = {
        item: input.item,
        ...(input.unit ? { unit: input.unit } : {}),
        ...(DATE_RE.test(input.date) ? { date: input.date } : {}),
      };
      if (!input.item || !input.value || !input.date) return { ...row, status: "invalid", reason: "项目、数值、日期均为必填" };
      if (!DATE_RE.test(input.date)) return { ...row, status: "invalid", reason: "日期须为 YYYY-MM-DD" };
      if (!Number.isFinite(Number(input.value))) return { ...row, status: "invalid", reason: "数值须为数字" };
      let patient = null;
      const number = String(input.patientNumber || "").trim();
      const name = String(input.name || "").trim();
      if (number) patient = byNumber.get(number) || null;
      if (!patient && name) {
        if (sameName.has(name)) return { ...row, status: "same-name", reason: "存在同名患者，请补充患者编号", candidates: this.patients.list({ query: name, summary: true, includeArchived: true }).map((p) => ({ id: p.id, name: p.name, patientNumber: p.patientNumber || "" })) };
        patient = byName.get(name) || null;
      }
      if (!patient) return { ...row, status: "no-patient", reason: number ? "编号未匹配到患者" : "姓名未匹配到患者，请先建档或补充编号" };
      return { ...row, status: "ready", patientId: patient.id, patientName: patient.name, labs: [{ ...base, value: Number(input.value) }] };
    });
    return {
      rows: out,
      stats: {
        total: out.length,
        ready: out.filter((r) => r.status === "ready").length,
        noPatient: out.filter((r) => r.status === "no-patient").length,
        sameName: out.filter((r) => r.status === "same-name").length,
        invalid: out.filter((r) => r.status === "invalid").length,
      },
    };
  }

  // 采纳预览中 status==="ready" 的行（医生可再剔除），按患者分组后逐人
  // 生成 patient-update 提案；确认仍在患者档案完成。
  commit({ text, selectedRows }) {
    check(Array.isArray(selectedRows) && selectedRows.length >= 1 && selectedRows.length <= 500, "INVALID_INPUT", "请选择要导入的行");
    const preview = this.preview(text);
    const chosen = selectedRows.map((number) => preview.rows.find((row) => row.row === number && row.status === "ready"))
      .filter(Boolean);
    check(chosen.length >= 1, "INVALID_INPUT", "所选行中没有可导入的记录，请刷新预览后重选");
    const grouped = new Map();
    for (const row of chosen) {
      if (!grouped.has(row.patientId)) grouped.set(row.patientId, { patientName: row.patientName, labs: [] });
      grouped.get(row.patientId).labs.push(...row.labs);
    }
    const proposals = [];
    for (const [patientId, entry] of grouped) {
      const action = this.pending.propose({
        type: "patient-update",
        patientId,
        payload: { labs: entry.labs },
        summary: `导入检验结果 ${entry.labs.length} 项（${[...new Set(entry.labs.map((l) => l.item))].slice(0, 3).join("、")}${entry.labs.length > 3 ? " 等" : ""}）`,
      });
      proposals.push({ id: action.id, patientId, patientName: entry.patientName, labs: entry.labs.length });
    }
    return {
      proposals,
      skipped: preview.stats.total - chosen.length,
      note: "已生成待确认提案；请到患者档案查看本次变更并保存。",
    };
  }
}
