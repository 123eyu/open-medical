import { useEffect, useState } from "react";
import { api } from "./agent-runtime";

const MODULE_LABELS = {
  pandas: "pandas",
  scipy: "SciPy",
  statsmodels: "statsmodels",
  lifelines: "lifelines",
  sklearn: "scikit-learn",
  matplotlib: "matplotlib",
};

// 科研计算环境：安装后助手才能在本机沙箱里对患者库做回归、生存分析等。
export function ResearchEnvSettings() {
  const [env, setEnv] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const load = () => api("/api/research-env").then(setEnv);
  useEffect(() => {
    let alive = true;
    api("/api/research-env")
      .then((value) => alive && setEnv(value))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!env?.installing) return;
    const timer = setInterval(() => void load().catch(() => {}), 2500);
    return () => clearInterval(timer);
  }, [env?.installing]);
  async function install() {
    if (!window.confirm("将下载约 300 MB 的统计分析组件，安装在本机数据目录，可能需要几分钟。继续？")) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      setEnv(await api("/api/research-env/install", "POST"));
      setStatus("已开始安装，可离开此页。");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!env) return error ? <p role="alert">{error}</p> : null;
  const versions = env.modules
    ? Object.entries(MODULE_LABELS)
        .filter(([key]) => env.modules[key])
        .map(([key, label]) => `${label} ${env.modules[key]}`)
        .join("、")
    : "";
  return (
    <section aria-label="科研计算环境">
      <p>
        安装后，助手可以在本机隔离环境中分析患者库（已脱敏），做共性挖掘、危险因素回归和生存分析。分析时禁止联网，也不能读写其他文件；只有汇总结果会交给模型。
      </p>
      {!env.supported ? (
        <p>{env.reason}</p>
      ) : env.installing ? (
        <p role="status">正在安装：{env.step || "准备"}…</p>
      ) : env.installed ? (
        <p role="status">
          已就绪{env.python ? `（Python ${env.python}）` : ""}。{versions}
        </p>
      ) : (
        <button disabled={busy} onClick={install}>
          安装科研计算环境
        </button>
      )}
      {env.error && !env.installing && <p role="alert">{env.error}</p>}
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
