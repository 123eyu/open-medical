import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createScriptedProvider } from "../../../tests/helpers/scripted-provider.mjs";
import { startTestServer, waitFor } from "../../../tests/helpers/server.mjs";

const SNAPSHOT = JSON.parse(
  readFileSync(new URL("./fixtures/wechat-api.snapshot.json", import.meta.url), "utf8"),
);

const start = (serverOptions = {}) =>
  startTestServer({
    provider: createScriptedProvider([]),
    seedDemoPack: false,
    serverOptions,
  });

test("/api/wechat/* 与 /api/wechat-exp/* 迁移前后响应形状一致", async (t) => {
  const app = await start();
  t.after(() => app.close());
  await waitFor(() => app.server.channelWechat.started, {
    description: "channel-wechat 启动",
  });

  const dataRoot = app.tempRoot;
  for (const [route, expected] of Object.entries(SNAPSHOT)) {
    const [method, path] = route.includes(" ")
      ? route.split(" ")
      : ["GET", route];
    const response = await app.request(path, {
      method,
      ...(method === "POST" ? { body: {} } : {}),
    });
    assert.equal(response.status, expected.status, route);
    const normalized = JSON.parse(
      JSON.stringify(expected.body),
    );
    const actual = JSON.parse(
      JSON.stringify(response.body).split(dataRoot).join("<dataDir>"),
    );
    assert.deepEqual(actual, normalized, route);
  }
});
