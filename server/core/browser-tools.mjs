import { chromium } from "playwright-core";
import { AppError, check } from "../errors.mjs";
import { resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Local-only fallbacks so self-verification works without any configuration.
const browserCandidates = () =>
  process.env.AGENT_BROWSER_EXECUTABLE
    ? [process.env.AGENT_BROWSER_EXECUTABLE]
    : process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ]
      : process.platform === "win32"
        ? [
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/chromium-browser",
            "/usr/bin/chromium",
          ];

// web_fetch reads any http(s) page, never the app's own local service.
export function fetchableURL(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new AppError("WEB_URL", "网址无效，请提供完整网址（如 https://example.com）", 400);
  }
  check(
    ["http:", "https:"].includes(url.protocol) && !url.username && !url.password,
    "WEB_URL",
    "只能读取 http(s) 网页",
    400,
  );
  check(!isSelfURL(url.href), "WEB_URL", "不能读取本应用自己的本机服务", 403);
  return url.href;
}

// Ports this process serves on. The agent browser must never load the app's
// own API: its pages would expose the session token to whatever site the
// agent is reading.
const SELF_PORTS = new Set();
export function registerSelfPort(port) {
  if (Number.isInteger(port) && port > 0) SELF_PORTS.add(port);
}
const hostOf = (u) => u.hostname.replace(/\.$/, "");
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|0\.0\.0\.0|\[::1?\]|\[::ffff:(127(\.\d{1,3}){3}|7f[0-9a-f]{2}:[0-9a-f]{1,4})\])$/i;
// Agent-browser requests to loopback carry this header, and the app's own
// servers refuse them, so a dev proxy (e.g. Vite) cannot relay them either.
export const AGENT_BROWSER_HEADER = "x-omw-agent-browser";
export function isLoopbackURL(input) {
  try {
    const u = new URL(input);
    return ["http:", "https:", "ws:", "wss:"].includes(u.protocol) && (LOOPBACK.test(hostOf(u)) || hostOf(u).endsWith(".localhost"));
  } catch {
    return false;
  }
}
export function isSelfURL(input) {
  try {
    const u = new URL(input);
    if (!["http:", "https:", "ws:", "wss:"].includes(u.protocol)) return false;
    const port = Number(u.port || (["https:", "wss:"].includes(u.protocol) ? 443 : 80));
    return SELF_PORTS.has(port) && (LOOPBACK.test(hostOf(u)) || hostOf(u).endsWith(".localhost"));
  } catch {
    return false;
  }
}

// The agent browser behaves like a person's browser: any http(s) page, plus
// files inside the authorized workspace for self-verification.
export function browsableURL(input, root) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new AppError("BROWSER_URL", "网址无效，请提供完整网址（如 https://example.com）", 400);
  }
  if (url.protocol === "file:") return workspaceFileURL(url, root);
  check(
    ["http:", "https:", "about:"].includes(url.protocol) && !url.username && !url.password,
    "BROWSER_URL",
    "只能打开 http(s) 网页或本工作区内的文件",
    400,
  );
  check(!isSelfURL(url.href), "BROWSER_URL", "助手浏览器不能打开本应用自己的本机服务", 403);
  return url.href;
}

// Every request a page makes (documents, scripts, fetch) goes through this.
// Without the network grant only workspace files and inline data load.
export function requestAllowed(input, { root = null, network = true } = {}) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return false;
  }
  if (url.protocol === "file:") {
    try {
      workspaceFileURL(url, root);
      return true;
    } catch {
      return false;
    }
  }
  if (["data:", "blob:", "about:"].includes(url.protocol)) return true;
  // WebSockets follow the same rules as pages (chat sites, live dashboards).
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol) || url.username || url.password) return false;
  return network && !isSelfURL(url.href);
}

