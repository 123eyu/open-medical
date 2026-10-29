import { defineUiPlugin } from "../../../src/plugin-slots.jsx";

export default defineUiPlugin({
  id: "doctor-notifications",
  slots: {
    "settings.panels": [
      {
        id: "notifications",
        label: "医生提醒",
        order: 30,
        legacyTab: "notifications",
        component: () => import("./DoctorNotificationSettings.jsx"),
      },
    ],
  },
});
