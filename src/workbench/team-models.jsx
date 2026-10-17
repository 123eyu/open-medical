import { useEffect, useState } from "react";
import { api } from "../agent-runtime";
export function TeamModels({ current, refresh, disabled }) {
  const [profiles, setProfiles] = useState([]),
    [selected, setSelected] = useState(current.teamModels || []),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    api("/api/model-profiles")
      .then((d) => {
        if (alive) setProfiles(d.profiles);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  async function execute(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>团队模型与协作</summary>
      <p>
        选择当前任务可以使用的已有模型。未选择时，协作任务沿用主模型。
      </p>
      <fieldset disabled={disabled || busy}>
        {profiles.map((p) => (
          <label className="workspace-checkbox" key={p.id}>
            <input
              type="checkbox"
              checked={selected.includes(p.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, p.id]
                    : selected.filter((id) => id !== p.id),
                )
              }
            />
            {p.id} · {p.provider} / {p.model}
          </label>
        ))}
        <button
          onClick={() =>
            execute(async () => {
              await api(`/api/workspaces/${current.id}/team-models`, "PUT", {
                profiles: selected,
                consent: true,
                revision: current.revision,
              });
              await refresh();
            })
          }
        >
          授权所选模型处理本任务资料
        </button>

      </fieldset>
      {error && <p role="alert">{error}</p>}
      {current.runs.at(-1)?.children?.map((c) => (
        <details key={c.id}>
          <summary>
            {c.role} · {c.modelProfile || "主模型"} · {c.status}
          </summary>
          <p>{c.task}</p>
          <pre>{c.text || c.error || "等待结果"}</pre>
        </details>
      ))}
    </details>
  );
}
