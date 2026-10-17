export const diagramText =
  "合成路径：先进行初步评估，再判断风险；高风险时转诊，低风险时随访；随访发现风险变化时重新判断风险。\n合成知识分为评估与处理两个主题，评估包括症状与检查，处理包括转诊与随访。";
const proof = (line) => ({
  quote: diagramText.split("\n")[line - 1],
  startLine: line,
  endLine: line,
});
export function diagramBatch() {
  const node = (id, label, role, line = 1) => ({
    id,
    label,
    role,
    ...proof(line),
  });
  const edge = (from, to, label = "", line = 1) => ({
    from,
    to,
    label,
    ...proof(line),
  });
  return {
    title: "合成结构图",
    summary: "软件验证材料",
    nodes: [{ label: "初步评估", type: "诊疗路径", ...proof(1) }],
    relations: [],
    diagrams: [
      {
        type: "flowchart",
        title: "合成风险分流",
        nodes: [
          node("a", "初步评估", "start"),
          node("b", "判断风险", "decision"),
          node("c", "转诊", "end"),
          node("d", "随访", "action"),
        ],
        edges: [
          edge("a", "b"),
          edge("b", "c", "高风险"),
          edge("b", "d", "低风险"),
          edge("d", "b", "风险变化"),
        ],
      },
      {
        type: "mindmap",
        title: "合成知识分类",
        nodes: [
          node("a", "合成知识", "root", 2),
          node("b", "评估", "topic", 2),
          node("c", "处理", "topic", 2),
          node("d", "症状", "topic", 2),
          node("e", "检查", "topic", 2),
        ],
        edges: [
          edge("a", "b", "", 2),
          edge("a", "c", "", 2),
          edge("b", "d", "", 2),
          edge("b", "e", "", 2),
        ],
      },
    ],
  };
}
