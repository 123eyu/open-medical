import { useEffect, useState } from "react";
import { api } from "../agent-runtime";
export function RemoteJobs({ current, refresh }) {
  const [url, setUrl] = useState(""),
    [prompt, setPrompt] = useState(""),
    [paths, setPaths] = useState([]),
    [files, setFiles] = useState([]),
    [directory, setDirectory] = useState("."),
    [consent, setConsent] = useState(false),
    [jobs, setJobs] = useState([]),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const base = `/api/workspaces/${current.id}/remote-jobs`;
  useEffect(() => {
    let alive = true;
    api(base, "POST", { action: "list" })
      .then((d) => {
        if (alive) {
          setJobs(d.jobs);
          setUrl(d.url || "");
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [base]);
  async function browse(path) {
    setBusy(true); setError('');
    try { setFiles(await api(`/api/workspaces/${current.id}/tools`, 'POST', { tool: 'list_directory', arguments: { path } })); setDirectory(path); } catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  async function run(input) {
    setBusy(true);
    setError("");
    try {
      const d = await api(base, "POST", input);
      if (d.jobs) setJobs(d.jobs);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  // 远程队列只能用 scripts/remote-worker.mjs 配置；未配置且没有历史任务时不展示。
  if (!loaded || (!url && !jobs.length)) return null;
  return (
    <details>
      <summary>远程任务</summary>
      <p>
        文件发送到已连接的远程服务处理。结果先回到本地审批，不覆盖当前文件。
      </p>
      {!url && <p>远程连接配置已失效，只能查看和管理已有任务记录。</p>}
      {url && <p>已有远程连接可用。</p>}
      <label>
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        授权连接并上传下方指定文件与任务
      </label>
      <label>
        任务说明
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </label>
      {url && <div><button disabled={busy} onClick={() => browse('.')}>选择要发送的文件</button>
        {directory !== '.' && <button disabled={busy} onClick={() => browse(directory.split('/').slice(0, -1).join('/') || '.')}>返回上层文件夹</button>}
        {files.map(file => { const path = directory === '.' ? file.name : directory + '/' + file.name; return file.directory ? <button key={path} disabled={busy} onClick={() => browse(path)}>{file.name} →</button> : <label key={path}><input type="checkbox" checked={paths.includes(path)} onChange={e => { setPaths(e.target.checked ? [...paths, path] : paths.filter(p => p !== path)); setConsent(false); }} />{file.name}</label>; })}
        {!!paths.length && <p>已选择：{paths.join('、')}</p>}
      </div>}
      <button
        disabled={!url || !consent || !prompt.trim() || busy}
        onClick={() =>
          run({
            action: "submit",
            prompt,
            paths,
            consent,
          })
        }
      >
        提交远程任务
      </button>
      {jobs.map((job) => (
        <article key={job.id}>
          <p>
            {job.id} · {job.status}
          </p>
          {job.error && <p>{job.error}</p>}
          <button
            disabled={busy}
            onClick={() => run({ action: "refresh", id: job.id })}
          >
            重新查询
          </button>
          <button
            disabled={
              busy || !consent || !["running", "queued"].includes(job.status)
            }
            onClick={() => run({ action: "cancel", id: job.id, consent })}
          >
            取消
          </button>
          <button
            disabled={
              busy ||
              !consent ||
              !["interrupted", "failed", "cancelled"].includes(job.status)
            }
            onClick={() => run({ action: "retry", id: job.id, consent })}
          >
            重新执行
          </button>
          <button
            disabled={
              busy ||
              !consent ||
              job.imported ||
              !["completed", "failed"].includes(job.status)
            }
            onClick={() => run({ action: "import", id: job.id, consent })}
          >
            {job.imported ? "已导入审批" : "导入结果与文件审批"}
          </button>
          <button
            disabled={
              busy || !consent || ["running", "queued"].includes(job.status)
            }
            onClick={() => run({ action: "remove", id: job.id, consent })}
          >
            删除远端记录
          </button>
        </article>
      ))}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
