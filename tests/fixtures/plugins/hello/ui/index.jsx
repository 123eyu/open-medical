import { defineUiPlugin } from "../../../../../src/plugin-slots.jsx";

export default defineUiPlugin({
  id: "hello",
  slots: {
    "patient.tabs": [
      {
        id: "hello",
        label: "Hello",
        order: 100,
        component: () => import("./HelloTab.jsx"),
      },
    ],
    "patient.overviewCards": [
      {
        id: "hello-overview",
        label: "Hello 插件",
        order: 100,
        component: () => import("./HelloOverview.jsx"),
      },
    ],
    "chat.resultCards": {
      hello_card: () => import("./HelloCard.jsx"),
    },
    "settings.panels": [
      {
        id: "hello-settings",
        label: "Hello 设置",
        order: 100,
        component: () => import("./HelloSettings.jsx"),
      },
    ],
  },
});
