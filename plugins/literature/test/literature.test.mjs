import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createScriptedProvider } from "../../../tests/helpers/scripted-provider.mjs";
import { startTestServer } from "../../../tests/helpers/server.mjs";

const snapshot = JSON.parse(
  readFileSync(
    new URL("./fixtures/routes.snapshot.json", import.meta.url),
    "utf8",
  ),
);

const fakeLiterature = {
  async search({ query, source = "pubmed" }) {
    return {
      source,
      requestedSource: source,
      query,
      count: 1,
      articles: [
        {
          pmid: "12345678",
          doi: "10.1000/demo",
          title: "Hypertension management in primary care",
          journal: "Demo Journal",
          year: 2024,
          authors: ["Demo A"],
          authorCount: 1,
          pubTypes: ["Review"],
          hints: ["综述"],
        },
      ],
      note: "fixture",
    };
  },
  async fetchArticle({ pmid, doi }) {
    return {
      pmid: pmid || null,
      doi: doi || null,
      title: "Hypertension management in primary care",
      journal: "Demo Journal",
      year: 2024,
      authors: ["Demo A"],
      abstract: "Demo abstract.",
      meshTerms: ["Hypertension"],
      pubTypes: ["Review"],
      hints: ["综述"],
      note: "fixture",
    };
  },
  materialText(article) {
    return `# ${article.title}\n`;
  },
};

const start = (options = {}) =>
  startTestServer({
    provider: createScriptedProvider([]),
    seedDemoPack: false,
    serverOptions: { literature: fakeLiterature, ...options },
  });

test("literature：旧接口路径与响应在迁移后保持一致", async (t) => {
  const app = await start();
  t.after(() => app.close());
  for (const [path, expected] of Object.entries(snapshot)) {
    const response = await app.request(path);
    assert.equal(response.status, expected.status, path);
    assert.deepEqual(response.body, expected.body, path);
  }
});

test("literature：导入接口仍把摘要保存为会话材料", async (t) => {
  const app = await start();
  t.after(() => app.close());
  const session = await app.request("/api/sessions", {
    method: "POST",
    body: { title: "文献导入测试" },
  });
  assert.equal(session.status, 201);
  const imported = await app.request("/api/literature/import", {
    method: "POST",
    body: { sessionId: session.body.id, pmid: "12345678" },
  });
  assert.equal(imported.status, 201);
  const detail = await app.request(`/api/sessions/${session.body.id}`);
  assert.equal(detail.status, 200);
  assert.ok(
    detail.body.files.some((file) => file.name === "PMID-12345678.md"),
    "导入的文献应保存为会话材料",
  );
});

test("literature：停用后接口 404、工具不注册，数据仍在", async (t) => {
  const app = await start();
  t.after(() => app.close());
  assert.ok(
    app.server.pluginHost
      .legacyToolPlugins()
      .some((tool) => tool.definition.function.name === "literature_search"),
  );
  const disabled = await app.request("/api/plugins/literature", {
    method: "PUT",
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.plugin.enabled, false);
  const route = await app.request(
    "/api/literature/search?query=hypertension&source=pubmed&limit=2",
  );
  assert.equal(route.status, 404);
  const tools = app.server.pluginHost
    .legacyToolPlugins()
    .map((tool) => tool.definition.function.name);
  assert.ok(!tools.includes("literature_search"));
  assert.ok(!tools.includes("literature_fetch"));
  const list = await app.request("/api/plugins");
  assert.equal(
    list.body.plugins.find((plugin) => plugin.id === "literature").enabled,
    false,
  );
});
