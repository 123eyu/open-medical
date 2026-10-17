import test from "node:test";
import assert from "node:assert/strict";
import { AgentRuntime } from "../server/core/agent-runtime.mjs";
import { ToolRegistry } from "../server/core/tool-registry.mjs";
import { PermissionEngine } from "../server/core/permissions.mjs";

const permissions = new PermissionEngine({ profile: "standard" });
const schema = (name) => ({
  type: "function",
  function: { name, description: name, parameters: { type: "object", properties: { n: { type: "integer" } }, required: ["n"], additionalProperties: false } },
});
const call = (id, name, n) => ({ id, type: "function", function: { name, arguments: JSON.stringify({ n }) } });

function setup(batch) {
  const log = [];
  let active = 0,
    peak = 0;
  const slow = (label) => async ({ n }) => {
    active++;
    peak = Math.max(peak, active);
    log.push(`start:${label}${n}`);
    await new Promise((r) => setTimeout(r, 40));
    active--;
    log.push(`end:${label}${n}`);
    return { n };
  };
  const registry = new ToolRegistry([
    { definition: schema("read"), parallel: true, execute: slow("r") },
    { definition: schema("write"), execute: slow("w") },
  ]);
  let round = 0;
  const provider = {
    model: "test",
    async complete() {
      round++;
      return round === 1
        ? { message: { role: "assistant", content: null, tool_calls: batch } }
        : { message: { role: "assistant", content: "done" } };
    },
  };
  return { registry, provider, log, peak: () => peak };
}

test("leading parallel-safe reads in one batch run concurrently and results keep call order", async () => {
  const f = setup([call("a", "read", 1), call("b", "read", 2), call("c", "read", 3)]);
  const result = await new AgentRuntime({ provider: f.provider, maxRounds: 3 }).run({
    messages: [{ role: "user", content: "go" }],
    registry: f.registry,
    permissions,
  });
  assert.equal(f.peak(), 3);
  assert.deepEqual(
    result.messages.filter((m) => m.role === "tool").map((m) => m.tool_call_id),
    ["a", "b", "c"],
  );
});

test("reads after a side-effect tool wait for it instead of reading stale state", async () => {
  const f = setup([call("a", "read", 1), call("b", "write", 2), call("c", "read", 3)]);
  await new AgentRuntime({ provider: f.provider, maxRounds: 3 }).run({
    messages: [{ role: "user", content: "go" }],
    registry: f.registry,
    permissions,
  });
  assert.equal(f.peak(), 1);
  assert.ok(f.log.indexOf("end:w2") < f.log.indexOf("start:r3"));
});