function workspaceFileURL(url, root) {
  let target = resolve(fileURLToPath(url)),
    base = typeof root === "string" ? root : "";
  // Windows paths compare case-insensitively (C:\ vs c:\).
  if (process.platform === "win32") {
    target = target.toLowerCase();
    base = base.toLowerCase();
  }
  check(
    base.length > 1 && (target === base || target.startsWith(base + sep)),
    "BROWSER_ORIGIN",
    "本地文件浏览仅限授权工作区内的文件",
    403,
  );
  return url.href;
}

// Page-side helpers shared by every driver. Interactive elements get a
// numeric ref (data-omw-ref) so the model can act by number, the way
// browser-use and Playwright MCP expose pages to agents.
const PAGE_STATE = `(() => {
  const MAX = 200;
  for (const e of document.querySelectorAll("[data-omw-ref]")) e.removeAttribute("data-omw-ref");
  const selector = 'a[href],button,input:not([type=hidden]),textarea,select,summary,label[for],[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[role=combobox],[role=textbox],[role=searchbox],[contenteditable=""],[contenteditable=true],[onclick],[tabindex]:not([tabindex="-1"])';
  const vw = innerWidth, vh = innerHeight, elements = [];
  let ref = 0;
  for (const e of document.querySelectorAll(selector)) {
    const r = e.getBoundingClientRect(), style = getComputedStyle(e);
    if (r.width < 1 || r.height < 1 || style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
    e.setAttribute("data-omw-ref", String(++ref));
    const tag = e.tagName.toLowerCase(), type = e.getAttribute("type") || undefined;
    const label = (e.getAttribute("aria-label") || e.innerText || e.getAttribute("title") || e.getAttribute("alt") || "").replace(/\\s+/g, " ").trim().slice(0, 120);
    const item = { ref, tag, text: label || undefined };
    const role = e.getAttribute("role"); if (role) item.role = role;
    if (type) item.type = type;
    if (e.name) item.name = e.name;
    if (e.placeholder) item.placeholder = e.placeholder.slice(0, 80);
    if (tag === "a" && e.href) item.href = e.href.slice(0, 300);
    if ("value" in e && tag !== "button" && type !== "password" && e.value) item.value = String(e.value).slice(0, 200);
    if (tag === "select") item.options = [...e.options].slice(0, 30).map((o) => o.text.trim().slice(0, 60));
    if (e.checked) item.checked = true;
    if (e.disabled) item.disabled = true;
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) item.offscreen = true;
    elements.push(item);
    if (elements.length >= MAX) break;
  }
  const text = (document.body ? document.body.innerText : "").replace(/\\n{3,}/g, "\\n\\n");
  return {
    url: location.href,
    title: document.title,
    text: text.slice(0, 15000),
    truncated: text.length > 15000,
    viewport: { width: vw, height: vh },
    scroll: { y: Math.round(scrollY), height: document.documentElement.scrollHeight },
    elements,
  };
})()`;

const refExpression = (ref, body) => `(() => {
  const e = document.querySelector('[data-omw-ref="${Number(ref)}"]');
  if (!e) return { missing: true };
  ${body}
})()`;

const CENTER = `e.scrollIntoView({ block: "center", inline: "center" });
  const r = e.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), tag: e.tagName.toLowerCase(), type: e.getAttribute("type"), editable: e.isContentEditable };`;

const SELECT_ALL = `e.focus();
  if (typeof e.select === "function") e.select();
  else if (e.isContentEditable) { const range = document.createRange(); range.selectNodeContents(e); const s = getSelection(); s.removeAllRanges(); s.addRange(range); }
  return { ok: true };`;

const chooseOption = (value) => `if (e.tagName !== "SELECT") return { error: "该元素不是下拉框" };
  const want = ${JSON.stringify(String(value))};
  const option = [...e.options].find((o) => o.value === want || o.text.trim() === want) || [...e.options].find((o) => o.text.includes(want));
  if (!option) return { error: "下拉框中没有该选项" };
  e.value = option.value;
  e.dispatchEvent(new Event("input", { bubbles: true }));
  e.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, selected: option.text.trim() };`;

