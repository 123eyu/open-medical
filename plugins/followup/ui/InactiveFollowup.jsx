import { HeartHandshake } from "lucide-react";
import { requestSettingsTab } from "../../../src/extension-center";
import "./chat-followups.css";

// Direct visits to ?view=care while no patient channel is connected. Follow-up
// plans and reminders do not need a channel and never show this page.
export function InactiveFollowup({ onSettings }) {
  const openSettings = () => {
    requestSettingsTab("followup");
    onSettings?.();
  };
  return (
    <main id="main" className="module-page" aria-label="患者消息">
      <section className="module-card followup-inactive" aria-label="未连接患者消息渠道">
        <HeartHandshake size={28} aria-hidden="true" />
        <h1>患者消息</h1>
        <p>连接微信或企业微信后，可以在这里查看患者消息、核对回复草稿。随访计划和到期提醒不需要连接，可在「随访」中使用。</p>
        <button type="button" className="primary" onClick={openSettings}>
          去设置连接
        </button>
      </section>
    </main>
  );
}
