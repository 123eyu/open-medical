import { Stethoscope } from "lucide-react";

export default function ClinicalRefToolCard({ onNavigate }) {
  return <article>
    <a className="tool-card-link" href="?view=clinical-ref" onClick={event => {
      event.preventDefault();
      onNavigate("clinical-ref");
    }}>
      <Stethoscope size={24} />
      <h2>临床速查</h2>
      <p>量表、检验、编码与 ADR 查询。</p>
      <footer>
        <small>本地工具</small>
        <span className="tool-card-action">打开 →</span>
      </footer>
    </a>
  </article>;
}
