import { defineUiPlugin } from "../../../src/plugin-slots.jsx";

// The WeChat import and connection forms are composed by the followup settings
// panel; the plugin keeps its own UI entry so it can add slots later.
export default defineUiPlugin({ id: "channel-wechat", slots: {} });
