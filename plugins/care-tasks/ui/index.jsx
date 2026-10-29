import { defineUiPlugin } from "../../../src/plugin-slots.jsx";

export default defineUiPlugin({
  id: "care-tasks",
  slots: {
    "patient.tabs": [
      {
        id: "tracking",
        label: "检查与转诊",
        order: 40,
        area: "communication",
        legacyTab: "tracking",
        replacesBuiltin: true,
        component: () =>
          import("./CareTasksPanel.jsx").then((module) => ({
            default: module.CareTasksPanel,
          })),
      },
    ],
  },
});
