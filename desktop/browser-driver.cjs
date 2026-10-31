const { app, BrowserWindow, session } = require("electron");

// One Chromium window per workspace, driven through the DevTools protocol so
// clicks and key presses are real input events (like Playwright / browser-use).
// The partition persists per workspace, so a login done once stays signed in.
// No renderer gets Node or IPC. Which requests may load is decided by the
// server (`allows`): any web page, workspace files, never the app's own API.

const MODIFIERS = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Command: 4, Cmd: 4, Shift: 8 };
const KEYS = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Tab: { code: "Tab", keyCode: 9 },
  Escape: { code: "Escape", keyCode: 27 },
  Backspace: { code: "Backspace", keyCode: 8 },
  Delete: { code: "Delete", keyCode: 46 },
  Space: { code: "Space", keyCode: 32, key: " ", text: " " },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 },
  PageUp: { code: "PageUp", keyCode: 33 },
  PageDown: { code: "PageDown", keyCode: 34 },
};
// Chromium only performs editing shortcuts when the command is named
// (Playwright does the same).
const EDIT_COMMANDS = { a: "selectAll", c: "copy", v: "paste", x: "cut", z: "undo", y: "redo" };

const agentWindows = new Set();
const guarded = new WeakSet(); // partitions with a download guard
let quitting = false;
app.on("before-quit", () => {
  quitting = true;
});
// Hidden agent windows must not keep the app alive once the user's own
// windows are gone (Windows/Linux quit on window-all-closed).
app.on("browser-window-created", (_event, created) => {
  created.once("closed", () => {
    setImmediate(() => {
      const open = BrowserWindow.getAllWindows();
      if (open.length && open.every((w) => agentWindows.has(w))) app.emit("window-all-closed");
    });
  });
});

function keyInfo(name) {
  if (KEYS[name]) return { key: KEYS[name].key || name, ...KEYS[name] };
  if (/^F([1-9]|1[0-2])$/.test(name)) return { key: name, code: name, keyCode: 111 + Number(name.slice(1)) };
  if (name.length === 1) {
    const upper = name.toUpperCase();
    const code = /[A-Z]/.test(upper) ? `Key${upper}` : /[0-9]/.test(name) ? `Digit${name}` : "";
    return { key: name, code, keyCode: upper.charCodeAt(0), text: name };
  }
  throw new Error(`不支持的按键：${name}`);
}

const partitionName = (owner) => `persist:agent-browser-${String(owner).replace(/[^\w-]/g, "")}`;

