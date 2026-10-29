import { useEffect, useState } from "react";
import { api } from "../../../src/agent-runtime";
import { Modal } from "../../../src/components";
import { careSetupProgress } from "../../../src/plugin-navigation";

export function CareSetup({ onClose, onChanged }) {
  const [settings, setSettings] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [link, setLink] = useState(null),
    [results, setResults] = useState([]);
  useEffect(() => {
    api("/api/care/settings")
      .then(setSettings)
      .catch((e) => setError(e.message));
  }, []);
  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="患者消息连接" onClose={onClose}>
      {!settings && !error && <p role="status">正在读取连接…</p>}
      {settings && (
        <>
          {(settings.channels?.list || []).map((c) => (
            <p key={c.id}>
              {c.label} · {c.configured ? "已连接" : "尚未连接"}
            </p>
          ))}
          {!careSetupProgress(settings).done.kf && (
            <p>
              当前尚无可用的企业微信客服连接。此服务暂不支持在工作台扫码开通；你可以先在聊天中粘贴患者消息或导入聊天记录，整理随访。
            </p>
          )}
          {settings.channels?.list?.some((c) => c.configured) && (
            <button
              disabled={busy}
              onClick={() =>
                run(async () =>
                  setResults(
                    (await api("/api/care/settings/test", "POST", {})).results,
                  ),
                )
              }
            >
              检查已有连接
            </button>
          )}
          {careSetupProgress(settings).done.kf && (
            <button
              disabled={busy}
              onClick={() =>
                run(async () =>
                  setLink(await api("/api/care/settings/kf-link", "POST", {})),
                )
              }
            >
              生成患者咨询链接
            </button>
          )}
          {link && (
            <p>
              <a href={link.url} target="_blank" rel="noreferrer">
                打开患者咨询页
              </a>{" "}
              <button
                onClick={() =>
                  run(() => navigator.clipboard.writeText(link.url))
                }
              >
                复制链接
              </button>
            </p>
          )}
          {results.map((r) => (
            <p key={r.id} role="status">
              {r.ok ? "连接正常" : "连接未就绪"} · {r.detail}
            </p>
          ))}
          <p>
            <a href="/?view=settings&settingsTab=channels">
              扫码连接我的飞书或微信助手 →
            </a>
          </p>
          <p>
            <a href="/?view=followups&followupTab=chat">导入患者聊天记录 →</a>
          </p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}
