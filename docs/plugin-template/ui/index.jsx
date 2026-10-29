import { defineUiPlugin } from "__ROOT_REL__/src/plugin-slots.jsx";

// 模板只贡献一个患者页 tab。组件必须通过 () => import() 懒加载，
// 入口模块本身由宿主 eager 收集。
export default defineUiPlugin({
  id: "__PLUGIN_ID__",
  slots: {
    "patient.tabs": [
      {
        id: "notes",
        label: "__PLUGIN_TITLE__",
        order: 80,
        area: "record",
        component: () => import("./Tab.jsx"),
      },
    ],
  },
});
