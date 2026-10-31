import { useEffect, useState } from "react";
import { api } from "./agent-runtime";

// A managed local Python environment (venv + OS sandbox), installed on click.
function PythonEnvSettings({ endpoint, title, intro, installLabel, confirmText, moduleLabels }) {
  const [env, setEnv] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const load = () => api(endpoint).then(setEnv);
  useEffect(() => {
    let alive = true;
    api(endpoint)
      .then((value) => alive && setEnv(value))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [endpoint]);
  useEffect(() => {
    if (!env?.installing) return;
    const timer = setInterval(() => void load().catch(() => {}), 2500);
    return () => clearInterval(timer);
  }, [env?.installing]);
  async function install() {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      setEnv(await api(endpoint + "/install", "POST"));
      setStatus("已开始安装，可离开此页。");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!env) return error ? <p role="alert">{error}</p> : null;
  const versions = env.modules
    ? Object.entries(moduleLabels)
        .filter(([key]) => env.modules[key])
        .map(([key, label]) => `${label} ${env.modules[key]}`)
        .join("、")
    : "";
  return (
    <section aria-label={title}>
      <p>{intro}</p>
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
          {installLabel}
        </button>
      )}
      {env.error && !env.installing && <p role="alert">{env.error}</p>}
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
    </section>
  );
}

// 科研计算环境：安装后助手才能在本机沙箱里对患者库做回归、生存分析等。
export function ResearchEnvSettings() {
  return (
    <PythonEnvSettings
      endpoint="/api/research-env"
      title="科研计算环境"
      intro="安装后，助手可以在本机隔离环境中分析患者库（已脱敏），做共性挖掘、危险因素回归和生存分析。分析时禁止联网，也不能读写其他文件；只有汇总结果会交给模型。"
      installLabel="安装科研计算环境"
      confirmText="将下载约 300 MB 的统计分析组件，安装在本机数据目录，可能需要几分钟。继续？"
      moduleLabels={{
        pandas: "pandas",
        scipy: "SciPy",
        statsmodels: "statsmodels",
        lifelines: "lifelines",
        sklearn: "scikit-learn",
        matplotlib: "matplotlib",
      }}
    />
  );
}

// 文档生成环境：安装后生成 PPT/Word/Excel/PDF 不再需要 Docker。
export function DocumentEnvSettings() {
  return (
    <PythonEnvSettings
      endpoint="/api/document-env"
      title="文档生成环境"
      intro="安装后，助手可以直接在本机生成 PPT、Word、Excel 和 PDF，不需要 Docker。生成过程在系统沙箱里运行：禁止联网，不能读写其他文件；生成的文件按项目的写入授权写进文件夹。"
      installLabel="安装文档生成环境"
      confirmText="将下载约 70 MB 的文档组件（python-pptx、python-docx、openpyxl、reportlab 等），安装在本机数据目录。继续？"
      moduleLabels={{
        pptx: "python-pptx",
        docx: "python-docx",
        openpyxl: "openpyxl",
        reportlab: "reportlab",
      }}
    />
  );
}
