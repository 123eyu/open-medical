import test from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_SCENARIOS,
  demoScenarioCopy,
  demoScenarioDetail,
  demoScenarioVisible,
} from "../../shared/demo-experience.mjs";

const byId = (id) => DEMO_SCENARIOS.find((scenario) => scenario.id === id);

test("随访插件停用：隐藏随访与患者消息示例卡片，其他 tab 场景不受影响", () => {
  assert.equal(demoScenarioVisible(byId("followup"), false), false);
  assert.equal(demoScenarioVisible(byId("messages"), false), false);
  assert.deepEqual(
    DEMO_SCENARIOS.filter((scenario) => !demoScenarioVisible(scenario, false)).map(
      (scenario) => scenario.id,
    ),
    ["followup", "messages"],
  );
  for (const id of ["chart", "education", "tracking", "knowledge", "cases", "customize"]) {
    assert.equal(demoScenarioVisible(byId(id), false), true, id);
  }
});

test("未连接患者渠道：随访示例保留，患者消息示例隐藏，说明不提问卷", () => {
  assert.equal(demoScenarioVisible(byId("followup"), true, false), true);
  assert.equal(demoScenarioVisible(byId("messages"), true, false), false);
  assert.doesNotMatch(demoScenarioDetail(byId("followup"), true, false), /问卷/);
  assert.match(demoScenarioDetail(byId("agenda"), true, false), /逾期随访提醒/);
  const copy = demoScenarioCopy(byId("followup"), true, false);
  assert.doesNotMatch(`${copy.title} ${copy.detail} ${copy.next}`, /问卷/);
  assert.deepEqual(demoScenarioCopy(byId("followup"), true, true), { detail: byId("followup").detail });
});

test("今日待办示例说明：随访停用时不声称包含逾期随访；已连接时保留原文", () => {
  const agenda = byId("agenda");
  assert.equal(
    demoScenarioDetail(agenda, false),
    "查看由示例复诊和提醒汇总的工作清单。",
  );
  assert.equal(demoScenarioDetail(agenda, true), agenda.detail);
  assert.match(demoScenarioDetail(agenda, true), /逾期随访/);
});

test("已连接患者渠道：患者消息与随访示例卡片恢复", () => {
  assert.equal(demoScenarioVisible(byId("followup"), true), true);
  assert.equal(demoScenarioVisible(byId("messages"), true), true);
  assert.equal(demoScenarioVisible(byId("messages"), true, true), true);
});
