import { defineUiPlugin } from "../../../src/plugin-slots.jsx";

export default defineUiPlugin({
  id: "clinical-ref",
  slots: {
    legacyViews: {
      "clinical-ref": () => import("./ClinicalRefView.jsx").then((module) => ({ default: module.ClinicalRefView })),
    },
    "tools.directory": [
      {
        id: "clinical-ref",
        label: "临床速查",
        order: 70,
        meta: {
          name: "临床速查",
          description: "量表、检验、编码与 ADR 查询。",
          category: "临床",
          keywords: "评分 计算器 不良反应 药物",
          medical: true,
        },
        component: () => import("./ToolCard.jsx"),
      },
    ],
  },
});
