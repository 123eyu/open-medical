import { defineUiPlugin } from "../../../src/plugin-slots.jsx";

export default defineUiPlugin({
  id: "literature",
  slots: {
    legacyViews: {
      literature: () => import("./LiteratureView.jsx").then((module) => ({ default: module.LiteratureView })),
    },
    "tools.directory": [
      {
        id: "literature",
        label: "文献研究",
        order: 40,
        meta: {
          name: "文献研究",
          description: "围绕问题检索、阅读和比较文献，形成有来源的总结。",
          category: "信息查找",
          keywords: "联网检索",
          medical: true,
        },
        component: () => import("./ToolCard.jsx"),
      },
    ],
  },
});
