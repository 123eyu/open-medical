import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { fixture } from "./helpers.mjs";
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test(
  "saved records have no review queue; sources, conflicts and text repair remain accessible",
  { skip: !existsSync(chrome) },
  async (t) => {
    const f = await fixture(t);
    const p = (
      await f.json("/api/patients", "POST", {
        name: "资料核对验证（合成）",
        note: "报告日期存在冲突。",
        diagnoses: [
          {
            name: "待核对的诊断",
            status: "needs_review",
            source: "报告.txt 第1行",
          },
        ],
        labs: [
          {
            item: "合成指标",
            value: 1,
            unit: "U/L",
            date: "2026-01-01",
            source: "报告.txt 第2行",
          },
          {
            item: "合成指标",
            value: 2,
            unit: "U/L",
            date: "2026-01-01",
            source: "报告.txt 第3行",
          },
        ],
      })
    ).data;
    const text = (
      await f.json(`/api/sessions/${p.sessionId}/files`, "POST", {
        name: "报告.txt",
        text: "合成来源文本",
      })
    ).data;
    const image = (
      await f.json(`/api/sessions/${p.sessionId}/files`, "POST", {
        name: "扫描.png",
        image:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      })
    ).data;
    f.server.workspaces.store.update(p.sessionId, (w) => {
      const file = w.materials.find((x) => x.id === image.id);
      file.text = "???";
      file.extraction.ocr = {
        status: "ready",
        method: "local-ocr",
        quality: { level: "poor", score: 1 },
      };
    });
    f.server.sessionBridge.saveIntakeIssues(p.sessionId, [
      {
        name: "未导入.pdf",
        stage: "upload",
        error: "文件读取失败，请重新上传。",
      },
    ]);
    const browser = await chromium.launch({
      executablePath: chrome,
      headless: true,
    });
    t.after(() => browser.close());
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1700 },
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${f.origin}/?view=patients&patient=${p.id}&tab=review`);
    const panel = page.getByRole("region", { name: "患者资料面板" });
    await panel.getByRole("heading", { name: "患者概览", exact: true }).waitFor();
    const tabs = page.getByRole("navigation", { name: "患者栏目" });
    assert.equal(await tabs.getByRole("button", {name:"资料核对",exact:true}).count(),0);
    assert.equal(await panel.getByRole("complementary",{name:"待处理事项"}).count(),0);
    await tabs.getByRole("button",{name:"诊断与病史",exact:true}).click();
    const uncertain = panel.getByRole("region",{name:"资料中的不确定记录"});
    assert.match(await uncertain.innerText(), /待核对的诊断/);
    await uncertain.getByText("资料来源 · 1").click();
    await uncertain.getByRole("button",{name:"查看原文",exact:true}).click();
    await panel.getByRole("heading",{name:text.name,exact:true}).waitFor();
    assert.match(await panel.innerText(),/合成来源文本/);
    assert.match(await panel.innerText(),/未导入.pdf/);
    await panel.getByRole("navigation",{name:"资料文件列表"}).getByRole("button",{name:/扫描.png/}).click();
    await panel.getByRole("button",{name:"修正文字",exact:true}).click();
    const editor = panel.getByRole("textbox",{name:"修正 扫描.png 的识别文本"});
    await editor.fill("合成患者记录：2026年1月1日复诊，症状改善。此文本仅供界面验证。");
    await panel.getByRole("button",{name:"保存修正",exact:true}).click();
    await editor.waitFor({state:"hidden"});
    assert.match((await f.json(`/api/sessions/${p.sessionId}`)).data.files.find(x=>x.id===image.id).text,/症状改善/);
    await tabs.getByRole("button",{name:"检验趋势",exact:true}).click();
    const lab = panel.getByRole("article",{name:"合成指标 U/L",exact:true});
    assert.match(await lab.innerText(),/同日有不同数值/);
    await lab.getByText("全部记录与来源 · 2 条").click();
    assert.equal(await lab.getByRole("table").locator("tbody tr").count(),2);
    const current = (await f.json(`/api/patients/${p.id}`)).data;
    assert.equal(current.allergyStatus,"unknown");
    assert.equal(current.diagnoses[0].status,"needs_review");
    assert.equal(current.labs.length,2);
    mkdirSync("output/playwright",{recursive:true});
    await page.screenshot({path:"output/playwright/patient-records-simplified.png"});
    await page.setViewportSize({width:760,height:1700});
    assert.ok(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    assert.deepEqual(errors, []);
  },
);
