import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { fixture } from "./helpers.mjs";
import { sourceFile, exactQuote } from "../shared/clinical-evidence.mjs";
import {
  patientReviewItems,
  reviewItemSources,
} from "../shared/patient-review.mjs";
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("evidence never resolves a partial filename, duplicate file or repeated quote as a unique anchor", () => {
  const files = [
    { id: "1", name: "报告.txt" },
    { id: "2", name: "复查报告.txt" },
    { id: "3", name: "含 空格.pdf" },
  ];
  assert.equal(sourceFile("复查报告.txt 第3行", files).id, "2");
  assert.equal(sourceFile("含 空格.pdf 第1页", files).id, "3");
  assert.equal(sourceFile("其他报告.txt 第3行", files), null);
  assert.equal(
    sourceFile("报告.txt 第3行", [...files, { id: "4", name: "报告.txt" }]),
    null,
  );
  assert.equal(exactQuote("甲乙甲乙", "甲乙"), null);
  assert.equal(exactQuote("甲乙丙", "不存在"), null);
  assert.deepEqual(exactQuote("甲乙丙", "乙"), {
    before: "甲",
    quote: "乙",
    after: "丙",
  });
});

test("review queue uses original indexes and excludes nonconflicting dates and different units", () => {
  const p = {
    allergyStatus: "none_known",
    diagnoses: [
      { name: "已确认", status: "confirmed" },
      { name: "核对", status: "needs_review" },
    ],
    labs: [
      { item: "A", value: 1, unit: "U", date: "2026-01-01" },
      { item: "A", value: 2, unit: "U", date: "2026-02-01", source: "甲.txt" },
      { item: "A", value: 3, unit: "U", date: "2026-02-01", source: "乙.txt" },
      { item: "A", value: 5, unit: "mg", date: "2026-02-01" },
    ],
    medications: [{ name: "已停", status: "stopped" }, { name: "待核对" }],
  };
  const items = patientReviewItems(p);
  assert.deepEqual(
    items.map((x) => [x.field, x.indexes]),
    [
      ["diagnoses", [1]],
      ["labs", [1, 2]],
      ["medications", [1]],
    ],
  );
  assert.deepEqual(reviewItemSources(p, items[1]), ["甲.txt", "乙.txt"]);
});

