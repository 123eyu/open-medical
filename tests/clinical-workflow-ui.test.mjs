import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { fixture } from "./helpers.mjs";
import { clinicalDiagnoses } from "../shared/diagnoses.mjs";
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("clinical summaries share diagnosis scope without promoting findings or unresolved entries", () => {
  assert.deepEqual(
    clinicalDiagnoses([
      { name: "待核对", status: "needs_review" },
      { name: "结节", status: "finding" },
      { name: "疑似病", status: "suspected" },
      { name: "确认病", status: "confirmed" },
      "既往诊断",
    ]).map((x) => x.name),
    ["既往诊断", "确认病", "疑似病"],
  );
});

test(
  "library preserves file context, metadata and edit cancellation; appointments restore and follow-up drafts survive moving between the merged plan and record sections",
  { skip: !existsSync(chrome) },
  async (t) => {
    const f = await fixture(t);
    const p = (
      await f.json("/api/patients", "POST", {
        name: "阅读布局验收（合成）",
        diagnoses: [
          { name: "确认病", status: "confirmed" },
          { name: "疑似病", status: "suspected" },
          { name: "影像发现", status: "finding" },
        ],
        labs: [
          { item: "指标", value: 0, unit: "U", date: "2026-01-01" },
          { item: "指标", value: 2, unit: "U", date: "2026-02-01" },
        ],
      })
    ).data;
    await f.json(`/api/sessions/${p.sessionId}/files`, "POST", {
      name: "门诊记录.txt",
      text: "第一份合成资料。",
    });
    const image = (
      await f.json(`/api/sessions/${p.sessionId}/files`, "POST", {
        name: "检查报告.png",
        image:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      })
    ).data;
    assert.ok(image.id, "image fixture was accepted");
    await f.json(`/api/sessions/${p.sessionId}/files/${image.id}/text`, "PUT", {
      expectedRevision: image.revision || 0,
      text: "第二份原始识别文字。",
    });
    const browser = await chromium.launch({
      executablePath: chrome,
      headless: true,
    });
    t.after(() => browser.close());
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${f.origin}/?view=patients&patient=${p.id}&tab=overview`);
    await page.getByRole("heading", { name: "诊断摘要" }).waitFor();
    assert.match(
      await page.locator(".overview-diagnoses").innerText(),
      /诊断摘要\s+2 项\s+确认病\s+确诊\s+疑似病\s+疑似待排/,
    );
    await page.getByRole("button", { name: "检验趋势", exact: true }).click();
    const row = page.locator(".chart-lab-comparison tbody tr").first();
    await row.waitFor();
    assert.ok(
      (await row.boundingBox()).y < 650,
      "first lab row is above the fold at 720px",
    );
    await page.getByRole("button", { name: "资料库", exact: true }).click();
    const files = page.getByRole("navigation", { name: "资料文件列表" }),
      reader = page.getByRole("article", { name: "资料阅读区" });
    await files.getByRole("button", { name: /门诊记录.txt/ }).click();
    assert.match(await reader.innerText(), /第一份合成资料/);
    await page.getByLabel("查找文件", { exact: true }).fill("检查");
    assert.match(await reader.innerText(), /检查报告.png/);
    await page.getByLabel("查找文件", { exact: true }).fill("");
    await files.getByRole("button", { name: /检查报告.png/ }).click();
    await reader.getByText("类型与资料日期", { exact: true }).click();
    await reader.getByLabel("资料日期", { exact: true }).fill("2026-10-01");
    await page.getByText("资料信息已保存", { exact: true }).waitFor();
    assert.equal(
      (await f.json(`/api/sessions/${p.sessionId}`)).data.files.find(
        (x) => x.id === image.id,
      ).documentDate,
      "2026-10-01",
    );
    await reader.getByRole("button", { name: "修正文字", exact: true }).click();
    await reader
      .getByLabel("修正 检查报告.png 的识别文本")
      .fill("未保存的改动");
    assert.equal(
      await files.getByRole("button", { name: /门诊记录.txt/ }).isDisabled(),
      true,
    );
    await reader.getByRole("button", { name: "取消", exact: true }).click();
    assert.match(await reader.innerText(), /第二份原始识别文字/);
    assert.doesNotMatch(await reader.innerText(), /未保存的改动/);
    const evidenceDir = process.env.EVIDENCE_DIR || "output/playwright";
    mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({ path: `${evidenceDir}/workflow-library.png` });
    await page.goto(
      `${f.origin}/?view=patients&patient=${p.id}&tab=appointments`,
    );
    await page.getByRole("button", { name: "复诊预约", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("button", { name: "复诊预约", exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "复诊预约", exact: true })
        .getAttribute("aria-current"),
      "page",
    );
    await page.getByRole("button", { name: "随访计划", exact: true }).click();
    await page
      .getByRole("button", { name: "记录一次联系", exact: true })
      .click();
    const editor = page.getByRole("complementary", { name: "登记联系结果" });
    await editor
      .getByRole("textbox", { name: "随访记录", exact: true })
      .fill("合成联系记录，保留当前填写内容。");
    // Plans and records now share one scrolling page instead of nested tabs.
    await page.getByRole("heading", { name: /提醒计划（/ }).scrollIntoViewIfNeeded();
    await editor.scrollIntoViewIfNeeded();
    assert.equal(
      await editor.getByRole("textbox", { name: "随访记录", exact: true }).inputValue(),
      "合成联系记录，保留当前填写内容。",
    );
    await editor.getByRole("button", { name: "保存随访结果" }).click();
    await editor.waitFor({ state: "hidden" });
    const records = (
      await f.json(`/api/reminders?patientId=${p.id}&status=done`)
    ).data;
    assert.equal(records.total, 1);
    assert.equal(
      records.reminders[0].outcome.note,
      "合成联系记录，保留当前填写内容。",
    );
    assert.deepEqual(errors, []);
  },
);
