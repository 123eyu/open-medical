export default function HelloTab({ patient }) {
  return <section className="plugin-hello-tab" aria-label="Hello 插件">
    <h2>Hello</h2>
    <p>Hello, {patient?.name || "患者"}</p>
  </section>;
}
