import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createScriptedProvider } from "../../../tests/helpers/scripted-provider.mjs";
import { startTestServer } from "../../../tests/helpers/server.mjs";
import { ResearchService, binaryPositive } from "../server/research.mjs";

const snapshot = JSON.parse(
  readFileSync(
    new URL("./fixtures/routes.snapshot.json", import.meta.url),
    "utf8",
  ),
);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const normalize = (value) =>
  typeof value === "string"
    ? value.replace(UUID, "<uuid>").replace(/SUBJ_[0-9a-f]{16}/g, "SUBJ_<code>")
    : Array.isArray(value)
      ? value.map(normalize)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]))
        : value;

async function dataset(app) {
  const status = await app.request("/api/demo-pack");
  assert.equal(status.status, 200);
  const detail = await app.request(`/api/sessions/${status.body.sessionId}`);
  assert.equal(detail.status, 200);
  const file = detail.body.files.find((item) => item.name === "示例研究数据.csv");
  assert.ok(file, "示例研究数据.csv 应存在");
  return { sessionId: status.body.sessionId, sourceId: file.id };
}

test("research-stats：旧统计接口迁移前后响应一致", async (t) => {
  const app = await startTestServer({ provider: createScriptedProvider([]) });
  t.after(() => app.close());
  const { sessionId, sourceId } = await dataset(app);
  const calls = {
    profile: { sessionId, sourceId },
    test: {
      sessionId,
      sourceId,
      outcome: "sbp",
      group: "group",
      method: "auto",
    },
    "sample-size": {
      design: "means",
      alpha: 0.05,
      power: 0.8,
      delta: 8,
      sd: 12,
    },
    deidentify: { sessionId, sourceId, columns: ["subject"] },
  };
  for (const [name, expected] of Object.entries(snapshot)) {
    const response = await app.request(`/api/research/${name}`, {
      method: "POST",
      body: calls[name],
    });
    assert.equal(response.status, expected.status, name);
    assert.deepEqual(normalize(response.body), normalize(expected.body), name);
  }
});

test("research-stats：停用后接口 404、插件工具不注册，固定区 cohort_profile 保留", async (t) => {
  const app = await startTestServer({ provider: createScriptedProvider([]) });
  t.after(() => app.close());
  const before = app.server.sessionBridge.toolNames();
  assert.ok(before.includes("stats_test"));
  assert.ok(before.includes("sample_size"));
  assert.ok(before.includes("deidentify_csv"));
  assert.ok(
    app.server.sessionBridge.toolNames().includes("cohort_profile"),
    "cohort_profile 是固定区全局助手能力，不能被插件带走",
  );

  const disabled = await app.request("/api/plugins/research-stats", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.plugin.enabled, false);
  const route = await app.request("/api/research/profile", {
    method: "POST",
    body: { sessionId: "missing", sourceId: "missing" },
  });
  assert.equal(route.status, 404);
  const after = app.server.sessionBridge.toolNames();
  assert.ok(!after.includes("stats_test"));
  assert.ok(!after.includes("sample_size"));
  assert.ok(!after.includes("deidentify_csv"));
  assert.ok(
    app.server.sessionBridge.toolNames().includes("cohort_profile"),
  );
});

const csvSource = (text) => [{ id: "src", name: "data.csv", text }];
const BINARY_CSV = [
  "group,outcome,sbp",
  ...["A,yes,130", "A,yes,132", "A,no,128", "A,yes,135", "B,no,150", "B,no,148", "B,yes,152", "B,no,149"],
].join("\n");

