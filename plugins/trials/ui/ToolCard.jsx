import { BookOpen } from "lucide-react";

export default function TrialsToolCard({ onNavigate }) {
  return <article>
    <a className="tool-card-link" href="?view=research" onClick={event => {
      event.preventDefault();
      onNavigate("research");
    }}>
      <BookOpen size={24} />
      <h2>临床试验</h2>
      <p>管理试验方案，按入排标准开展患者初筛。</p>
      <footer>
        <small>本地</small>
      </footer>
    </a>
  </article>;
}
