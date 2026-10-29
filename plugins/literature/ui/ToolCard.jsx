import { Search } from "lucide-react";

export default function LiteratureToolCard({ onNavigate }) {
  return <article>
    <a className="tool-card-link" href="?view=literature" onClick={event => {
      event.preventDefault();
      onNavigate("literature");
    }}>
      <Search size={24} />
      <h2>文献研究</h2>
      <p>围绕问题检索、阅读和比较文献，形成有来源的总结。</p>
      <footer>
        <small>联网检索</small>
        <span className="tool-card-action">打开 →</span>
      </footer>
    </a>
  </article>;
}
