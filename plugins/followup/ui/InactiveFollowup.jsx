import { HeartHandshake } from "lucide-react";
import { requestSettingsTab } from "../../../src/extension-center";
import "./chat-followups.css";

// Direct visits to ?view=followups / ?view=care while no channel is connected
// must not expose the business UI. The only action is connecting a channel.
export function InactiveFollowup({ onSettings }) {
  const openSettings = () => {
    requestSettingsTab("followup");
    onSettings?.();
  };
  return (
    <main id="main" className="module-page" aria-label="随访与患者消息">
      <section className="module-card followup-inactive" aria-label="未启用随访与患者消息">
        <HeartHandshake size={28} aria-hidden="true" />
        <h1>随访与患者消息</h1>
        <p>连接微信或企业微信后，即可使用随访与患者消息。</p>
        <button type="button" className="primary" onClick={openSettings}>
          去设置连接
        </button>
      </section>
    </main>
  );
}
