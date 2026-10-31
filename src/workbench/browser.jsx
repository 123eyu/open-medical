import { useEffect, useRef, useState } from "react";
import { api } from "../agent-runtime";

// The assistant's browser for this project. The doctor sees what the
// assistant sees, can click on the page directly, and can show the window to
// log in or pass a captcha before handing back.
export function BrowserPanel({ current, running, events = [], onSettings }) {
  const [url, setUrl] = useState(""),
    [page, setPage] = useState(null),
    [screen, setScreen] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [environment, setEnvironment] = useState(null),
    [checkVersion, setCheckVersion] = useState(0);
  const allowed = current.permissions.grants["browser.read"] === true;
  useEffect(() => {
    let alive = true;
    setEnvironment(null);
    setError("");
    api(`/api/workspaces/${current.id}/extensions`)
      .then((value) => {
        if (alive) setEnvironment(value.browser);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [checkVersion, current.id, current.revision]);
  // The page only changes when the assistant acts on it, so refresh the
  // picture after each of its browser steps instead of on a timer, without
  // re-numbering the elements it is acting on.
  const lastStep = events.findLast(
    (e) => ["tool.complete", "tool.failed"].includes(e.type) && String(e.payload?.tool || "").startsWith("browser_"),
  );
  const stepKey = lastStep ? lastStep.id ?? lastStep.payload?.call_id : null;
  useEffect(() => {
    if (!running || !stepKey || !allowed) return;
    tool("browser_screenshot").then(setScreen).catch(() => {});
  }, [stepKey]);
  // When the assistant finishes, show the final page and its current layout.
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running && screen) void step(() => tool("browser_snapshot"));
    wasRunning.current = running;
  }, [running]);
  const tool = (name, args = {}) =>
    api(`/api/workspaces/${current.id}/tools`, "POST", { tool: name, arguments: args });
  const ready = allowed && environment?.available;
  async function step(work) {
    if (busy || !ready) return;
    setBusy(true);
    setError("");
    try {
      const result = await work();
      const state = result?.page || result || (await tool("browser_snapshot"));
      if (state?.url) {
        setPage(state);
        if (state.url !== "about:blank") setUrl(state.url);
      }
      setScreen(await tool("browser_screenshot"));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const act = (args) => step(() => tool("browser_action", args));
  function clickScreenshot(event) {
    if (!page?.viewport || running) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * page.viewport.width;
    const y = ((event.clientY - box.top) / box.height) * page.viewport.height;
    act({ action: "click_at", x: Math.round(x), y: Math.round(y) });
  }
  async function showWindow() {
    setError("");
    try {
      await api(`/api/workspaces/${current.id}/extensions`, "POST", {
        revision: current.revision,
        action: "browser-show",
      });
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <section className="wb-browser">
      <h3>助手浏览器</h3>
      {!environment?.available && (
        <div>
          <p role="status">
            {environment ? `当前不可用：${environment.reason}` : error ? "无法检查浏览器运行环境" : "正在检查浏览器运行环境…"}
          </p>
          <button onClick={() => setCheckVersion((v) => v + 1)}>重新检查浏览器</button>
        </div>
      )}
      {!allowed ? (
        <>
          <p>此项目关闭了网页浏览。在连接面板勾选「浏览和操作网页」并保存许可后，助手就能打开任意网站。</p>
          <button onClick={onSettings}>打开连接面板</button>
        </>
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              // A bare *.html path is a workspace file, unless it starts with a host (example.com/a.html).
              const hostLike = /^([a-z0-9-]+(\.[a-z0-9-]+)+|localhost|\[::1\])(:\d+)?(\/|$)/i.test(url) && !/^[^/]*\.html?$/i.test(url);
              const workspaceFile = /\.html?$/i.test(url) && !hostLike;
              step(() => tool("browser_open", { url: /^[a-z][a-z0-9+.-]*:\/\//i.test(url) || workspaceFile ? url : `${/^(localhost|127\.|\[::1\])/i.test(url) ? "http" : "https"}://${url}` }));
            }}
          >
            <label>
              网址
              <input
                disabled={busy || running || !ready}
                aria-label="网址"
                placeholder="输入网址，例如 pubmed.ncbi.nlm.nih.gov"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </label>
            <button disabled={busy || running || !url || !ready}>打开</button>
            <button type="button" disabled={busy || running || !ready || !page} onClick={() => act({ action: "back" })}>
              后退
            </button>
            <button
              type="button"
              disabled={busy || !ready}
              onClick={() => (running ? tool("browser_screenshot").then(setScreen).catch((e) => setError(e.message)) : step(() => tool("browser_snapshot")))}
            >
              刷新画面
            </button>
            {environment?.visible && (
              <button type="button" disabled={!ready || !page} onClick={showWindow} title="显示助手正在使用的浏览器窗口，可亲自登录或完成验证码，关闭窗口后助手继续使用同一页面">
                显示浏览器窗口
              </button>
            )}
          </form>
          {busy && <p role="status">正在操作网页…</p>}
          {running && <p className="muted">助手正在工作，画面每 3 秒刷新；结束后可以直接点击页面。</p>}
          {screen && (
            <img
              alt={page?.title ? `网页截图：${page.title}` : "当前网页截图"}
              src={`data:${screen.mimeType};base64,${screen.data}`}
              onClick={clickScreenshot}
              style={{ cursor: running ? "default" : "pointer", maxWidth: "100%" }}
            />
          )}
          {page && (
            <details>
              <summary>页面文字</summary>
              <pre>{page.text}</pre>
            </details>
          )}
          <p className="muted">
            在对话里告诉助手要在网站上做什么，它会自己打开、点击、填写和查看页面。登录信息只保存在本项目的助手浏览器中；付款、提交正式申请等操作前助手会先问你。
          </p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
