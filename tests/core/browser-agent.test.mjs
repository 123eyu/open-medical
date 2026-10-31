import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createScriptedProvider, textTurn, toolCall } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";
import { BrowserTools } from "../../server/core/browser-tools.mjs";

const skip = new BrowserTools().status().available ? false : "本机没有 Chrome / Edge / Chromium";

function site() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (url.pathname === "/search")
      return res.end(`<title>检索结果</title><p>共 3 条：${url.searchParams.get("term")}</p>`);
    res.end(`<title>文献检索</title><form action="/search"><input name="term" placeholder="关键词"><button>检索</button></form>`);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

test("助手在对话中打开任意网站、按编号操作、用视觉模型看截图，无需白名单或逐次批准", { skip, timeout: 120000 }, async (t) => {
  const web = await site();
  const base = `http://127.0.0.1:${web.address().port}`;
  const provider = createScriptedProvider([
    toolCall("browser_open", { url: base + "/" }, "call_open"),
    // The search box is ref 1, the button ref 2 on this page.
    toolCall("browser_action", { action: "type", ref: 1, text: "sepsis", submit: true }, "call_type"),
    toolCall("browser_screenshot", { question: "页面显示了几条结果？" }, "call_shot"),
    // Answer to the nested vision request made by browser_screenshot.
    textTurn("截图显示共 3 条结果。"),
    textTurn("检索完成：共 3 条结果。"),
  ]);
  provider.vision = true;
  const app = await startTestServer({ provider, seedDemoPack: false });
  t.after(async () => {
    await app.close();
    web.close();
  });
  const session = await app.request("/api/assistant/session", { method: "POST", body: {} });
  // While the run is still going, the panel can look at the page.
  let midRun = null;
  const complete = provider.complete.bind(provider);
  provider.complete = async (...args) => {
    if (provider.calls.length === 4 && !midRun)
      midRun = await app.request(`/api/workspaces/${session.body.id}/tools`, {
        method: "POST",
        body: { tool: "browser_screenshot", arguments: {} },
      });
    return complete(...args);
  };
  const run = await app.request("/api/agent/run", {
    method: "POST",
    body: { sessionId: session.body.id, message: `打开这个网站查一下 sepsis：${base}`, mode: "model", externalConsent: true },
  });
  assert.equal(run.body.status, "completed", JSON.stringify(run.body).slice(0, 2000));

  const toolResult = (id) => {
    for (const call of provider.calls)
      for (const m of call.messages) if (m.role === "tool" && m.tool_call_id === id) return JSON.parse(m.content);
    return null;
  };
  const opened = toolResult("call_open");
  assert.equal(opened.title, "文献检索");
  assert.deepEqual(opened.elements.map((e) => e.ref), [1, 2]);
  const typed = toolResult("call_type");
  assert.ok(!typed.error, JSON.stringify(typed));
  assert.equal(typed.page.title, "检索结果");
  assert.match(typed.page.text, /共 3 条：sepsis/);

  // The screenshot reached the model as an image in a separate vision call,
  // and the conversation only carries the answer, never base64.
  const visionCall = provider.calls.find((call) =>
    call.messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "input_image")),
  );
  assert.ok(visionCall, "截图以图片形式交给视觉模型");
  const image = visionCall.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((p) => p.type === "input_image");
  assert.match(image.image_url, /^data:image\/png;base64,/);
  const shot = toolResult("call_shot");
  assert.equal(shot.analysis, "截图显示共 3 条结果。");
  assert.equal(shot.title, "检索结果");
  assert.ok(JSON.stringify(shot).length < 2000, "工具结果里没有图片数据");

  assert.equal(midRun?.status, 200, JSON.stringify(midRun?.body).slice(0, 500));
  assert.equal(midRun.body.mimeType, "image/png");
  // The panel refreshes on these events instead of on a timer.
  const log = await app.request(`/api/workspaces/${session.body.id}/events?latest=1`);
  const steps = log.body.events.filter((e) => e.type === "tool.complete" && e.payload?.tool?.startsWith("browser_"));
  assert.deepEqual(steps.map((e) => e.payload.tool), ["browser_open", "browser_action", "browser_screenshot"]);
  assert.ok(steps.every((e) => Number.isInteger(e.id)));
});
