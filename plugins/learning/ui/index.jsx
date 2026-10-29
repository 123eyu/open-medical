import { defineUiPlugin } from "../../../src/plugin-slots";
import WorkbenchSettings from "./WorkbenchSettings";
import LearningSettingsPanel from "./LearningSettingsPanel";

export default defineUiPlugin({
  id: "learning",
  slots: {
    "settings.panels": [
      { id: "workbench", label: "自动化规则", order: 10, legacyTab: "workbench", component: () => Promise.resolve({ default: WorkbenchSettings }) },
      { id: "learning", label: "学习与记忆", order: 20, legacyTab: "learning", component: () => Promise.resolve({ default: LearningSettingsPanel }) },
    ],
  },
});