test(
  "contextual lab repair preserves sources and other records, cancels cleanly and rejects stale writes",
  { skip: !existsSync(chrome) },
  async (t) => {
    const f = await fixture(t);
    const p = (
      await f.json("/api/patients", "POST", {
        name: "核对流程（合成）",
        allergyStatus: "none_known",
        labs: [
          {
            item: "指标A",
            value: 0,
            unit: "U",
            date: "2026-01-01",
            source: "报告甲.txt 第1行",
          },
          {
            item: "指标A",
            value: 2,
            unit: "U",
            date: "2026-01-01",
            source: "报告乙.txt 第1行",
          },
          { item: "指标B", value: 90, unit: "mg", date: "2026-01-02" },
        ],
        medications: [{ name: "待核对用药", status: "unknown" }],
      })
    ).data;
    await f.json(`/api/sessions/${p.sessionId}/files`, "POST", {
      name: "报告甲.txt",
      text: "指标A 0 U，采样时间 08:00。",
    });
    await f.json(`/api/sessions/${p.sessionId}/files`, "POST", {
      name: "报告乙.txt",
      text: "指标A 2 U，采样时间 16:00。",
    });
    const browser = await chromium.launch({
      executablePath: chrome,
      headless: true,
    });
    t.after(() => browser.close());
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1050 },
    });
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${f.origin}/?view=patients&patient=${p.id}&tab=overview`);
    await page.getByRole("button", { name: "检验数值冲突 1" }).click();
    const work = page.getByRole("region", { name: "逐项核对" });
    await work.waitFor();
    const reader = work.getByRole("complementary", { name: "依据阅读区" });
    assert.match(await reader.innerText(), /采样时间 08:00/);
    assert.match(await reader.innerText(), /采样时间 16:00/);
    await work
      .getByRole("button", { name: "报告甲.txt 第1行", exact: true })
      .click();
    assert.doesNotMatch(await reader.innerText(), /采样时间 16:00/);
    await work.getByRole("button", { name: "修正这条记录" }).first().click();
    await work.getByLabel("检验数值", { exact: true }).fill("7");
    assert.equal(
      await work
        .getByRole("button", { name: "下一项", exact: true })
        .isDisabled(),
      true,
    );
    await work.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal((await f.json(`/api/patients/${p.id}`)).data.labs[0].value, 0);
    await work.getByRole("button", { name: "修正这条记录" }).first().click();
    await work.getByLabel("检验数值", { exact: true }).fill("1");
    await work
      .getByLabel("备注", { exact: true })
      .fill("已核对采样时间，保留两次结果。");
    await work.getByRole("button", { name: "保存修正", exact: true }).click();
    await work.getByRole("status").waitFor();
    let current = (await f.json(`/api/patients/${p.id}`)).data;
    assert.equal(current.labs[0].value, 1);
    assert.equal(current.labs[0].source, "报告甲.txt 第1行");
    assert.deepEqual(current.labs.slice(1), p.labs.slice(1));
    await work.getByRole("button", { name: "修正这条记录" }).first().click();
    await work.getByLabel("检验数值", { exact: true }).fill("9");
    await f.json(`/api/patients/${p.id}`, "PATCH", {
      expectedRevision: current.revision,
      note: "外部更新保留",
    });
    await work.getByRole("button", { name: "保存修正", exact: true }).click();
    await work.getByRole("alert").filter({ hasText: "档案已变化" }).waitFor();
    current = (await f.json(`/api/patients/${p.id}`)).data;
    assert.equal(current.labs[0].value, 1);
    assert.equal(current.note, "外部更新保留");
    await work.getByRole("button", { name: "取消", exact: true }).click();
    mkdirSync("output/playwright", { recursive: true });
    await page.screenshot({ path: "output/playwright/cdss-review-flow.png" });
    await page.setViewportSize({ width: 760, height: 1000 });
    assert.ok(
      await work.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    await page.reload();
    await page.getByRole("button", { name: "修正检验记录" }).click();
    await work.getByRole("button", { name: "下一项", exact: true }).click();
    assert.match(await work.innerText(), /待核对用药/);
    assert.deepEqual(errors, []);
  },
);

test(
  "assessment evidence is contextual, honest about shared citations and usable with narrow layout",
  { skip: !existsSync(chrome) },
  async (t) => {
    const f = await fixture(t);
    const p = (
      await f.json("/api/patients", "POST", { name: "评估阅读（合成）" })
    ).data;
    await f.json(`/api/sessions/${p.sessionId}/files`, "POST", {
      name: "来源.txt",
      text: "前文。\n既往用药，当前状态尚未确认。\n后文。",
    });
    f.server.workspaces.store.update(p.sessionId, (w) => {
      w.runs.push({
        id: "assessment",
        status: "completed",
        startedAt: Date.now(),
        endedAt: Date.now(),
        artifacts: [
          {
            id: "assessment-artifact",
            type: "treatment_review",
            status: "draft",
            summary: "核对资料",
            concerns: ["需核实当前用药"],
            infoGaps: ["缺少当前记录"],
            questions: ["是否已有新医嘱？"],
            matches: [
              {
                sourceName: "来源.txt",
                line: 2,
                quote: "既往用药，当前状态尚未确认。",
              },
            ],
          },
        ],
      });
      w.runs.push({
        id: "diagnostic",
        status: "completed",
        startedAt: Date.now(),
        endedAt: Date.now(),
        artifacts: [],
        displayResults: [
          {
            kind: "diagnostic",
            summary: "合成鉴别参考",
            candidates: [
              {
                name: "候选甲",
                support: "记录甲",
                against: "尚缺检查",
                missing: "补充记录",
                quote: "仅属于候选甲的依据",
              },
              {
                name: "候选乙",
                support: "记录乙",
                quote: "仅属于候选乙的依据",
              },
            ],
          },
        ],
      });
      w.messages.push(
        {
          id: "question-a",
          role: "user",
          runId: "assessment",
          content: "合成评估问题",
        },
        {
          id: "question-b",
          role: "user",
          runId: "diagnostic",
          content: "合成鉴别问题",
        },
        {
          id: "answer-a",
          role: "assistant",
          runId: "assessment",
          content: "评估文字",
        },
        {
          id: "answer-b",
          role: "assistant",
          runId: "diagnostic",
          content: "鉴别文字",
        },
      );
    });
    const browser = await chromium.launch({
      executablePath: chrome,
      headless: true,
    });
    t.after(() => browser.close());
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    });
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${f.origin}/?view=patients&patient=${p.id}&tab=overview`);
    await page
      .getByRole("button", { name: "打开病例工作区", exact: true })
      .click();
    await page.getByText("以前的问答 · 2", { exact: true }).click();
    await page
      .getByRole("button", { name: "合成评估问题 查看 / 追问" })
      .click();
    const assessment = page
      .getByRole("region", { name: "辅助诊断与方案评估" })
      .filter({ hasText: "治疗方案评估" });
    const trigger = assessment.getByRole("button", {
      name: "查看本次评估依据 · 1 项",
    });
    await trigger.click();
    const reader = assessment.getByRole("complementary", {
      name: "依据阅读区",
    });
    assert.match(await reader.innerText(), /尚未标注与每条意见的对应关系/);
    await reader.getByText("查看完整资料 · 来源.txt", { exact: true }).click();
    assert.equal(
      await reader.locator("mark").innerText(),
      "既往用药，当前状态尚未确认。",
    );
    await reader.getByRole("button", { name: "关闭依据区" }).click();
    assert.equal(await reader.count(), 0);
    assert.equal(
      await trigger.evaluate((el) => document.activeElement === el),
      true,
    );
    await page.getByText("以前的问答 · 2", { exact: true }).click();
    await page
      .getByRole("button", { name: "合成鉴别问题 查看 / 追问" })
      .click();
    const diagnostic = page
      .getByRole("region", { name: "辅助诊断与方案评估" })
      .filter({ hasText: "辅助诊断参考" });
    await diagnostic
      .getByRole("button", { name: "查看「候选甲」的依据" })
      .click();
    assert.match(
      await diagnostic.getByRole("complementary").innerText(),
      /仅属于候选甲的依据/,
    );
    await diagnostic
      .getByRole("button", { name: "查看「候选乙」的依据" })
      .click();
    assert.doesNotMatch(
      await diagnostic.getByRole("complementary").innerText(),
      /仅属于候选甲的依据/,
    );
    assert.match(
      await diagnostic.getByRole("complementary").innerText(),
      /仅属于候选乙的依据/,
    );
    await page.setViewportSize({ width: 760, height: 1000 });
    assert.ok(
      await diagnostic.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    assert.deepEqual(errors, []);
  },
);
