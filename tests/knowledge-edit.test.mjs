import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.mjs";

test("assistant edits only the selected library and revision, preserving the rest of the document and rebuilding search", async (t) => {
  const f = await fixture(t);
  const lib = f.server.guidelines;
  lib.embedder = null;
  const doc = await lib.addDocument({
    title: "合成资料",
    collection: "编辑测试",
    text: "保留第一段。\n待改正的错字。\n保留末段。",
  });
  const update = f.server.runtime.toolPlugins.get("knowledge_document_update");
  const scope = { docId: doc.id, collection: "编辑测试", expectedRevision: 0 };
  await assert.rejects(
    update.execute({
      ...scope,
      collection: "另一库",
      metadata: { title: "越界" },
    }),
    { code: "KNOWLEDGE_SCOPE_MISMATCH" },
  );
  await assert.rejects(
    update.execute({ ...scope, oldText: "不存在的段落", newText: "不应保存" }),
    { code: "KNOWLEDGE_TEXT_CONFLICT" },
  );
  await assert.rejects(
    update.execute({ ...scope, metadata: { reviewStatus: "reviewed" } }),
    { code: "INVALID_INPUT" },
  );
  const renamed = await update.execute({
    ...scope,
    metadata: { title: "更正后的标题", edition: "2026" },
  });
  assert.equal(renamed.revision, 1);
  assert.equal(
    lib.get(doc.id).text,
    "保留第一段。\n待改正的错字。\n保留末段。",
  );
  await assert.rejects(
    update.execute({ ...scope, metadata: { title: "过期覆盖" } }),
    { code: "REVISION_CONFLICT" },
  );
  const edited = await update.execute({
    ...scope,
    expectedRevision: 1,
    oldText: "待改正的错字。",
    newText: "已更正的文字。",
  });
  assert.equal(edited.saved, true);
  assert.equal(edited.revision, 2);
  assert.notEqual(edited.sha256, doc.sha256);
  assert.equal(
    lib.get(doc.id).text,
    "保留第一段。\n已更正的文字。\n保留末段。",
  );
  assert.equal(lib.get(doc.id).reviewStatus, "unreviewed");
  assert.equal(edited.indexing.status, "keyword_only");
  assert.equal(
    (
      await lib.search({
        query: "已更正",
        collection: "编辑测试",
        localOnly: true,
      })
    ).count,
    1,
  );
  assert.equal(
    (
      await lib.search({
        query: "错字",
        collection: "编辑测试",
        localOnly: true,
      })
    ).count,
    0,
  );
  await assert.rejects(
    update.execute({
      ...scope,
      expectedRevision: 2,
      oldText: "保留",
      newText: "重复匹配",
    }),
    { code: "KNOWLEDGE_TEXT_CONFLICT" },
  );
});

test("chat exposes and executes document editing through the unified assistant", async (t) => {
  let step = 0,
    docId,
    result;
  const f = await fixture(t, {
    provider: {
      apiKey: "synthetic",
      model: "synthetic",
      async complete(messages, definitions) {
        assert.ok(
          definitions.some(
            (d) => d.function.name === "knowledge_document_update",
          ),
        );
        if (step++ === 0)
          return {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "edit-call",
                  type: "function",
                  function: {
                    name: "knowledge_document_update",
                    arguments: JSON.stringify({
                      docId,
                      collection: "对话修改",
                      expectedRevision: 0,
                      metadata: { title: "对话修改后的标题" },
                    }),
                  },
                },
              ],
            },
          };
        result = JSON.parse(
          messages.filter((m) => m.role === "tool").at(-1).content,
        );
        return { message: { role: "assistant", content: "标题已修改。" } };
      },
    },
  });
  f.server.guidelines.embedder = null;
  docId = (
    await f.server.guidelines.addDocument({
      title: "原标题",
      collection: "对话修改",
      text: "合成测试正文。",
    })
  ).id;
  const session = await f.session("修改资料");
  const response = await f.chat(
    session.id,
    "把对话修改库中原标题改为对话修改后的标题",
    { mode: "model", externalConsent: true },
  );
  assert.equal(response.status, 200);
  assert.equal(result.saved, true);
  assert.equal(f.server.guidelines.get(docId).title, "对话修改后的标题");
});
