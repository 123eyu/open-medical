import { defineUiPlugin } from "../../../src/plugin-slots.jsx";

export default defineUiPlugin({
  id: "channel",
  slots: {
    "settings.panels": [
      {
        id: "channels",
        label: "私聊助手",
        order: 10,
        legacyTab: "channels",
        component: () => import("./MessageChannelSettings.jsx"),
      },
    ],
  },
});
