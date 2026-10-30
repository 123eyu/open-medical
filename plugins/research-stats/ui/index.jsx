import { defineUiPlugin } from "../../../src/plugin-slots.jsx";

export default defineUiPlugin({
  id: "research-stats",
  slots: {
    legacyViews: {
      "data-analysis": () => import("./ResearchView.jsx").then((module) => ({ default: module.ResearchView })),
    },
    "tools.directory": [
      {
        id: "data-analysis",
        label: "科研统计",
        order: 90,
        meta: {
          name: "科研统计",
          description: "上传 CSV，进行描述统计、组间比较、样本量估算与脱敏导出。",
          category: "科研",
          keywords: "数据分析 统计学 CSV",
          medical: true,
        },
        component: () => import("./ToolCard.jsx"),
      },
    ],
  },
});
