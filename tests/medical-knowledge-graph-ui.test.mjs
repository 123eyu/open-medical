import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { fixture } from "./helpers.mjs";
import { library, waitJob } from "./knowledge-organization-helpers.mjs";
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const text =
  "合成药甲（测试甲）用于成人合成疾病；合成药甲禁用于合成高危人群。合成检查是合成诊断的依据。";
const evidence = { quote: text, startLine: 1, endLine: 1 };
const provider = {
  provider: "stub",
  model: "stub",
  apiKey: "stub",
  async complete() {
    return {
      message: {
        role: "assistant",
        tool_calls: [
          {
            id: "save",
            type: "function",
            function: {
              name: "save_knowledge_batch",
              arguments: JSON.stringify({
                title: "医学图谱测试",
                summary: "合成材料用于软件验证",
                nodes: [
                  {
                    label: "合成药甲",
                    type: "药物",
                    aliases: ["测试甲"],
                    ...evidence,
                  },
                  { label: "合成疾病", type: "疾病", ...evidence },
                  { label: "合成高危人群", type: "人群", ...evidence },
                  { label: "合成检查", type: "检查", ...evidence },
                  { label: "合成诊断", type: "诊断", ...evidence },
                ],
                relations: [
                  {
                    from: "合成药甲",
                    to: "合成疾病",
                    relation: "用于成人",
                    relationType: "适应证",
                    assertion: "条件性",
                    qualifiers: [
                      { field: "适用人群", value: "成人", ...evidence },
                    ],
                    ...evidence,
                  },
                  {
                    from: "合成药甲",
                    to: "合成高危人群",
                    relation: "禁用于",
                    relationType: "禁忌",
                    assertion: "否定",
                    ...evidence,
                  },
                  {
                    from: "合成检查",
                    to: "合成诊断",
                    relation: "诊断依据",
                    relationType: "诊断依据",
                    assertion: "明确陈述",
                    ...evidence,
                  },
                ],
              }),
            },
          },
        ],
      },
    };
  },
};
test(
  "doctor builds a collection, explores medical relations and evidence, then incrementally updates",
  { skip: !existsSync(chrome) },
  async (t) => {
    const f = await fixture(t, { provider }),
      collection = await library(f, "医学图谱验证");
    await f.server.guidelines.addDocument({
      collection,
      title: "合成医学资料",
      text,
    });
    const browser = await chromium.launch({
      executablePath: chrome,
      headless: true,
    });
    t.after(() => browser.close());
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      f.origin +
        "/?view=knowledge&" +
        new URLSearchParams({ collection, knowledgeTab: "map" }),
    );
    await page
      .getByRole("button", { name: "生成知识图谱", exact: true })
      .click();
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
    await page
      .getByRole("button", { name: "知识点：合成药甲", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "更新知识图谱", exact: true })
      .waitFor();
    await page.getByLabel("搜索知识点").fill("测试甲");
    assert.equal(await page.locator('.kg-node[role="button"]').count(), 1);
    await page
      .getByRole("button", { name: "知识点：合成药甲", exact: true })
      .click();
    await page
      .locator(".knowledge-map-evidence")
      .getByText("适用人群：", { exact: true })
      .waitFor();
    assert.match(
      await page.locator(".knowledge-map-evidence").innerText(),
      /禁用于/,
    );
    await page.getByRole("button", { name: "放大图谱" }).click();
    assert.match(
      await page
        .locator('svg[aria-label="知识关系图"]>g')
        .getAttribute("transform"),
      /scale\(1.25\)/,
    );
    await page.getByRole("button", { name: "适应画布" }).click();
    await page.getByLabel("医学关系类型").selectOption("禁忌");
    assert.equal(await page.locator('.kg-edge[role="button"]').count(), 1);
    await page.locator('.kg-edge[role="button"]').focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: /查看依据 · 第/ }).click();
    await page.locator(".guideline-line.matched").first().waitFor();
    await page.getByRole("button", { name: "关闭溯源", exact: true }).click();
    await page.getByRole("button", { name: "返回全图" }).click();
    await page
      .getByRole("button", { name: "知识点：合成药甲", exact: true })
      .click();
    mkdirSync("output/playwright", { recursive: true });
    await page.screenshot({
      path: "output/playwright/medical-graph-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "output/playwright/medical-graph-mobile.png",
      fullPage: true,
    });
    assert.ok(
      await page
        .locator(".kw-workspace")
        .evaluate((e) => e.getBoundingClientRect().right <= innerWidth + 1),
    );
    await f.server.guidelines.addDocument({
      collection,
      title: "新增资料",
      text: text + "\n用于增量更新测试。",
    });
    await page.reload();
    await page
      .getByRole("button", { name: "更新知识图谱", exact: true })
      .click();
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
    await page
      .getByText("已提交 1 份资料，复用 1 份已完成结果。", { exact: true })
      .waitFor();
    const jobs = f.server.knowledgeOrganizer.list(collection);
    assert.equal(jobs.length, 2);
    await waitJob(f, jobs[0].id);
    assert.equal(
      f.server.knowledgeOrganizer.graph(collection).completedDocuments,
      2,
    );
    assert.deepEqual(errors, []);
  },
);