// Set-of-mark overlay for screenshots: numbered boxes matching the refs.
const MARKS_ON = `(() => {
  // Reuse the refs the model already holds; number the page only if none exist.
  if (!document.querySelector("[data-omw-ref]")) ${PAGE_STATE};
  document.getElementById("__omw_marks")?.remove();
  const layer = document.createElement("div");
  layer.id = "__omw_marks";
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  for (const e of document.querySelectorAll("[data-omw-ref]")) {
    const r = e.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;border:2px solid #e11d48;left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px;box-sizing:border-box";
    const tag = document.createElement("span");
    tag.textContent = e.getAttribute("data-omw-ref");
    tag.style.cssText = "position:absolute;left:-2px;top:" + (r.top < 16 ? 0 : -16) + "px;background:#e11d48;color:#fff;font:bold 11px/14px sans-serif;padding:0 3px";
    box.appendChild(tag);
    layer.appendChild(box);
  }
  document.documentElement.appendChild(layer);
  // Resolve after the overlay is painted so the capture includes it.
  return new Promise((done) => {
    const timer = setTimeout(() => done(true), 400);
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); done(true); }));
  });
})()`;
const MARKS_OFF = `(() => { document.getElementById("__omw_marks")?.remove(); return true; })()`;

export const BROWSER_ACTIONS = [
  "click", "double_click", "right_click", "hover", "type", "select", "press",
  "scroll", "click_at", "back", "forward", "reload", "wait",
];


const MAX_SESSIONS = 4;
// Longer than the slowest working navigation (30s load + 15s check + settle +
// page read), so only a truly frozen page is discarded.
const WATCHDOG_MS = 75000;

