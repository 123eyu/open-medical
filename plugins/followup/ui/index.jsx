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
    legacyViews: {
      followups: () => import("./LegacyFollowupsView.jsx"),
      care: () => import("./LegacyCareInbox.jsx"),
    },
    "tools.directory": [
      {
        id: "care",
        label: "患者消息",
        order: 50,
        requiresConnection: true,
        meta: {
          name: "患者消息",
          description: "查看患者消息，处理回复草稿与客户联系。",
          category: "医疗工具",
          keywords: "消息 回复 客户 企业微信",
          medical: true,
        },
        component: () => import("./ToolCards.jsx").then(module => ({ default: module.CareToolCard })),
      },
      {
        id: "followups",
        label: "随访",
        order: 55,
        meta: {
          name: "随访",
          description: "管理随访计划、待办和患者反馈。",
          category: "医疗工具",
          keywords: "随访 计划 反馈",
          medical: true,
        },
        component: () => import("./ToolCards.jsx").then(module => ({ default: module.FollowupsToolCard })),
      },
    ],
  },
});
