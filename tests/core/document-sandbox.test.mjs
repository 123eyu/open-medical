import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentPython } from "../../server/core/document-python.mjs";
import { extractDocumentText } from "../../server/core/document-text.mjs";

// 真实文档沙箱（macOS Seatbelt / Windows AppContainer）。设置
// MEDICAL_DOCUMENT_PYTHON 指向装好 python-pptx、python-docx、openpyxl、
// reportlab、pypdf、pillow 的解释器时运行。
const python = process.env.MEDICAL_DOCUMENT_PYTHON;

test("真实文档沙箱：生成 PPTX/DOCX/XLSX/PDF，拒绝越界路径", { skip: !python }, async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "omw-document-env-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const documents = new DocumentPython({ dataDir });
  assert.equal(documents.ready(), true, JSON.stringify(documents.status()));
  const cases = [
    ["deck/随访.pptx", { slides: [{ title: "随访方案", paragraphs: ["第一点"], notes: "备注" }] }, /随访方案/],
    ["a.docx", { title: "报告", blocks: [{ type: "paragraph", text: "中文段落" }] }, /中文段落/],
    ["b.xlsx", { sheets: [{ name: "表1", rows: [["指标", "值"], ["血钾", 3.2]] }] }, /血钾/],
    ["c.pdf", { title: "PDF", blocks: [{ type: "paragraph", text: "出院小结：血压平稳" }] }, /出院小结：血压平稳/],
  ];
  for (const [path, content, expected] of cases) {
    const output = await documents.create({ path, content });
    assert.equal(output.path, path);
    assert.match((await extractDocumentText(output.data, path)).text, expected, path);
  }
  await assert.rejects(documents.create({ path: "../x.pptx", content: { slides: [{ title: "x" }] } }), /相对路径/);
});