export class BrowserTools {
  constructor({
    factory,
    executablePath = browserCandidates().find(existsSync),
    watchdogMs = WATCHDOG_MS,
  } = {}) {
    this.factory = factory;
    this.watchdogMs = watchdogMs;
    this.executablePath = executablePath;
    this.pages = new Map(); // owner -> Promise<driver>
    this.policies = new Map(); // owner -> { root, network }
    this.locks = new Map(); // owner -> tail of the operation queue
    this.used = new Map(); // owner -> last use, for eviction
  }
  status() {
    return {
      available: Boolean(this.factory || this.executablePath),
      backend: this.factory ? "electron-chromium" : "playwright",
      // A desktop browser window can be shown so the user can log in or
      // finish a captcha, then hand control back.
      visible: Boolean(this.factory),
      reason:
        this.factory || this.executablePath
          ? undefined
          : "未找到可用的本机浏览器（Chrome / Edge / Chromium）",
    };
  }
  policy(owner) {
    if (!this.policies.has(owner)) this.policies.set(owner, { root: null, network: true });
    return this.policies.get(owner);
  }
  // Grants are re-read before every operation; the drivers consult the
  // policy on each request, so a page cannot outrun a revoked grant.
  setPolicy(owner, patch) {
    Object.assign(this.policy(owner), patch);
  }
  // One operation at a time per page: refs and navigation would otherwise
  // interleave between the agent, sub-agents and the panel.
  exclusive(owner, operation) {
    const previous = this.locks.get(owner) || Promise.resolve();
    const run = previous.catch(() => {}).then(operation);
    const tail = run.catch(() => {});
    this.locks.set(owner, tail);
    tail.then(() => {
      if (this.locks.get(owner) === tail) this.locks.delete(owner);
    });
    return run;
  }
  async get(owner, { launch = true } = {}) {
    this.used.set(owner, Date.now());
    const pending = this.pages.get(owner);
    if (pending) {
      const driver = await pending.catch(() => null);
      if (driver && !driver.dead) return driver;
      if (this.pages.get(owner) === pending) this.pages.delete(owner);
      // A crashed page still holds a window or Chromium process.
      await driver?.close().catch(() => {});
    }
    check(launch, "BROWSER_CLOSED", "助手浏览器还没有打开网页", 409);
    while (this.pages.size >= MAX_SESSIONS) await this.evict(owner);
    const policy = this.policy(owner);
    const allows = (url) => requestAllowed(url, policy);
    const created = this.factory
      ? Promise.resolve().then(() => this.factory(owner, { allows, tagged: isLoopbackURL, header: AGENT_BROWSER_HEADER }))
      : this.launchPlaywright(allows);
    this.pages.set(owner, created);
    try {
      return await created;
    } catch (error) {
      if (this.pages.get(owner) === created) this.pages.delete(owner);
      throw error;
    }
  }
  // Close the least recently used idle browser. Desktop logins persist.
  async evict(except) {
    const idle = [...this.pages.keys()]
      .filter((id) => id !== except && !this.locks.has(id))
      .sort((a, b) => (this.used.get(a) || 0) - (this.used.get(b) || 0));
    check(idle.length, "BROWSER_LIMIT", "同时在用的浏览器会话超过上限，请等其他任务结束后重试");
    await this.close(idle[0]);
  }
  async launchPlaywright(allows) {
    check(this.executablePath, "BROWSER_UNAVAILABLE", "当前运行方式未配置浏览器", 503);
    const browser = await chromium.launch({
      executablePath: this.executablePath,
      headless: true,
      chromiumSandbox: true,
    });
    const context = await browser.newContext({
      acceptDownloads: false,
      viewport: { width: 1280, height: 900 },
      permissions: [],
      // Service workers would fetch outside context.route.
      serviceWorkers: "block",
    });
    // context.route does not see WebSockets; apply the same policy here.
    await context.routeWebSocket(/.*/, (ws) => {
      if (!allows(ws.url())) return ws.close({ code: 1008, reason: "blocked" });
      ws.connectToServer();
    });
    await context.route("**/*", (route) => {
      const request = route.request();
      if (!allows(request.url())) return route.abort("blockedbyclient");
      return isLoopbackURL(request.url())
        ? route.continue({ headers: { ...request.headers(), [AGENT_BROWSER_HEADER]: "1" } })
        : route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    // Popups (target=_blank, window.open) continue in the same tab.
    context.on("page", async (popup) => {
      if (popup === page) return;
      await popup.waitForLoadState("domcontentloaded").catch(() => {});
      const url = popup.url();
      await popup.close().catch(() => {});
      if (/^https?:/i.test(url)) await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
    });
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    const driver = {
      navigate: async (url) => {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      },
      history: async (direction) => {
        if (direction === "reload") await page.reload({ waitUntil: "domcontentloaded" });
        else if (direction === "back") await page.goBack({ waitUntil: "domcontentloaded" });
        else await page.goForward({ waitUntil: "domcontentloaded" });
      },
      evaluate: (expression) => page.evaluate(expression),
      click: (x, y, { button = "left", clickCount = 1 } = {}) => page.mouse.click(x, y, { button, clickCount }),
      move: (x, y) => page.mouse.move(x, y),
      wheel: async (x, y, dx, dy) => {
        await page.mouse.move(x, y);
        await page.mouse.wheel(dx, dy);
      },
      type: (text) => page.keyboard.insertText(text),
      press: (combo) => page.keyboard.press(combo.replace(/\b(Cmd|Command)\b/g, "Meta").replace(/\bCtrl\b/g, "Control")),
      screenshot: async () => (await page.screenshot({ fullPage: false })).toString("base64"),
      close: () => browser.close(),
      dead: false,
    };
    browser.on("disconnected", () => {
      driver.dead = true;
    });
    page.on("crash", () => {
      driver.dead = true;
    });
    return driver;
  }
  // Wait briefly for a navigation or re-render to settle after an action.
  async settle(driver) {
    const deadline = Date.now() + 4000;
    await new Promise((r) => setTimeout(r, 250));
    while (Date.now() < deadline) {
      const state = await driver.evaluate("document.readyState").catch(() => "loading");
      if (state !== "loading") break;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  async readState(driver, textLimit = 15000) {
    const state = await driver.evaluate(PAGE_STATE);
    if (state.text.length > textLimit) {
      state.text = state.text.slice(0, textLimit);
      state.truncated = true;
    }
    return state;
  }
  async navigate(owner, url, root) {
    const target = browsableURL(url, root);
    return this.exclusive(owner, () => this.watchdog(owner, async () => {
      if (root) this.policy(owner).root = root;
      const driver = await this.get(owner);
      try {
        await driver.navigate(target);
      } catch (error) {
        if (error instanceof AppError) throw error;
        const reason = /(ERR_[A-Z_]+)/.exec(error.message)?.[1];
        // A slow page that already rendered the requested address is usable;
        // the previous page still showing is not.
        const loaded = await driver.evaluate("location.href").catch(() => "");
        if (loaded !== target)
          throw new AppError("BROWSER_NAVIGATION", `网页未能加载${reason ? `（${reason}）` : ""}，请检查网址与网络后重试。`, 502);
      }
      await this.settle(driver);
      return this.readState(driver);
    }));
  }
  snapshot(owner) {
    return this.exclusive(owner, () => this.watchdog(owner, async () => this.readState(await this.get(owner))));
  }
  // Title and viewport only; keeps existing refs.
  info(owner) {
    // Bounded like every queued operation: Playwright's evaluate has no
    // timeout, and a hung page would otherwise hold the queue forever.
    return this.exclusive(owner, () => this.watchdog(owner, async () =>
      (await this.get(owner, { launch: false })).evaluate(
        "({ url: location.href, title: document.title, viewport: { width: innerWidth, height: innerHeight } })",
      ),
    Math.min(20000, this.watchdogMs)));
  }
  // launch=false: watching never opens a browser that the task did not use.
  // Watching without marks bypasses the queue so the panel stays live while
  // the agent works; it does not touch refs.
  async screenshot(owner, { marks = false, launch = true } = {}) {
    const capture = async () => {
      const driver = await this.get(owner, { launch });
      if (!marks) return { mimeType: "image/png", data: await driver.screenshot() };
      await driver.evaluate(MARKS_ON);
      try {
        return { mimeType: "image/png", data: await driver.screenshot() };
      } finally {
        await driver.evaluate(MARKS_OFF).catch(() => {});
      }
    };
    const guarded = () => this.watchdog(owner, capture, Math.min(20000, this.watchdogMs));
    return marks || launch ? this.exclusive(owner, guarded) : guarded();
  }
  async locate(driver, ref) {
    check(Number.isInteger(ref) && ref > 0, "BROWSER_REF", "请提供 browser_snapshot 返回的元素编号 ref");
    const point = await driver.evaluate(refExpression(ref, CENTER));
    check(!point?.missing, "BROWSER_REF", `元素 ${ref} 已不在页面上（页面可能已变化），请重新 browser_snapshot 获取最新编号`, 409);
    await new Promise((r) => setTimeout(r, 80));
    return point;
  }
  async act(owner, args) {
    check(BROWSER_ACTIONS.includes(args.action), "BROWSER_ACTION", `不支持的操作；可用：${BROWSER_ACTIONS.join(" / ")}`);
    return this.exclusive(owner, () => this.watchdog(owner, () => this.perform(owner, args)));
  }
  // A page that freezes its own renderer (e.g. an endless loop in a click
  // handler) must not lock the workspace's browser: give up, discard the
  // page and let the next call start a fresh one.
  async watchdog(owner, operation, ms = this.watchdogMs) {
    let timer;
    try {
      return await Promise.race([
        operation(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new AppError("BROWSER_HUNG", "网页长时间没有响应，已关闭该页面；请重新打开网页后再试", 504)), ms);
        }),
      ]);
    } catch (error) {
      if (error?.code === "BROWSER_HUNG") {
        const pending = this.pages.get(owner);
        this.pages.delete(owner);
        pending?.then((driver) => driver.close()).catch(() => {});
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  async perform(owner, args) {
    const driver = await this.get(owner);
    const result = { action: args.action };
    switch (args.action) {
      case "click":
      case "double_click":
      case "right_click":
      case "hover": {
        const point = await this.locate(driver, args.ref);
        if (args.action === "hover") await driver.move(point.x, point.y);
        else
          await driver.click(point.x, point.y, {
            button: args.action === "right_click" ? "right" : "left",
            clickCount: args.action === "double_click" ? 2 : 1,
          });
        break;
      }
      case "click_at": {
        check(Number.isFinite(args.x) && Number.isFinite(args.y), "BROWSER_INPUT", "click_at 需要视口坐标 x、y（CSS 像素）");
        await driver.click(Math.round(args.x), Math.round(args.y));
        break;
      }
      case "type": {
        check(typeof args.text === "string" && args.text.length <= 10000, "BROWSER_INPUT", "type 需要 text（最多 10000 字）");
        if (args.ref !== undefined) {
          const point = await this.locate(driver, args.ref);
          check(point.type !== "file", "BROWSER_INPUT", "文件上传框不能通过输入文字填写");
          await driver.click(point.x, point.y);
          if (args.clear !== false) await driver.evaluate(refExpression(args.ref, SELECT_ALL));
        }
        await driver.type(args.text);
        if (args.submit) await driver.press("Enter");
        break;
      }
      case "select": {
        check(args.value !== undefined, "BROWSER_INPUT", "select 需要 value（选项值或显示文字）");
        const outcome = await driver.evaluate(refExpression(args.ref, chooseOption(args.value)));
        check(!outcome?.missing, "BROWSER_REF", `元素 ${args.ref} 已不在页面上，请重新 browser_snapshot`, 409);
        check(!outcome?.error, "BROWSER_INPUT", outcome?.error);
        result.selected = outcome.selected;
        break;
      }
      case "press": {
        check(typeof args.key === "string" && /^[\w+\-\s]{1,40}$/.test(args.key), "BROWSER_INPUT", "press 需要按键，如 Enter、Escape、Tab、ArrowDown、Control+A");
        await driver.press(args.key.replace(/\s+/g, ""));
        break;
      }
      case "scroll": {
        const direction = args.direction || "down";
        check(["up", "down", "left", "right"].includes(direction), "BROWSER_INPUT", "scroll 的 direction 为 up/down/left/right");
        const view = await driver.evaluate("({ w: innerWidth, h: innerHeight })");
        const amount = Number.isFinite(args.amount) ? Math.min(Math.abs(args.amount), 20000) : Math.round(view.h * 0.8);
        const point = args.ref !== undefined ? await this.locate(driver, args.ref) : { x: Math.round(view.w / 2), y: Math.round(view.h / 2) };
        const dx = direction === "left" ? -amount : direction === "right" ? amount : 0;
        const dy = direction === "up" ? -amount : direction === "down" ? amount : 0;
        await driver.wheel(point.x, point.y, dx, dy);
        break;
      }
      case "back":
      case "forward":
      case "reload":
        await driver.history(args.action);
        break;
      case "wait":
        await new Promise((r) => setTimeout(r, Math.min(Math.max(Number(args.ms) || 1000, 100), 10000)));
        break;
    }
    await this.settle(driver);
    // Return the fresh page so the model can continue without another call.
    return { ...result, page: await this.readState(driver, 6000) };
  }
  async reveal(owner) {
    const driver = await this.get(owner, { launch: false });
    check(typeof driver.reveal === "function", "BROWSER_HEADLESS", "当前运行方式的浏览器在后台运行，无法显示窗口", 409);
    await driver.reveal();
    return { shown: true };
  }
  async forget(owner) {
    await this.close(owner);
    this.policies.delete(owner);
    this.used.delete(owner);
    await this.factory?.forget?.(owner);
  }
  async close(owner) {
    const entries = [...this.pages].filter(([id]) => !owner || id === owner);
    for (const [id, pending] of entries) {
      this.pages.delete(id);
      const driver = await pending.catch(() => null);
      await driver?.close().catch(() => {});
    }
  }
}