test("research-stats：yes/no、阳性/阴性等二分类结局自动选卡方并正确计数", () => {
  const research = new ResearchService();
  const result = research.test({ sources: csvSource(BINARY_CSV), sourceId: "src", outcome: "outcome", group: "group" });
  assert.equal(result.method, "chi-square");
  assert.equal(result.positive, "yes");
  assert.equal(typeof result.p, "number");
  const fisher = research.test({ sources: csvSource(BINARY_CSV), sourceId: "src", outcome: "outcome", group: "group", method: "fisher" });
  assert.deepEqual(fisher.table, [[3, 1], [1, 3]]);
  assert.equal(binaryPositive(["阴性", "阳性"]), "阳性");
  assert.equal(binaryPositive(["N", "Y"]), "Y");
  assert.equal(binaryPositive(["好转", "未好转"]), null);
  assert.equal(binaryPositive(["好转", "未好转"], "好转"), "好转");
});

test("research-stats：可指定阳性取值；非二分类结局拒绝卡方/Fisher", () => {
  const research = new ResearchService();
  const text = "group,result\nA,好转\nA,好转\nA,未好转\nB,未好转\nB,未好转\nB,好转";
  const sources = csvSource(text);
  assert.throws(
    () => research.test({ sources, sourceId: "src", outcome: "result", group: "group", method: "chi-square" }),
    (error) => error.code === "INVALID_INPUT" && /指定阳性取值/.test(error.message),
  );
  assert.throws(
    () => research.test({ sources, sourceId: "src", outcome: "result", group: "group" }),
    (error) => error.code === "INVALID_INPUT" && /指定阳性取值/.test(error.message),
  );
  const chosen = research.test({ sources, sourceId: "src", outcome: "result", group: "group", method: "fisher", positive: "好转" });
  assert.deepEqual(chosen.table, [[2, 1], [1, 2]]);
  for (const method of ["chi-square", "fisher"])
    assert.throws(
      () => research.test({ sources: csvSource(BINARY_CSV), sourceId: "src", outcome: "sbp", group: "group", method }),
      (error) => error.code === "INVALID_INPUT" && /恰好有 2 个取值/.test(error.message),
    );
});

test("research-stats：脱敏使用每次导出的随机密钥，同次一致，并正确转义 CSV", () => {
  const research = new ResearchService();
  const text = 'name,addr,sbp\n张三,"北京市,朝阳区",140\n李四,"说""你好""",150\n张三,上海,145\n,无名,120';
  const sources = csvSource(text);
  const first = research.deidentify({ sources, sourceId: "src", columns: ["name"] });
  const second = research.deidentify({ sources, sourceId: "src", columns: ["name"] });
  const rows = (csv) => csv.split("\n");
  const [head, a, b, c, d] = rows(first.csv);
  assert.equal(head, "name_deid,addr,sbp");
  const code = a.split(",")[0];
  assert.match(code, /^NAME_[0-9a-f]{16}$/);
  assert.ok(a.endsWith(',"北京市,朝阳区",140'));
  assert.ok(b.endsWith(',"说""你好""",150'));
  assert.equal(c.split(",")[0], code, "同一次导出内同一原始值编码一致");
  assert.equal(d, ",无名,120", "空值保持为空");
  assert.notEqual(rows(second.csv)[1].split(",")[0], code, "不同导出使用不同密钥");
  // 导出的 CSV 能被同一解析器还原为相同的列结构。
  const roundTrip = research.profile({ sources: csvSource(first.csv), sourceId: "src" });
  assert.deepEqual(Object.keys(roundTrip.columns), ["name_deid", "addr", "sbp"]);
});

test("research-stats：脱敏导出不会被表格软件当成公式执行，负数保持为数字", () => {
  const research = new ResearchService();
  const text = 'name,note,delta\n张三,=HYPERLINK("http://x"),-3.5\n李四,@SUM(A1),+2\n王五,-cmd,1e3';
  const { csv } = research.deidentify({ sources: csvSource(text), sourceId: "src", columns: ["name"] });
  const [, a, b, c] = csv.split("\n");
  assert.ok(a.includes(",'=HYPERLINK(http://x),"), a);
  assert.ok(a.endsWith(",-3.5"), a);
  assert.ok(b.includes(",'@SUM(A1),+2"), b);
  assert.ok(c.endsWith(",'-cmd,1e3"), c);
});
