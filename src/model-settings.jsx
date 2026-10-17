import { useEffect, useRef, useState } from "react";
import { api } from "./agent-runtime";
import { OcrSettingsSection } from "./ocr-settings";
import { PersonalRegressionSettings } from "./learning-loop";
import { JevSettings } from "./jev-settings";
export function ModelSettings({ onClose, onSaved }) {
  const dialog = useRef(null);
  const [choices, setChoices] = useState(null),
    [selected, setSelected] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  function accept(result) {
    setChoices(result.choices);
    setSelected(
      result.choices.find((c) => c.current)?.id || result.choices[0]?.id || "",
    );
    setConsent(false);
  }
  useEffect(() => {
    dialog.current.showModal();
    let alive = true;
    api("/api/model-choices")
      .then((d) => {
        if (alive) accept(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  async function run(fn) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const choice = choices?.find((c) => c.id === selected);
  return (
    <dialog
      ref={dialog}
      className="model-settings-dialog"
      aria-labelledby="model-settings-title"
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      onClose={onClose}
    >
      <header>
        <h2 id="model-settings-title">模型与识别</h2>
        <button disabled={busy} onClick={onClose}>
          关闭
        </button>
      </header>
      <div className="model-settings-body">
        <section>
          <h3>选择可用模型</h3>
          <p>自动读取已保存的模型连接和本机正在运行的模型。</p>
          {!choices && !error && <p role="status">正在查找可用模型…</p>}
          {choices?.length === 0 && (
            <p>
              尚未找到可用模型。启动本机 Ollama
              后点击刷新即可选择已下载的模型。云端模型的扫码登录尚未接入；现有连接可继续使用。
            </p>
          )}
          {!!choices?.length && (
            <fieldset disabled={busy}>
              <label>
                任务使用的模型
                <select
                  value={selected}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setConsent(false);
                    setStatus("");
                  }}
                >
                  {choices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              {choice && (
                <p>
                  {choice.local
                    ? "任务资料在本机处理。"
                    : "任务消息及所需资料会交给所选模型服务处理。"}
                  {choice.vision ? "支持图片。" : "图片先通过文字识别处理。"}
                </p>
              )}
              {choice && !choice.local && (
                <label className="model-check">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  允许此模型处理我的任务资料
                </label>
              )}
              <div className="toolbar-actions">
                <button
                  onClick={() =>
                    run(async () =>
                      setStatus(
                        (
                          await api("/api/model-choices/test", "POST", {
                            id: selected,
                          })
                        ).message,
                      ),
                    )
                  }
                >
                  测试连接
                </button>
                <button
                  disabled={!choice || (!choice.local && !consent)}
                  onClick={() =>
                    run(async () => {
                      await api("/api/model-choices/select", "POST", {
                        id: selected,
                        consent,
                      });
                      await onSaved();
                      accept(await api("/api/model-choices"));
                      setStatus("已启用，下一次任务使用所选模型。");
                    })
                  }
                >
                  使用所选模型
                </button>
              </div>
              <small>
                测试会发送固定示例文本，不含患者资料；云端测试可能产生少量费用。
              </small>
            </fieldset>
          )}
          <button
            disabled={busy}
            onClick={() =>
              run(async () => accept(await api("/api/model-choices")))
            }
          >
            刷新可用模型
          </button>
          {error && <p role="alert">{error}</p>}
          {status && <p role="status">{status}</p>}
          <details>
            <summary>文字识别</summary>
            <OcrSettingsSection />
          </details>
          <PersonalRegressionSettings />
          <JevSettings />
        </section>
      </div>
    </dialog>
  );
}