module.exports = async function browserFactory(owner, { allows, tagged, header }) {
  const partition = session.fromPartition(partitionName(owner));
  partition.setPermissionRequestHandler((_w, _p, callback) => callback(false));
  partition.setPermissionCheckHandler(() => false);
  partition.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allows(details.url) }));
  partition.webRequest.onBeforeSendHeaders((details, callback) =>
    callback({ requestHeaders: tagged(details.url) ? { ...details.requestHeaders, [header]: "1" } : details.requestHeaders }),
  );
  if (!guarded.has(partition)) {
    guarded.add(partition);
    partition.on("will-download", (event) => event.preventDefault());
  }
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    title: "Open Medical 助手浏览器",
    webPreferences: {
      session: partition,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      disableDialogs: true,
      backgroundThrottling: false,
    },
  });
  agentWindows.add(window);
  const contents = window.webContents;
  const driver = { dead: false };
  // Closing the shown window only hides it; the agent keeps its page.
  window.on("close", (event) => {
    if (!driver.closing && !quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("closed", () => {
    driver.dead = true;
    agentWindows.delete(window);
  });
  contents.on("render-process-gone", () => {
    driver.dead = true;
  });
  // Popups (target=_blank, window.open) continue in the same window.
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && allows(url)) setImmediate(() => contents.loadURL(url).catch(() => {}));
    return { action: "deny" };
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on("will-navigate", (event, url) => {
    if (!allows(url)) event.preventDefault();
  });
  contents.on("will-redirect", (event, url) => {
    if (!allows(url)) event.preventDefault();
  });
  const cdp = contents.debugger;
  cdp.attach("1.3");
  const send = (method, params) => cdp.sendCommand(method, params);
  // Input events wait for the renderer; a frozen page must not block forever.
  const input = (method, params) => bounded(send(method, params), 10000);
  const bounded = async (operation, ms, onTimeout) => {
    let timer;
    try {
      return await Promise.race([
        operation,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            onTimeout?.();
            reject(new Error("浏览器操作超时"));
          }, ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  // Resolve once the document is usable (DOM ready), not after every image
  // and ad has finished; a failed main-frame load rejects.
  const loaded = (start, ms = 30000, READY = ["dom-ready"]) =>
    bounded(
      new Promise((resolve, reject) => {
        const stop = () => {
          for (const name of READY) contents.off(name, done);
          contents.off("did-fail-load", failed);
        };
        const done = () => {
          stop();
          resolve();
        };
        const failed = (_e, code, description, _url, isMainFrame) => {
          if (!isMainFrame || code === -3) return; // -3: replaced by a newer navigation
          stop();
          reject(new Error(`${description} (${code})`));
        };
        for (const name of READY) contents.on(name, done);
        contents.on("did-fail-load", failed);
        Promise.resolve()
          .then(start)
          .catch(() => {});
      }),
      ms,
      () => contents.stop(),
    );
  // In-page and back/forward-cache history steps never fire dom-ready.
  const HISTORY_READY = ["dom-ready", "did-navigate-in-page", "did-stop-loading"];
  const mouse = (type, x, y, extra = {}) => input("Input.dispatchMouseEvent", { type, x, y, ...extra });
  Object.assign(driver, {
    navigate: async (url) => {
      if (!allows(url)) throw new Error("该网址无法在助手浏览器中打开");
      await loaded(() => contents.loadURL(url));
    },
    history: async (direction) => {
      const history = contents.navigationHistory;
      if (direction === "reload") await loaded(() => contents.reload(), 15000, HISTORY_READY).catch(() => {});
      else if (direction === "back" && history.canGoBack()) await loaded(() => history.goBack(), 15000, HISTORY_READY).catch(() => {});
      else if (direction === "forward" && history.canGoForward()) await loaded(() => history.goForward(), 15000, HISTORY_READY).catch(() => {});
    },
    // Through CDP: executeJavaScript would wait for every image and ad to
    // finish loading. A slow script must not abort a navigation either.
    evaluate: async (expression) => {
      const { result, exceptionDetails } = await bounded(
        send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }),
        15000,
      );
      if (exceptionDetails)
        throw new Error(exceptionDetails.exception?.description?.split("\n")[0] || exceptionDetails.text || "页面脚本执行失败");
      return result?.value;
    },
    click: async (x, y, { button = "left", clickCount = 1 } = {}) => {
      await mouse("mouseMoved", x, y);
      for (let i = 1; i <= clickCount; i++) {
        await mouse("mousePressed", x, y, { button, clickCount: i });
        await mouse("mouseReleased", x, y, { button, clickCount: i });
      }
    },
    move: (x, y) => mouse("mouseMoved", x, y),
    wheel: (x, y, deltaX, deltaY) => mouse("mouseWheel", x, y, { deltaX, deltaY }),
    type: (text) => input("Input.insertText", { text }),
    press: async (combo) => {
      const parts = combo.split("+").filter(Boolean);
      const name = parts.pop();
      const modifiers = parts.reduce((bits, m) => bits | (MODIFIERS[m] || 0), 0);
      const info = keyInfo(name);
      // Shift+letter produces the capital letter, as on a real keyboard.
      if (modifiers & MODIFIERS.Shift && /^[a-z]$/.test(name)) info.key = info.text = name.toUpperCase();
      const base = { key: info.key, code: info.code, windowsVirtualKeyCode: info.keyCode, modifiers };
      const shortcut = modifiers & (MODIFIERS.Control | MODIFIERS.Meta);
      const command = shortcut ? EDIT_COMMANDS[name.toLowerCase()] : undefined;
      const commands = command ? [modifiers & MODIFIERS.Shift && command === "undo" ? "redo" : command] : undefined;
      // Text-producing keys use keyDown so Enter submits forms and characters insert.
      const text = modifiers & ~MODIFIERS.Shift ? undefined : info.text;
      await input("Input.dispatchKeyEvent", {
        type: text ? "keyDown" : "rawKeyDown",
        ...base,
        ...(text ? { text } : {}),
        ...(commands ? { commands } : {}),
      });
      await input("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    },
    screenshot: async () => (await bounded(contents.capturePage(), 15000)).toPNG().toString("base64"),
    // Let the user take over (log in, solve a captcha), then hand back.
    reveal: async () => {
      window.show();
      window.focus();
    },
    close: async () => {
      if (window.isDestroyed()) return;
      try {
        cdp.detach();
      } catch {
        // Already detached.
      }
      driver.closing = true;
      window.destroy();
    },
  });
  return driver;
};

// Deleting a workspace also signs its browser out (cookies, storage, cache).
module.exports.forget = async (owner) => {
  await session.fromPartition(partitionName(owner)).clearStorageData();
};
