// 示例患者包：一键装载（幂等）、固定标签可区分、到期随访进待办、
// 一键删除且级联清理、真实档案永不被触碰。
import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.mjs";

test("demo pack seeds, feeds the agenda and clears without touching real charts", async (t) => {
  const f = await fixture(t);
  // 一位真实患者先行存在：删除示例时必须原样保留。
  const real = (await f.json("/api/patients", "POST", { name: "真实患者" })).data;

  const before = (await f.json("/api/demo-pack")).data;
  assert.equal(before.installed, false);

  const seeded = (await f.json("/api/demo-pack", "POST")).data;
  assert.equal(seeded.installed, true);
  assert.equal(seeded.count, 3);
  // 幂等：重复装载不重复建档。
  assert.equal((await f.json("/api/demo-pack", "POST")).data.count, 3);

  const list = (await f.json("/api/patients?summary=1")).data.patients;
  const demos = list.filter(p => (p.tags || []).includes("示例患者"));
  assert.equal(demos.length, 3);
  assert.ok(list.some(p => p.name === "真实患者"));

  // 到期随访已拨到两天前：今日待办里能看到示例患者。
  const agenda = (await f.json("/api/doctor/overview")).data;
  assert.ok(agenda.counts.followup >= 1, "示例到期随访进入待办");

  const cleared = (await f.json("/api/demo-pack", "DELETE")).data;
  assert.equal(cleared.installed, false);
  assert.equal(cleared.removed, 3);
  const after = (await f.json("/api/patients?summary=1")).data.patients;
  assert.ok(after.some(p => p.name === "真实患者"), "真实患者保留");
  assert.equal(after.filter(p => (p.tags || []).includes("示例患者")).length, 0);
  assert.equal((await f.json("/api/doctor/overview")).data.counts.followup, 0);
  assert.equal((await f.json("/api/demo-pack", "DELETE")).status, 404, "无示例可删时报 404");
});
