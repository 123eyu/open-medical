export default function HelloSettings({ plugin }) {
  return <section aria-label="Hello 插件设置面板">
    <h3>Hello 插件设置面板</h3>
    <p>{plugin?.title || "Hello 示例插件"} 已启用，患者页会显示 Hello 标签。</p>
  </section>;
}
