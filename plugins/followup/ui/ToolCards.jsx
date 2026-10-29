import { Inbox, MessageSquare } from "lucide-react";

// Both cards keep the fixed directory's article/link structure and copy so the
// plugin contribution is visually indistinguishable from the old hard-coded row.
export function CareToolCard({ onNavigate }) {
  return <article>
    <a className="tool-card-link" href="?view=care" onClick={event => {
      event.preventDefault();
      onNavigate("care");
    }}>
      <Inbox size={24} />
      <h2>患者消息</h2>
      <p>查看患者消息，处理回复草稿与客户联系。</p>
      <footer>
        <span className="tool-card-action">打开 →</span>
      </footer>
    </a>
  </article>;
}

export function FollowupsToolCard({ onNavigate }) {
  return <article>
    <a className="tool-card-link" href="?view=followups" onClick={event => {
      event.preventDefault();
      onNavigate("followups");
    }}>
      <MessageSquare size={24} />
      <h2>随访</h2>
      <p>管理随访计划、待办和患者反馈。</p>
      <footer>
        <span className="tool-card-action">打开 →</span>
      </footer>
    </a>
  </article>;
}
