import { check, string } from "../errors.mjs";
import { LAB_ENTRIES } from "../../shared/lab-reference.mjs";

export { LAB_ENTRIES };

export function searchLabKnowledge({ query, limit = 8 } = {}) {
  const text = string(query, "检索词", 100);
  check(
    Number.isInteger(limit) && limit >= 1 && limit <= 20,
    "INVALID_INPUT",
    "返回数量须为 1–20",
  );
  const needle = text.toLowerCase();
  const hits = LAB_ENTRIES.filter(
    (item) =>
      item.name.toLowerCase().includes(needle) ||
      item.aliases.some((alias) => alias.toLowerCase().includes(needle) || needle.includes(alias)),
  ).slice(0, limit);
  return {
    query: text,
    count: hits.length,
    entries: hits,
    note: "参考范围因实验室方法与人群而异，以报告单打印范围为准；条目为提示性解读，需医生结合临床判断。",
  };
}
