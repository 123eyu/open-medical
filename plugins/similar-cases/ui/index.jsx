import { defineUiPlugin } from "../../../src/plugin-slots.jsx";

export default defineUiPlugin({
  id: "similar-cases",
  slots: {
    "chat.resultCards": {
      similar_cases: {
        label: "查看相似病例",
        component: () => import("./SimilarCases.jsx").then((module) => ({ default: module.SimilarCases })),
      },
    },
  },
});
