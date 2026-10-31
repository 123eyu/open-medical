// Source nature is independent of file format and clinical authority.
export const KNOWLEDGE_PROFILES = [
  {
    name: "指南/共识",
    kind: "指南",
    fields: [
      "适用人群",
      "推荐意见",
      "适用条件",
      "例外与禁忌",
      "推荐等级",
      "证据等级",
    ],
  },
  {
    name: "教材/专著",
    kind: "书籍",
    fields: ["概念", "定义", "章节", "适用范围"],
  },
  {
    name: "论文/研究",
    kind: "文献",
    fields: [
      "研究设计",
      "研究人群",
      "干预",
      "对照",
      "结局",
      "效应量",
      "局限性",
    ],
  },
  {
    name: "药品说明书",
    kind: "药品",
    fields: [
      "通用名",
      "剂型与规格",
      "适应证",
      "用法用量",
      "禁忌",
      "相互作用",
      "特殊人群",
    ],
  },
  {
    name: "检验/检查参考",
    kind: "检验",
    fields: [
      "项目",
      "标本",
      "检测方法",
      "单位",
      "参考区间",
      "适用人群",
      "实验室",
    ],
  },
  {
    name: "量表/评分",
    kind: "量表",
    fields: ["适用人群", "项目", "计分规则", "阈值", "解释", "验证范围"],
  },
  {
    name: "诊疗路径/操作规范",
    kind: "路径",
    fields: ["适用条件", "步骤", "分支条件", "禁忌", "终止条件", "质量要求"],
  },
  {
    name: "病例报告",
    kind: "病例",
    fields: ["背景", "时间线", "干预", "观察结果", "局限性"],
  },
  {
    name: "患教/问答",
    kind: "患教",
    fields: ["问题", "解释", "行动建议", "就医提示", "适用人群"],
  },
  {
    name: "课程/讲座",
    kind: "资料",
    fields: ["主题", "讲者观点", "时间位置", "适用范围"],
  },
  {
    name: "笔记/经验",
    kind: "资料",
    fields: ["观察", "情境", "经验", "局限性"],
  },
  { name: "资料", kind: "资料", fields: ["主题", "适用范围"] },
];
export const KNOWLEDGE_SOURCE_KINDS = KNOWLEDGE_PROFILES.map((p) => p.name);
export const KNOWLEDGE_KINDS = [
  "指南",
  "书籍",
  "资料",
  "文献",
  "药品",
  "检验",
  "量表",
  "路径",
  "操作手册",
  "病例",
  "患教",
  "其他",
];
export function knowledgeProfile(name, kind) {
  return (
    KNOWLEDGE_PROFILES.find((p) => p.name === name) ||
    KNOWLEDGE_PROFILES.find((p) => p.kind === kind) ||
    KNOWLEDGE_PROFILES.at(-1)
  );
}
export function coverageLabel(coverage) {
  if (!coverage || coverage.status === "unknown") return "全文范围未注明";
  if (coverage.status === "excerpt") return "摘录，非全文";
  if (coverage.status === "needs_review") return "有缺页或识别缺口";
  if (coverage.status === "complete")
    return coverage.totalPages
      ? `已处理 ${coverage.processedPages}/${coverage.totalPages} 页`
      : "已处理全部提交内容";
  return "全文范围未注明";
}
