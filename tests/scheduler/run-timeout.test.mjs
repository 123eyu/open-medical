import test from "node:test";
import assert from "node:assert/strict";
import { createScriptedProvider, textTurn } from "../helpers/scripted-provider.mjs";
import { startTestServer } from "../helpers/server.mjs";

test("运行超时：标记为失败并说明超时，而不是“已由你停止”", async (t) => {
  // The scripted turn outlasts the 1 s run deadline.
  const slow = ({ options }) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(textTurn("太晚了")), 5000);
      options.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(options.signal.reason);
      });
    });
  const provider = createScriptedProvider([slow]);
  const app = await startTestServer({ provider, seedDemoPack: false });
  t.after(() => app.close());

  const session = await app.request("/api/assistant/session", { method: "POST", body: {} });
  const workspaces = app.server.workspaces;
  const id = session.body.id;
  const handle = workspaces.prepare(id, {
    revision: workspaces.get(id).revision,
    message: "做一件很慢的事",
    externalConsent: true,
    limits: { timeoutMs: 1000 },
  });
  const result = await workspaces.execute(handle);
  assert.equal(result.status, "failed");
  assert.match(result.error, /超过本次时限/);
  assert.doesNotMatch(result.error, /由你停止/);
});
