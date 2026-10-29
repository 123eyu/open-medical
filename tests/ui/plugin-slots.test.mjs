import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { createElement } from "react";
import { renderToPipeableStream, renderToString } from "react-dom/server";
import { createServer as createViteServer } from "vite";

// React.lazy suspends on the first pass even when the loader resolves
// immediately, so a plain renderToString would only capture the fallback.
// renderToPipeableStream + onAllReady waits for all Suspense boundaries without
// needing a browser.
function renderAsync(element) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const output = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    const timer = setTimeout(() => reject(new Error("SSR render timed out")), 5000);
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const stream = renderToPipeableStream(element, {
      onAllReady() {
        stream.pipe(output);
      },
      onShellError: finish,
      // A component error is handled by PluginErrorBoundary; keep rendering the
      // boundary fallback instead of rejecting the whole tree.
      onError() {},
    });
    output.once("finish", () => finish());
    output.once("error", finish);
  });
}

async function loadSlots() {
  const vite = await createViteServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  return { vite, slots: await vite.ssrLoadModule("/src/plugin-slots.jsx") };
}

function pluginModule(slots, id, component) {
  return {
    default: slots.defineUiPlugin({
      id,
      slots: {
        "settings.panels": [
          {
            id: "panel",
            label: "Panel",
            component: () => Promise.resolve({ default: component }),
          },
        ],
      },
    }),
  };
}

test("Slot 渲染 lazy 包装的同步插件组件", async (t) => {
  const { vite, slots } = await loadSlots();
  t.after(() => vite.close());

  const Greeting = () => createElement("span", null, "同步组件已渲染");
  slots.registerUiPlugins(
    { "./greeting/ui/index.jsx": pluginModule(slots, "greeting", Greeting) },
    ["greeting"],
  );

  const html = await renderAsync(
    createElement(slots.Slot, { name: "settings.panels" }),
  );
  assert.match(html, /同步组件已渲染/);
});

test("插件组件抛错时只渲染一条错误提示", async (t) => {
  const { vite, slots } = await loadSlots();
  t.after(() => vite.close());

  const Broken = () => {
    throw new Error("boom");
  };
  let thrown;
  try {
    Broken();
  } catch (error) {
    thrown = error;
  }

  // React 19 SSR deliberately does not invoke error boundaries for component
  // errors (they are replayed on the client), so drive the same boundary state
  // transition directly. This stays browser-free while asserting that only the
  // small error notice is produced.
  const boundary = new slots.PluginErrorBoundary({
    children: createElement("span", null, "不应渲染的插件内容"),
  });
  boundary.state = slots.PluginErrorBoundary.getDerivedStateFromError(thrown);
  const html = renderToString(boundary.render());
  assert.match(html, /插件组件出错/);
  assert.match(html, /boom/);
  assert.doesNotMatch(html, /不应渲染的插件内容/);
});
