import { definePlugin } from "../../../../server/plugin-host/define.mjs";

// One failing source and one healthy source in the same plugin prove that a
// single read error is isolated instead of failing the whole agenda.
export default definePlugin({
  id: "throwing-agenda",
  version: "1.0.0",
  title: "待办来源故障示例",
  enabledByDefault: true,
  agendaSources: [
    {
      kind: "broken",
      label: "故障来源",
      order: 65,
      read() {
        throw new Error("broken agenda source");
      },
    },
    {
      kind: "healthy",
      label: "正常来源",
      order: 66,
      read() {
        return [
          {
            id: "healthy:1",
            kind: "healthy",
            title: "正常来源事项",
            detail: "同一插件里的其他来源仍应返回",
            at: 0,
            weight: 7,
            fallbackName: "示例插件",
            action: { type: "patients", label: "查看" },
          },
        ];
      },
    },
  ],
});
