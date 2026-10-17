import { useEffect, useState } from "react";
import { api } from "./agent-runtime";

export function FeishuBinding({
  binding = { status: "idle" },
  model,
  modelFingerprint,
  onUpdated,
  endpoint = "/api/message-channels/feishu-binding",
  modelConsent = true,
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [authorizeModel, setAuthorizeModel] = useState(false);
  useEffect(() => setAuthorizeModel(false), [modelFingerprint]);
  const pending = binding.status === "pending";
  async function run(fn) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await onUpdated();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="feishu-binding">
      <p>
        用飞书扫码，或打开绑定页确认。应用和连接信息会自动保存，无需填写密钥。
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {pending ? (
        <>
          <div className="feishu-binding-actions">
            <img
              src={binding.image}
              alt="飞书绑定二维码"
              width="240"
              height="240"
            />
            <div>
              <p role="status">等待你在飞书确认绑定</p>
              <p className="muted">
                请使用医生本人的飞书账号。完成后这里会自动更新，刷新或离开页面也可以继续。
              </p>
              <a
                className="chat-next-link"
                href={binding.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                打开飞书绑定页 ↗
              </a>
              <div className="toolbar-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await navigator.clipboard.writeText(binding.url);
                      setNotice("绑定链接已复制。");
                    })
                  }
                >
                  复制链接
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      api(
                        `${endpoint}/status`,
                        "POST",
                        { id: binding.id },
                      ),
                    )
                  }
                >
                  我已确认，检查状态
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      api(endpoint, "DELETE", {
                        id: binding.id,
                      }),
                    )
                  }
                >
                  取消绑定
                </button>
              </div>
              <small>
                有效期至{" "}
                {new Date(binding.expiresAt).toLocaleTimeString("zh-CN")}
              </small>
            </div>
          </div>
        </>
      ) : (
        <>
          {model && (
            <label className="notification-checkbox">
              <input
                type="checkbox"
                checked={authorizeModel}
                onChange={(e) => setAuthorizeModel(e.target.checked)}
              />
              <span>
                连接后使用 {model.provider} · {model.model} 回复我的私聊
                <small className="feishu-binding-consent">
                  {model.local
                    ? "消息、历史和任务所需资料由本地模型处理。"
                    : "消息、历史和任务所需资料会发送给该模型服务。"}{" "}
                  回答发回你的飞书，医疗提案仍需在工作台确认。
                </small>
              </span>
            </label>
          )}
          {modelConsent && !model && (
            <p className="muted">可以先连接飞书，配置模型后再开启任务回复。</p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(() =>
                api(endpoint, "POST", {
                  authorizeModel,
                  expectedModel: modelFingerprint,
                }),
              )
            }
          >
            {busy
              ? "正在生成…"
              : ["expired", "failed", "denied"].includes(binding.status)
                ? "重新生成绑定链接"
                : "连接飞书"}
          </button>
        </>
      )}
      {binding.error && <p role="status">{binding.error}</p>}
    </div>
  );
}
