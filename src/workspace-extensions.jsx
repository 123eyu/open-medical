import { useEffect, useState } from "react";
import { api } from "./agent-runtime";

const grants = [
  ["terminal", "process.spawn", "运行分析工具"],
  ["browser", "browser.read", "浏览和操作网页（任意网站）"],
  ["plugins", "plugins.execute", "使用已安装插件"],
  ["mcp", "mcp.execute", "使用已连接服务"],
  ["memoryRead", "memory.read", "读取项目记忆"],
  ["memoryWrite", "memory.write", "更新项目记忆"],
];
export function WorkspaceExtensionsPanel({
  workspace,
  refresh,
  disabled,
  focus = "",
}) {
  const base = `/api/workspaces/${workspace.id}`;
  const [data, setData] = useState(null),
    [form, setForm] = useState({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [image, setImage] = useState(""),
    [authorizationUrl, setAuthorizationUrl] = useState("");
  useEffect(() => {
    let alive = true;
    api(base + "/extensions")
      .then((result) => {
        if (alive) {
          setData(result);
          setForm(
            Object.fromEntries(
              grants.map(([name, key]) => [
                name,
                Boolean(workspace.permissions.grants[key]),
              ]),
            ),
          );
          setImage("");
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [base, workspace.revision]);
  async function manage(body) {
    setBusy(true);
    setError("");
    try {
      const result = await api(base + "/extensions", "POST", {
        revision: workspace.revision,
        ...body,
      });
      if (result.authorizationUrl) setAuthorizationUrl(result.authorizationUrl);
      await refresh(workspace.id);
      setData(await api(base + "/extensions"));
      return result;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  // MCP 服务和插件目前只能通过本机接口添加；没有已配置项时不显示对应许可。
  const shown = data
    ? grants.filter(
        ([name]) =>
          form[name] ||
          (name === "plugins"
            ? data.config.plugins.length > 0
            : name === "mcp"
              ? data.config.mcpServers.length > 0
              : true),
      )
    : [];
  return (
    <section
      className="workspace-files extension-panel"
      aria-label="项目工具与连接"
    >
      <h3>{focus === "terminal" ? "分析工具" : "项目工具与连接"}</h3>
      <p>
        在项目对话中描述要完成的事，助手会调用已授权的工具。这里管理访问许可和已有连接。
      </p>
      {!data && !error && <p role="status">正在读取…</p>}
      {error && <p role="alert">{error}</p>}
      {data && (
        <fieldset disabled={disabled || busy}>
          <h4>访问许可</h4>
          {shown.map(([name, , label]) => (
            <label className="workspace-checkbox" key={name}>
              <input
                type="checkbox"
                checked={Boolean(form[name])}
                disabled={
                  name === "terminal" && !form[name] && !data.sandbox.available
                }
                onChange={(e) => {
                  setForm({ ...form, [name]: e.target.checked });
                  setConsent(false);
                }}
              />
              {label}
            </label>
          ))}
          <p className="muted">
            {data.sandbox.available ? "分析环境已就绪" : "隔离分析环境暂不可用"}{" "}
            · {data.browser.available ? "浏览器已就绪" : "浏览器暂不可用"}
            。保存后会结束工具会话并暂停计划。
          </p>
          {!data.sandbox.available && data.sandbox.reason && (
            <p className="muted">分析工具：{data.sandbox.reason}</p>
          )}
          {!data.browser.available && data.browser.reason && (
            <p className="muted">浏览器：{data.browser.reason}</p>
          )}
          {form.terminal && (
            <label>
              本地镜像
              <input
                value={image}
                placeholder={
                  data.config.image
                    ? `已选择 ${data.config.image.replace(/^sha256:/, "").slice(0, 12)}，留空则沿用`
                    : "例如 open-medical-tools:latest"
                }
                onChange={(e) => {
                  setImage(e.target.value);
                  setConsent(false);
                }}
              />
              <small>填写已导入 Docker 的镜像名称；不会自动下载。</small>
            </label>
          )}
          <label className="workspace-checkbox">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            允许所选工具在当前项目内工作
          </label>
          <button
            disabled={!consent}
            onClick={async () => {
              await manage({
                action: "configure",
                ...form,
                image: image.trim() || data.config.image || "",
                searchUrl: data.config.searchUrl || "",
                memory: data.config.memory,
                terminalNetwork: Boolean(data.config.terminalNetwork),
                consent,
              });
              setConsent(false);
            }}
          >
            保存许可
          </button>
          {!!data.config.mcpServers.length && <h4>已连接服务</h4>}
          {data.config.mcpServers.map((server) => (
            <article key={server.id}>
              <strong>{server.name || server.id}</strong>
              <p>
                {data.connections.find((c) => c.id === server.id)?.connected
                  ? "已连接"
                  : "尚未连接"}
              </p>
              {server.oauth && (
                <>
                  <button
                    onClick={() =>
                      manage({
                        action: "oauth-start",
                        serverId: server.id,
                        consent: true,
                      })
                    }
                  >
                    登录并连接
                  </button>
                  <button
                    onClick={() =>
                      manage({
                        action: "oauth-revoke",
                        serverId: server.id,
                        consent: true,
                      })
                    }
                  >
                    退出账号
                  </button>
                </>
              )}
              <button
                onClick={() =>
                  manage({ action: "connect-mcp", serverId: server.id })
                }
              >
                重新连接
              </button>
              <button
                onClick={() =>
                  manage({ action: "disconnect-mcp", serverId: server.id })
                }
              >
                断开
              </button>
            </article>
          ))}
          {authorizationUrl && (
            <p>
              <a href={authorizationUrl} target="_blank" rel="noreferrer">
                打开账号授权页
              </a>{" "}
              · 完成后返回并重新连接。
            </p>
          )}
          {!!data.config.plugins.length && <h4>已安装插件</h4>}
          {data.config.plugins.map((plugin) => (
            <PluginCard
              key={`${plugin.id}:${plugin.hash}`}
              plugin={plugin}
              locked={disabled || busy}
              manage={manage}
            />
          ))}
          {!!data.memories.length && (
            <details>
              <summary>项目记忆 · {data.memories.length} 条</summary>
              {data.memories.map((m) => (
                <article key={m.id}>
                  <strong>{m.title}</strong>
                  <p>{m.text.slice(0, 200)}</p>
                  <button
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        await api(base + "/tools", "POST", {
                          tool: "memory_delete",
                          arguments: { id: m.id },
                        });
                        setData(await api(base + "/extensions"));
                        await refresh(workspace.id);
                      } catch (e) {
                        setError(e.message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    删除这条记忆
                  </button>
                </article>
              ))}
            </details>
          )}
        </fieldset>
      )}
    </section>
  );
}
function PluginCard({ plugin, locked, manage }) {
  const [commands, setCommands] = useState(plugin.allowedCommands),
    [skills, setSkills] = useState(plugin.allowedSkills),
    [hooks, setHooks] = useState(plugin.allowedHooks || []);
  const toggle = (values, id) =>
    values.includes(id) ? values.filter((x) => x !== id) : [...values, id];
  return (
    <article>
      <strong>
        {plugin.manifest.name} · {plugin.enabled ? "已启用" : "未启用"}
      </strong>
      <p>{plugin.manifest.description}</p>
      {plugin.manifest.skills.map((s) => (
        <label key={s.id}>
          <input
            type="checkbox"
            checked={skills.includes(s.id)}
            onChange={() => setSkills(toggle(skills, s.id))}
          />
          {s.description || s.name || s.id}
        </label>
      ))}
      {plugin.manifest.commands.map((c) => (
        <label key={c.id}>
          <input
            type="checkbox"
            checked={commands.includes(c.id)}
            onChange={() => setCommands(toggle(commands, c.id))}
          />
          {c.description}
        </label>
      ))}
      {(plugin.manifest.hooks || []).map((h) => (
        <label key={h.id}>
          <input
            type="checkbox"
            checked={hooks.includes(h.id)}
            onChange={() => setHooks(toggle(hooks, h.id))}
          />
          自动执行：{h.description || h.event}
        </label>
      ))}
      <button
        disabled={locked}
        onClick={() =>
          manage({
            action: "plugin-state",
            pluginId: plugin.id,
            enabled: true,
            allowedCommands: commands,
            allowedSkills: skills,
            allowedHooks: hooks,
          })
        }
      >
        启用所选能力
      </button>
      <button
        disabled={locked}
        onClick={() =>
          manage({
            action: "plugin-state",
            pluginId: plugin.id,
            enabled: false,
            allowedCommands: [],
            allowedSkills: [],
            allowedHooks: [],
          })
        }
      >
        停用
      </button>
    </article>
  );
}
