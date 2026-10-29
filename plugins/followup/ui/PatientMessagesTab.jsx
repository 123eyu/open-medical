import { followupDate } from "../../../shared/followup-display.mjs";
import { messageChannelLabel, messageSpeakerLabel } from "../../../shared/message-provenance.mjs";
import { usePluginEnabled } from "../../../src/plugin-slots.jsx";
import { WeComPanel } from "../../channel-wecom/ui/WeComPanel.jsx";
import { ChatFollowupsPanel } from "./ChatConnectionSettings.jsx";

const fmtDate = followupDate;

// The historical messages tab body. It stays a plugin component so disabling
// followup removes the tab and all of its panels together.
export default function PatientMessagesTab({
  patient: detail,
  config,
  messages,
  paste,
  setPaste,
  importMessages,
  digest,
  busy,
  consent,
}) {
  const wecomEnabled = usePluginEnabled("channel-wecom");
  return (
            <div className="detail-panel">
              {wecomEnabled && <WeComPanel key={detail.id} patientId={detail.id} />}
              <div className="digest-row">
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !config?.modelConfigured ||
                    !detail.counts.unprocessedMessages ||
                    !consent
                  }
                  onClick={digest}
                >
                  AI 总结
                </button>
                <small className="muted">
                  {detail.counts.unprocessedMessages
                    ? `现有 ${detail.counts.unprocessedMessages} 条待整理消息。`
                    : "暂无待整理消息。"}{" "}
                  总结保存在任务记录，仅将本次摘要包含的消息标记为已整理。整理不等于已回复或已完成联系；回复草稿单独核对。
                </small>
              </div>
              <ChatFollowupsPanel key={detail.id} patients={[detail]} initialPatientId={detail.id} />
              <label className="paste-box">
                <b>粘贴消息记录</b>
                <small className="muted">
                  直接粘贴聊天记录即可（支持整段文本）；也可以用「时间 | 患者/医生 | 内容」格式逐行粘贴，更精确。
                </small>
                <textarea
                  rows={4}
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder="2026-09-07 09:12 | 患者 | 今天血压 150/95，偶有头晕"
                />
                <button
                  className="secondary"
                  disabled={!paste.trim() || busy}
                  onClick={importMessages}
                >
                  导入到该患者
                </button>
              </label>
              <div className="msg-list">
                {messages.map((m) => (
                  <div className="msg-row" key={m.id}>
                    <span className={`msg-dir ${m.direction}`}>
                      {messageSpeakerLabel(m)}
                    </span>
                    <span>
                      {m.text}
                      <small>
                        {m.timeUnknown ? `时间待核对（原文：${m.rawTime || "未提供"}；导入于 ${fmtDate(m.collectedAt)}）` : fmtDate(m.time)} · {messageChannelLabel(m.channel)}
                        {m.processed ? " · 已整理" : ""}
                        {messageSpeakerLabel(m) === "身份待核对" ? " · 原记录未核实说话人" : ""}
                      </small>
                    </span>
                    {!m.processed && <em className="pill warn">待整理</em>}
                  </div>
                ))}
                {!messages.length && (
                  <p className="muted">
                    还没有消息。可以直接粘贴聊天记录导入；连接微信后，新消息也会自动同步到这里。
                  </p>
                )}
              </div>
            </div>
  );
}
