import { Sigma } from "lucide-react";

export default function ResearchStatsToolCard({ onNavigate }) {
  return <article>
    <a className="tool-card-link" href="?view=data-analysis" onClick={event => {
      event.preventDefault();
      onNavigate("data-analysis");
    }}>
      <Sigma size={24} />
      <h2>科研统计</h2>
      <p>上传 CSV，进行描述统计、组间比较、样本量估算与脱敏导出。</p>
      <footer>
        <small>本地</small>
      </footer>
    </a>
  </article>;
}
