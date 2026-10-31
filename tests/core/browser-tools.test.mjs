import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserTools, browsableURL } from "../../server/core/browser-tools.mjs";

const PAGE = `<!doctype html><html><head><title>挂号查询</title></head><body>
<h1>门诊挂号</h1>
<form action="/result" method="get">
  <input name="q" placeholder="科室或医生">
  <select name="dept"><option value="">全部</option><option value="card">心内科</option><option value="neuro">神经内科</option></select>
  <button type="submit">查询</button>
</form>
<a href="/other" target="_blank">在新窗口打开</a>
<button id="counter" onclick="this.textContent='已点击 ' + (++window.n || (window.n = 1))">计数</button>
<div style="height:3000px"></div><p>页面底部</p>
</body></html>`;

function site() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (url.pathname === "/result")
      return res.end(`<title>结果</title><p>搜索：${url.searchParams.get("q")}｜${url.searchParams.get("dept")}</p>`);
    if (url.pathname === "/other") return res.end(`<title>另一页</title><p>新窗口内容</p>`);
    res.end(PAGE);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

const tools = new BrowserTools();
const skip = tools.status().available ? false : "本机没有 Chrome / Edge / Chromium";

test("任意网址都可以打开；非网页协议和带账号的网址被拒绝", () => {
  assert.equal(browsableURL("https://www.nhc.gov.cn/"), "https://www.nhc.gov.cn/");
  assert.equal(browsableURL("http://10.0.0.8:8080/his"), "http://10.0.0.8:8080/his");
  assert.throws(() => browsableURL("javascript:alert(1)"), /http\(s\)/);
  assert.throws(() => browsableURL("https://user:pw@example.com"), /http\(s\)/);
  assert.throws(() => browsableURL("file:///etc/passwd", "/tmp/ws"), /工作区/);
});

