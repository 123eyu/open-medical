export default function HelloCard({ artifact }) {
  return <section className="artifact-hello-card" aria-label="Hello 结果卡片">
    <h3>{artifact?.title || "Hello 结果"}</h3>
    <p>{artifact?.message || "来自 hello 插件的对话结果卡片。"}</p>
  </section>;
}
