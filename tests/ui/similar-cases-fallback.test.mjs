import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { createElement } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { createServer as createViteServer } from "vite";

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
      onError() {},
    });
    output.once("finish", () => finish());
    output.once("error", finish);
  });
}

test("没有 similar-cases 插件时 similar_cases artifact 走通用 fallback", async (t) => {
  const vite = await createViteServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  t.after(() => vite.close());
  const slots = await vite.ssrLoadModule("/src/plugin-slots.jsx");

  slots.registerUiPlugins({}, []);
  const html = await renderAsync(
    createElement(slots.ResultCard, {
      artifact: { id: "case-1", type: "similar_cases", title: "相似病例检索结果" },
      fallback: () =>
        createElement("p", { className: "generic-artifact" }, "通用结果展示"),
    }),
  );

  assert.match(html, /通用结果展示/);
  assert.doesNotMatch(html, /插件组件出错/);
});