test("像人一样操作网页：编号元素、输入、选择、提交、后退、弹窗、滚动、截图", { skip, timeout: 90000 }, async (t) => {
  const server = await site();
  const owner = "test-" + Date.now();
  t.after(async () => {
    await tools.close(owner);
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const page = await tools.navigate(owner, base + "/");
  assert.equal(page.title, "挂号查询");
  const ref = (pred) => page.elements.find(pred)?.ref;
  const input = ref((e) => e.tag === "input");
  const select = ref((e) => e.tag === "select");
  const submit = ref((e) => e.tag === "button" && e.text === "查询");
  assert.ok(input && select && submit, "输入框、下拉框和按钮都有编号");
  assert.deepEqual(page.elements.find((e) => e.ref === select).options, ["全部", "心内科", "神经内科"]);

  await tools.act(owner, { action: "type", ref: input, text: "王医生" });
  const chosen = await tools.act(owner, { action: "select", ref: select, value: "神经内科" });
  assert.equal(chosen.selected, "神经内科");
  const result = await tools.act(owner, { action: "click", ref: submit });
  assert.equal(result.page.title, "结果");
  assert.match(result.page.text, /搜索：王医生｜neuro/);

  const back = await tools.act(owner, { action: "back" });
  assert.equal(back.page.title, "挂号查询");

  // Clicking the same button twice through real mouse events.
  let state = await tools.snapshot(owner);
  const counter = state.elements.find((e) => e.text === "计数").ref;
  await tools.act(owner, { action: "click", ref: counter });
  state = (await tools.act(owner, { action: "click", ref: counter })).page;
  assert.ok(state.elements.some((e) => e.text === "已点击 2"));

  // Typing then pressing Enter submits the form.
  const q = state.elements.find((e) => e.tag === "input").ref;
  const entered = await tools.act(owner, { action: "type", ref: q, text: "李医生", submit: true });
  assert.match(entered.page.text, /搜索：李医生/);
  await tools.act(owner, { action: "back" });

  // target=_blank continues in the same tab.
  state = await tools.snapshot(owner);
  const link = state.elements.find((e) => e.text === "在新窗口打开").ref;
  await tools.act(owner, { action: "click", ref: link });
  await tools.act(owner, { action: "wait", ms: 800 });
  assert.equal((await tools.snapshot(owner)).title, "另一页");
  await tools.act(owner, { action: "back" });

  const scrolled = await tools.act(owner, { action: "scroll", direction: "down", amount: 1500 });
  assert.ok(scrolled.page.scroll.y >= 1000, `滚动后位置 ${scrolled.page.scroll.y}`);

  const stale = tools.act(owner, { action: "click", ref: 9999 });
  await assert.rejects(stale, /重新 browser_snapshot/);

  const shot = await tools.screenshot(owner, { marks: true });
  assert.equal(shot.mimeType, "image/png");
  assert.ok(Buffer.from(shot.data, "base64").subarray(1, 4).toString() === "PNG");
  // The mark overlay is removed after the screenshot.
  assert.equal((await tools.snapshot(owner)).elements.some((e) => e.text === "1" && e.tag === "span"), false);
});

test("本工作区文件可以打开，工作区外的本地文件不行", { skip, timeout: 60000 }, async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omw-browser-")));
  writeFileSync(join(root, "index.html"), "<title>自检页面</title><button>好</button>");
  const owner = "file-" + Date.now();
  t.after(() => tools.close(owner));
  const page = await tools.navigate(owner, pathToFileURL(join(root, "index.html")).href, root);
  assert.equal(page.title, "自检页面");
  await assert.rejects(tools.navigate(owner, pathToFileURL("/etc/hosts").href, root), /工作区/);
});

test("本应用自己的本机服务不能被助手浏览器打开或通过代理访问", async (t) => {
  const { registerSelfPort, isSelfURL, requestAllowed, isLoopbackURL } = await import("../../server/core/browser-tools.mjs");
  registerSelfPort(48765);
  assert.equal(isSelfURL("http://127.0.0.1:48765/api/bootstrap"), true);
  assert.equal(isSelfURL("http://localhost:48765/"), true);
  assert.equal(isSelfURL("http://[::1]:48765/"), true);
  assert.equal(isSelfURL("http://127.0.0.1:3000/"), false);
  assert.throws(() => browsableURL("http://localhost:48765/api/bootstrap"), /本应用/);
  assert.equal(requestAllowed("http://127.0.0.1:48765/api/x"), false);
  assert.equal(requestAllowed("http://127.0.0.1:3000/"), true, "其他本机开发服务照常可用");
  assert.equal(isLoopbackURL("http://localhost:5173/"), true);
  assert.equal(isLoopbackURL("https://example.com/"), false);

  // Even through a proxy on another port, the server refuses tagged requests.
  const { startTestServer } = await import("../helpers/server.mjs");
  const { createScriptedProvider } = await import("../helpers/scripted-provider.mjs");
  const app = await startTestServer({ provider: createScriptedProvider([]), seedDemoPack: false });
  t.after(() => app.close());
  const tagged = await app.request("/api/bootstrap", { auth: false, headers: { "x-omw-agent-browser": "1" } });
  assert.equal(tagged.status, 403);
  assert.equal(isSelfURL(`${app.url}/api/bootstrap`), true, "测试服务启动后自动登记端口");
});

test("没有联网授权时，工作区页面里的脚本也不能访问网络", { skip, timeout: 60000 }, async (t) => {
  const server = await site();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omw-browser-net-")));
  const base = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(join(root, "leak.html"), `<title>t</title><script>fetch("${base}/").then(()=>document.title="leaked",()=>document.title="blocked")</script>`);
  const owner = "net-" + Date.now();
  t.after(async () => {
    await tools.close(owner);
    server.close();
  });
  tools.setPolicy(owner, { network: false });
  await tools.navigate(owner, pathToFileURL(join(root, "leak.html")).href, root);
  await tools.act(owner, { action: "wait", ms: 500 });
  assert.equal((await tools.snapshot(owner)).title, "blocked");
});

test("同一页面的操作排队执行；会话满时关闭最久未用的浏览器", { skip, timeout: 90000 }, async (t) => {
  const server = await site();
  const base = `http://127.0.0.1:${server.address().port}`;
  const local = new BrowserTools();
  t.after(async () => {
    await local.close();
    server.close();
  });
  // Concurrent first use launches exactly one browser.
  const [a, b] = await Promise.all([local.navigate("one", base + "/"), local.snapshot("one")]);
  assert.equal(a.title, "挂号查询");
  assert.equal(b.title, "挂号查询", "快照排在打开之后");
  assert.equal(local.pages.size, 1);
  for (const id of ["two", "three", "four"]) await local.navigate(id, base + "/");
  await local.navigate("five", base + "/");
  assert.equal(local.pages.size, 4);
  assert.equal(local.pages.has("one"), false, "最久未用的会话被关闭");
  // Watching never launches a browser.
  await assert.rejects(local.screenshot("never", { launch: false }), /还没有打开/);
  assert.equal(local.pages.has("never"), false);
});

test("网页卡死时放弃该页面，下一次操作重新打开，不会一直锁住", { skip, timeout: 60000 }, async (t) => {
  const server = await site();
  const base = `http://127.0.0.1:${server.address().port}`;
  const local = new BrowserTools({ watchdogMs: 3000 });
  t.after(async () => {
    await local.close();
    server.close();
  });
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omw-browser-hang-")));
  writeFileSync(join(root, "hang.html"), `<title>卡死</title><button onclick="while(true){}">卡住</button>`);
  const page = await local.navigate("hang", pathToFileURL(join(root, "hang.html")).href, root);
  await assert.rejects(local.act("hang", { action: "click", ref: page.elements[0].ref }), /没有响应/);
  const next = await local.navigate("hang", base + "/");
  assert.equal(next.title, "挂号查询");
});

test("WebSocket 与网页同样处理：联网时可用，未授权联网时被拦截", { skip, timeout: 60000 }, async (t) => {
  const { WebSocketServer } = await import("ws").catch(() => ({}));
  if (!WebSocketServer) return t.skip("没有 ws 依赖");
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  t.after(() => wss.close());
  await new Promise((r) => wss.once("listening", r));
  let connections = 0;
  wss.on("connection", (socket) => {
    connections++;
    socket.send("hi");
  });
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omw-browser-ws-")));
  writeFileSync(join(root, "ws.html"), `<title>t</title><script>const s=new WebSocket("ws://127.0.0.1:${wss.address().port}");s.onmessage=()=>document.title="open";s.onerror=s.onclose=()=>{if(document.title!=="open")document.title="closed"}</script>`);
  const local = new BrowserTools();
  t.after(() => local.close());
  local.setPolicy("on", { network: true });
  await local.navigate("on", pathToFileURL(join(root, "ws.html")).href, root);
  await local.act("on", { action: "wait", ms: 800 });
  assert.equal((await local.snapshot("on")).title, "open");
  local.setPolicy("off", { network: false });
  await local.navigate("off", pathToFileURL(join(root, "ws.html")).href, root);
  await local.act("off", { action: "wait", ms: 800 });
  assert.equal((await local.snapshot("off")).title, "closed");
  assert.equal(connections, 1);
});
