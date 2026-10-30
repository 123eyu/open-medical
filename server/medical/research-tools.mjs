import { createHash } from "node:crypto";
import { AppError, check, string } from "../errors.mjs";
import { PID_PATTERN, buildResearchDataset, researchDataDictionary } from "./research-dataset.mjs";

// 科研工具面：数据字典 + 沙箱分析。agent 自己决定研究什么、怎么分析；
// 框架保证三件事：
// 1. 数据只以脱敏长表进入沙箱，模型只看到代码赋给 result 的汇总；
// 2. 结果里出现大量逐人假名编号视为泄露逐行数据，直接拒绝；
// 3. 每次分析带数据快照哈希、代码哈希、包版本和本会话分析序号，
//    便于复现与如实披露多重比较。

export const RESEARCH_GUIDANCE = `- 科研分析（某类患者的共性、危险因素、队列/组间比较、生存分析、从文献找方向再用本地数据验证）先 read_skill：危险因素与共性挖掘用 cohort-factor-analysis，文献选题用 research-direction-scouting。用 research_data_dictionary 看本地数据能研究什么，再用 research_analyze 写 Python 分析；不要用 patient_scan 逐人拼数据。
- 先定研究问题、人群、对照、结局和分析计划并让医生确认，再看结局相关结果；不要反复换口径直到出现显著结果。所有发现都是探索性、相关性结论，标注样本量、缺失、多重比较和混杂，作为待复核草稿。`;

const MAX_PIDS_IN_OUTPUT = 20;
const TABLES = ["patients", "diagnoses", "medications", "labs", "visits"];
const ledgers = new Map(); // `${workspaceId}:${runId}` -> 本次运行已做分析数（进程内）

export function configureResearchTools(registry, workspace, run, { patients, research, artifacts } = {}) {
  if (!patients) return;
  const runKey = `${workspace.id}:${run?.id || "none"}`;
  const register = (name, description, properties, required, execute, permission = "tools.execute") =>
    registry.register({
      permission,
      capability: { backend: "local" },
      definition: {
        type: "function",
        function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
      },
      execute,
    });

  register(
    "research_data_dictionary",
    "只读：科研数据字典。返回本地患者库脱敏后有哪些表和字段、每类数据覆盖多少患者、常见诊断/用药/检验项目（含单位、取值范围、年份）及数据快照哈希。用于判断某个研究问题在本地数据上是否可行、确定变量口径（同一指标可能有多种写法），再交给 research_analyze。不含逐人数据。",
    {
      includeArchived: { type: "boolean", description: "是否包含已归档患者，默认否" },
    },
    [],
    async (args) => ({
      ...researchDataDictionary(buildResearchDataset(patients(), { includeArchived: args.includeArchived === true })),
      readOnly: true,
    }),
  );

  if (!research) return;
  register(
    "research_analyze",
    `在隔离的科研计算沙箱中用 Python 分析本地患者库（已脱敏）。沙箱内可用变量：tables（dict，键 ${TABLES.join("/")}，值为 pandas DataFrame，字段见 research_data_dictionary.schema）、pd、np、plt；可 import scipy、statsmodels、lifelines、sklearn。禁网、禁写盘、禁子进程，最长 120 秒。
把 JSON 兼容的汇总结果（统计表、效应量、置信区间、p 值、样本量、缺失情况）赋给 result；print 的内容作为 log 返回（截取末尾 8KB）。用 plt 画的图会自动保存为本会话成果。
不要返回逐人明细：结果中出现超过 ${MAX_PIDS_IN_OUTPUT} 个患者假名编号会被拒绝。每次调用写明 purpose；结果是探索性草稿。`,
    {
      purpose: { type: "string", description: "本次分析要回答的问题，一句话" },
      code: { type: "string", description: "Python 代码；把汇总结果赋给 result" },
      includeArchived: { type: "boolean", description: "是否包含已归档患者，默认否" },
    },
    ["purpose", "code"],
    async (args, context = {}) => {
      const purpose = string(args.purpose, "分析目的", 300).trim();
      check(purpose, "INVALID_INPUT", "请写明本次分析目的");
      const code = string(args.code, "分析代码", 40000);
      const dataset = buildResearchDataset(patients(), { includeArchived: args.includeArchived === true });
      check(dataset.tables.patients.length, "RESEARCH_EMPTY", "患者库为空，无法分析");
      const output = await research().run({ code, tables: dataset.tables, signal: context.signal });
      const leaked = new Set(`${JSON.stringify(output.result)}\n${output.log}`.match(PID_PATTERN) || []);
      if (leaked.size > MAX_PIDS_IN_OUTPUT)
        throw new AppError(
          "RESEARCH_ROW_LEVEL",
          `结果包含 ${leaked.size} 个患者的逐人编号。请在沙箱内完成汇总，只返回统计量（计数、均值、效应量、p 值等）。`,
          422,
        );
      const index = (ledgers.get(runKey) || 0) + 1;
      ledgers.delete(runKey);
      ledgers.set(runKey, index);
      if (ledgers.size > 500) ledgers.delete(ledgers.keys().next().value);
      const figures = [];
      for (const figure of output.figures) {
        if (!artifacts || !run?.id) break;
        try {
          const saved = artifacts.save(workspace.id, `analysis-${index}-${figure.name}`, figure.data, run.id);
          figures.push({ name: saved.name, artifactId: saved.id });
        } catch (error) {
          figures.push({ name: figure.name, error: error.message });
        }
      }
      return {
        purpose,
        result: output.result,
        ...(output.log ? { log: output.log } : {}),
        ...(figures.length ? { figures } : {}),
        provenance: {
          analysisNumber: index,
          dataSnapshot: dataset.snapshot,
          codeHash: createHash("sha256").update(code).digest("hex").slice(0, 16),
          environment: output.environment,
        },
        status: "draft",
        note: `本次会话第 ${index} 项分析。探索性结果，待医生复核；报告时说明共做了几项分析（多重比较）、样本量与缺失。`,
      };
    },
    "sandbox.execute",
  );
}
