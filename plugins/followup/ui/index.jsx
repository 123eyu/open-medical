import { defineUiPlugin } from "../../../src/plugin-slots.jsx";

const messagesLabel = ({ counts } = {}) =>
  `消息记录${counts?.unprocessedMessages ? ` · ${counts.unprocessedMessages} 待整理` : ""}`;

export default defineUiPlugin({
  id: "followup",
  slots: {
    "patient.tabs": [
      {
        id: "messages",
        label: messagesLabel,
        order: 10,
        area: "communication",
        legacyTab: "messages",
        replacesBuiltin: true,
        requiresConnection: true,
        component: () => import("./PatientMessagesTab.jsx"),
      },
      {
        id: "followups",
        label: "随访计划",
        order: 30,
        area: "communication",
        legacyTab: "followups",
        replacesBuiltin: true,
        component: () => import("./PatientFollowupsTab.jsx"),
      },
    ],
    "settings.panels": [
      {
        id: "followup",
        label: "患者随访",
        order: 40,
        legacyTab: "followup",
        availableWhenDormant: true,
        component: () => import("./ChatConnectionSettings.jsx"),
      },
    ],
    // The cross-patient follow-up and message lists open from 今日待办,
    // not from 资料与工具: they are daily patient work, not standalone tools.
    legacyViews: {
      followups: () => import("./LegacyFollowupsView.jsx"),
      care: () => import("./LegacyCareInbox.jsx"),
    },
  },
});
