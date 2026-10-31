import test from "node:test";
import assert from "node:assert/strict";
import { JevSettings } from "../../server/core/jev-settings.mjs";

const vault = () => {
  const data = new Map();
  return { get: (key) => data.get(key) || {}, set: (key, value) => data.set(key, value) };
};
const reply = () => ({
  ok: true,
  json: async () => ({ model: "jev-latest", answers: { task: { choice: "document", confidence: 0.9 } } }),
});

// Mirrors the settings form: it sends the whole public view back, with a
// write-only apiKey that is empty unless the doctor typed a new key.
test("Jev：填写密钥后可测试、启用；留空保存沿用已存密钥；断开后清除", async () => {
  const seen = [];
  const jev = new JevSettings(vault(), async (url, init) => {
    seen.push(init.headers.authorization);
    return reply();
  });
  const form = { ...jev.public(), apiKey: "" };
  await assert.rejects(jev.test(form), /API Key/);
  assert.equal((await jev.test({ ...form, apiKey: "sk-typed" })).status, "observed");
  assert.equal(jev.public().hasKey, false, "测试不保存密钥");
  const saved = jev.save({ ...form, apiKey: "sk-typed" });
  assert.equal(saved.hasKey, true);
  assert.equal("apiKey" in saved, false);
  const enabled = jev.save({ ...saved, apiKey: "", enabled: true, consent: true });
  assert.equal(enabled.enabled, true);
  assert.equal((await jev.test({ ...enabled, apiKey: "" })).status, "observed");
  assert.deepEqual(seen, ["Bearer sk-typed", "Bearer sk-typed"]);
  const cleared = jev.save({ ...enabled, apiKey: "", clearKey: true, enabled: false });
  assert.equal(cleared.hasKey, false);
});
