import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { fixture } from "./helpers.mjs";
import { library, waitJob } from "./knowledge-organization-helpers.mjs";
import { diagramBatch, diagramText } from "./knowledge-diagram-fixtures.mjs";
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
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
              arguments: JSON.stringify(diagramBatch()),
            },
          },
        ],
      },
    };
  },
};
test(
  "build, automatically choose a grounded flow, switch to a mind map and open original branch evidence",
  { skip: !existsSync(chrome) },
  async (t) => {
    const f = await fixture(t, { provider }),
      collection = await library(f, "结构图验证");
    await f.server.guidelines.addDocument({
      collection,
      title: "合成路径与主题",
      text: diagramText,
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
    await page.getByLabel("诊疗流程图", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "查看连线出处：高风险", exact: true })
      .locator("rect")
      .click();
    assert.match(
      await page.getByLabel("结构图原文依据").innerText(),
      /高风险时转诊/,
    );
    await page
      .getByLabel("结构图原文依据")
      .getByRole("button", { name: "查看原文", exact: true })
      .click();
    await page.locator(".guideline-line.matched").first().waitFor();
    await page.getByRole("button", { name: "关闭溯源", exact: true }).click();
    await page.getByRole("button", { name: /思维导图 · 1/ }).click();
    await page.getByLabel("知识思维导图", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "查看子主题出处：检查", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    assert.match(
      await page.getByLabel("结构图原文依据").innerText(),
      /评估包括症状与检查/,
    );
    mkdirSync("output/playwright", { recursive: true });
    await page.screenshot({
      path: "output/playwright/medical-mindmap-desktop.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: /流程图 · 1/ }).click();
    await page
      .getByRole("button", { name: "查看判断出处：判断风险", exact: true })
      .click();
    await page.screenshot({
      path: "output/playwright/medical-flowchart-desktop.png",
      fullPage: true,
    });
    const width = await page.locator(".kd-svg").getAttribute("width");
    await page.getByRole("button", { name: "放大结构图", exact: true }).click();
    assert.ok(
      Number(await page.locator(".kd-svg").getAttribute("width")) >
        Number(width),
    );
    await page.getByRole("button", { name: "115%", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "output/playwright/medical-flowchart-mobile.png",
      fullPage: true,
    });
    assert.ok(
      await page
        .locator(".kw-workspace")
        .evaluate((e) => e.getBoundingClientRect().right <= innerWidth + 1),
    );
    assert.ok(
      await page
        .locator(".kd-scroll")
        .evaluate((e) => e.scrollWidth > e.clientWidth),
    );
    await page.getByRole("button", { name: "关系图", exact: true }).click();
    await page
      .getByRole("button", { name: "知识点：初步评估", exact: true })
      .waitFor();
    await page.reload();
    await page.getByLabel("诊疗流程图", { exact: true }).waitFor();
    // A second source remains a separate choice rather than merging its pathway.
    await f.server.guidelines.addDocument({
      collection,
      title: "另一份合成资料",
      text: diagramText + "\n另一版本",
    });
    const response = await f.json("/api/knowledge/map/build", "POST", {
      collection,
      externalConsent: true,
    });
    await waitJob(f, response.data.jobs[0].id);
    await page.reload();
    await page.getByLabel("选择资料结构图").waitFor();
    assert.equal(
      await page.getByLabel("选择资料结构图").locator("option").count(),
      2,
    );
    const options = await page
      .getByLabel("选择资料结构图")
      .locator("option")
      .evaluateAll((es) => es.map((e) => e.value));
    await page.getByLabel("选择资料结构图").selectOption(options[1]);
    assert.deepEqual(errors, []);
  },
);
