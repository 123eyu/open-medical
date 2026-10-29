export default function HelloOverview({ patient }) {
  return <section className="overview-card plugin-hello-overview" aria-label="Hello 插件概览">
    <header className="overview-card-heading"><h3>Hello 插件</h3></header>
    <div className="overview-card-body"><p>Hello, {patient?.name || "患者"}</p></div>
  </section>;
}
