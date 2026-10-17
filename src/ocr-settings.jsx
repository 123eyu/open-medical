import { useEffect, useState } from "react";
import { api } from "./agent-runtime";
export function OcrSettingsSection() {
  const [data, setData] = useState(null),
    [engine, setEngine] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  async function load() {
    const [settings, local] = await Promise.all([
      api("/api/ocr-settings"),
      api("/api/ocr-settings/local-engine"),
    ]);
    setData(settings);
    setEngine(local);
  }
  useEffect(() => {
    let alive = true;
    Promise.all([
      api("/api/ocr-settings"),
      api("/api/ocr-settings/local-engine"),
    ])
      .then(([d, e]) => {
        if (alive) {
          setData(d);
          setEngine(e);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!engine?.installing) return;
    const timer = setInterval(() => {
      void load().catch(() => {});
    }, 2500);
    return () => clearInterval(timer);
  }, [engine?.installing]);
  async function run(fn) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    const result = await api("/api/ocr-settings/local-engine/start", "POST");
    await api("/api/ocr-settings", "PUT", {
      service: { baseUrl: result.baseUrl },
    });
    setStatus("本机识别已启用。");
  }
  return (
    <section aria-label="文字识别">
      <p>
        选择扫描件和照片的识别方式。沿用已有识别服务，也可以一键安装本机引擎。
      </p>
      {data && (
        <fieldset disabled={busy}>
          <label>
            识别方式
            <select
              value={data.strategy}
              onChange={(e) =>
                run(async () => {
                  setData(
                    await api("/api/ocr-settings", "PUT", {
                      strategy: e.target.value,
                    }),
                  );
                  setStatus("识别方式已保存。");
                })
              }
            >
              {Object.entries(data.strategies).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p>
            {data.model
              ? `专用识别模型：${data.model.model}`
              : "需要模型时使用当前主模型的图片能力"}
            。仅本机模式不会向模型发送图片。
          </p>
          {engine?.installing ? (
            <p role="status">
              正在安装识别引擎，可离开此页，稍后回来启用。{engine.error || ""}
            </p>
          ) : engine?.installed ? (
            <button
              onClick={() =>
                run(
                  engine.running
                    ? async () => {
                        await api(
                          "/api/ocr-settings/local-engine/stop",
                          "POST",
                        );
                        setStatus("已停止本机引擎，继续使用系统识别。");
                      }
                    : start,
                )
              }
            >
              {engine.running ? "停止本机引擎" : "启用本机识别"}
            </button>
          ) : (
            <button
              onClick={() => {
                if (
                  window.confirm(
                    "安装本机识别引擎将下载约 320 MB 的组件和模型，可能需要几分钟。继续？",
                  )
                )
                  run(async () => {
                    await api("/api/ocr-settings/local-engine/install", "POST");
                    setStatus("已开始安装，完成后点击启用本机识别。");
                  });
              }}
            >
              安装本机识别引擎
            </button>
          )}
          {engine?.error && <p role="alert">{engine.error}</p>}
          <button
            onClick={() =>
              run(async () =>
                setStatus(
                  (
                    await api("/api/ocr-settings/test", "POST", {
                      scope: "local",
                    })
                  ).message,
                ),
              )
            }
          >
            测试本机识别
          </button>
          {data.imageCapable && (
            <button
              onClick={() =>
                run(async () =>
                  setStatus(
                    (await api("/api/ocr-settings/test", "POST", {})).message,
                  ),
                )
              }
            >
              测试识别模型
            </button>
          )}
        </fieldset>
      )}
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
