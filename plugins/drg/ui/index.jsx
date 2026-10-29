import { defineUiPlugin } from "../../../src/plugin-slots.jsx";

export default defineUiPlugin({
  id: "drg",
  slots: {
    legacyViews: {
      drg: () => import("./DrgView.jsx").then((module) => ({ default: module.DrgView })),
    },
  },
});
