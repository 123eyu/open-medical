import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import JSZip from "jszip";
import { WorkspaceService } from "../../server/core/workspace-service.mjs";
import { hashText } from "../../server/core/workspace-files.mjs";

const provider = { name: "test", complete: async () => ({ text: "" }) };

function setup(t) {
  const base = mkdtempSync(join(tmpdir(), "omw-project-files-"));
  const root = join(base, "project");
  mkdirSync(root);
  const db = new DatabaseSync(join(base, "agent.sqlite"));
  const service = new WorkspaceService(db, provider);
  t.after(() => {
    db.close();
    rmSync(base, { recursive: true, force: true });
  });
  const workspace = service.create({ title: "资料", root, directoryConsent: true });
  return { service, root, id: workspace.id };
}

async function makePptx(slides) {
  const zip = new JSZip();
  slides.forEach((text, index) =>
    zip.file(
      `ppt/slides/slide${index + 1}.xml`,
      `<p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree><p:sp><p:txBody>` +
        text.split("\n").map((line) => `<a:p><a:r><a:t>${line}</a:t></a:r></a:p>`).join("") +
        `</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    ),
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

test("新建项目默认可提出写入，模式为每次批准", (t) => {
  const { service, id } = setup(t);
  const w = service.get(id);
  assert.equal(w.permissions.grants["filesystem.read"], true);
  assert.equal(w.permissions.grants["filesystem.write"], true);
  assert.equal(w.approvalPolicy, "review");
});

test("read_file 直接读取 PPTX 文字，图片给出替代工具提示", async (t) => {
  const { service, root, id } = setup(t);
  const deck = await makePptx(["随访方案 &amp; 计划\n第二行", "结论"]);
  writeFileSync(join(root, "deck.pptx"), deck);
  const result = await service.tool(id, { tool: "read_file", arguments: { path: "deck.pptx" } });
  assert.match(result.text, /\[幻灯片 1\]\n随访方案 & 计划\n第二行/);
  assert.match(result.text, /\[幻灯片 2\]\n结论/);
  assert.equal(result.hash, hashText(deck));
  assert.equal(result.readOnly, true);
  writeFileSync(join(root, "photo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]));
  await assert.rejects(
    service.tool(id, { tool: "read_file", arguments: { path: "photo.png" } }),
    /inspect_image/,
  );
});

test("成果写回目录：首次待批准，批准并始终允许后自动写入并备份旧版", async (t) => {
  const { service, root, id } = setup(t);
  const first = Buffer.from([0x50, 0x4b, 3, 4, 0, 1, 2]);
  const artifact = service.artifacts.save(id, "out/deck.pptx", first, "manual");
  const proposed = await service.tool(id, {
    tool: "save_artifact_to_workspace",
    arguments: { artifactId: artifact.id },
  });
  assert.equal(proposed.status, "pending");
  assert.equal(existsSync(join(root, "out/deck.pptx")), false);

  const answered = service.approveAll(id, {
    revision: service.get(id).revision,
    alwaysAllow: true,
    autoApplyConsent: true,
  });
  assert.deepEqual(answered.failed, []);
  assert.equal(answered.approvalPolicy, "workspace-write");
  assert.deepEqual(readFileSync(join(root, "out/deck.pptx")), first);

  const second = Buffer.from([0x50, 0x4b, 3, 4, 9, 9]);
  const next = service.artifacts.save(id, "deck-v2.pptx", second, "manual");
  await assert.rejects(
    service.tool(id, {
      tool: "save_artifact_to_workspace",
      arguments: { artifactId: next.id, path: "out/deck.pptx" },
    }),
    /已存在/,
  );
  const applied = await service.tool(id, {
    tool: "save_artifact_to_workspace",
    arguments: { artifactId: next.id, path: "out/deck.pptx", overwrite: true },
  });
  assert.equal(applied.status, "applied");
  assert.deepEqual(readFileSync(join(root, "out/deck.pptx")), second);
  const backup = service.artifacts.read(id, applied.backupArtifactId);
  assert.deepEqual(backup.data, first);
});

test("二进制写入在文件被外部修改后拒绝应用", async (t) => {
  const { service, root, id } = setup(t);
  const artifact = service.artifacts.save(id, "a.pdf", Buffer.from("%PDF-1.4\0x"), "manual");
  const proposed = await service.tool(id, {
    tool: "save_artifact_to_workspace",
    arguments: { artifactId: artifact.id },
  });
  writeFileSync(join(root, "a.pdf"), "someone else");
  assert.throws(
    () => service.decide(id, proposed.approvalId, { decision: "approve", revision: service.get(id).revision }),
    /版本已变化/,
  );
  assert.equal(readFileSync(join(root, "a.pdf"), "utf8"), "someone else");
});

test("同一项目的新任务沿用“始终允许写入”", async (t) => {
  const { service, id } = setup(t);
  service.approveAll(id, { revision: service.get(id).revision, alwaysAllow: true, autoApplyConsent: true });
  const task = service.newTask(id);
  assert.equal(service.get(task.id).approvalPolicy, "workspace-write");
});

// Document generation without Docker: a stand-in for the local document
// environment exercises the tool wiring, readiness and write proposal.
function setupWithDocuments(t, documentPython) {
  const base = mkdtempSync(join(tmpdir(), "omw-project-docs-"));
  const root = join(base, "project");
  mkdirSync(root);
  const db = new DatabaseSync(join(base, "agent.sqlite"));
  const service = new WorkspaceService(db, provider, { documentPython });
  t.after(() => {
    db.close();
    rmSync(base, { recursive: true, force: true });
  });
  return { service, root, id: service.create({ root, directoryConsent: true }).id };
}

test("文档生成环境就绪时，document_create 默认可用并生成写入提案", async (t) => {
  const calls = [];
  const fake = {
    ready: () => true,
    create: async (request) => {
      calls.push(request);
      return { path: request.path, data: Buffer.from("PK fake pptx") };
    },
  };
  const { service, root, id } = setupWithDocuments(t, fake);
  const listed = service.registry(id).definitions(new (await import("../../server/core/permissions.mjs")).PermissionEngine(service.get(id).permissions))
    .map((d) => d.function.name);
  assert.ok(listed.includes("document_create"), "无需 Docker 或终端授权即可列出");
  const result = await service.tool(id, {
    tool: "document_create",
    arguments: { path: "out/方案.pptx", contentJson: JSON.stringify({ slides: [{ title: "a" }] }) },
  });
  assert.equal(result.environment, "local-sandbox");
  assert.equal(result.status, "pending");
  assert.deepEqual(calls[0].content, { slides: [{ title: "a" }] });
  assert.equal(existsSync(join(root, "out/方案.pptx")), false);
  service.decide(id, result.approvalId, { decision: "approve", revision: service.get(id).revision });
  assert.equal(readFileSync(join(root, "out/方案.pptx"), "utf8"), "PK fake pptx");
});

test("文档生成环境未安装且没有容器时，document_create 不列给模型", async (t) => {
  const { service, id } = setupWithDocuments(t, { ready: () => false });
  const { PermissionEngine } = await import("../../server/core/permissions.mjs");
  const listed = service.registry(id).definitions(new PermissionEngine(service.get(id).permissions))
    .map((d) => d.function.name);
  assert.ok(!listed.includes("document_create"));
  assert.ok(listed.includes("read_file"));
});
