import { defineUiPlugin } from "../../../src/plugin-slots.jsx";

// The WeCom patient card is rendered by the followup messages tab after it
// checks this plugin's enabled state, so it has no standalone slot of its own.
export default defineUiPlugin({ id: "channel-wecom", slots: {} });
