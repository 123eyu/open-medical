import {openPatient} from "./navigation-ui.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { fixture } from "./helpers.mjs";
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test(
  "patient proposal conflict is visible in UI and preserves newer physician edits",
  {
    skip: !existsSync(chrome) || !existsSync("dist/index.html"),
    timeout: 30000,
  },
  async (t) => {
    const f = await fixture(t);
    const patient = (
      await f.json("/api/patients", "POST", { name: "合成冲突验收" })
    ).data;
    const proposal = f.server.runtime.toolPlugins
      .get("patient_record_propose")
      .execute({
        patientId: patient.id,
        medications: [{ name: "旧提案合成条目" }],
        summary: "待核对旧提案",
      });
    const browser = await chromium.launch({
      executablePath: chrome,
      headless: true,
    });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(f.origin + "/?view=home");
  await page.locator(".app-navigation").waitFor();
    await openPatient(page, patient.name);
    await page.locator(".pending-badge").waitFor();
    const review = page.getByRole("dialog", { name: "全屏审核：档案更新", exact: true });
    const openReview = async () => {
      await page.locator(".pending-badge").click();
      await page.getByRole("button", { name: "全屏审核", exact: true }).click();
      await review.getByText("当前记录", { exact: true }).waitFor();
    };
    // The global queue and full review stay reachable at both viewport sizes.
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const badge = page.locator('.pending-badge');
      const header = await page.locator('.topbar').boundingBox();
      const badgeBounds = await badge.boundingBox();
      assert.ok(badgeBounds.y + badgeBounds.height <= header.y + header.height, 'queue remains inside the header');
      await badge.click();
      const queue = page.getByRole('region', { name: '待确认的操作' });
      await queue.waitFor();
      const bounds = await queue.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      await page.keyboard.press('Escape');
      await queue.waitFor({ state: 'detached' });
      await openReview();
      await review.getByRole('button', { name: '关闭全屏审核', exact: true }).click();
      await page.keyboard.press('Escape');
      const chartUrl = page.url();
      await page.getByRole('button', { name: '打开问诊工作台', exact: true }).click();
      await page.locator('.composer').waitFor();
      const workHeader = await page.locator('.topbar').boundingBox();
      for (const button of await page.locator('.top-actions button').all()) {
        if (!await button.isVisible()) continue;
        const box = await button.boundingBox();
        assert.ok(box.y + box.height <= workHeader.y + workHeader.height + 1, 'workspace controls remain inside the header');
      }
      await page.goto(chartUrl);
      await page.locator('.pending-badge').waitFor();
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await openReview();
    const edited = await f.json(`/api/patients/${patient.id}`, "PATCH", {
      expectedRevision: patient.revision,
      medications: [{ name: "医生最新合成条目" }],
    });
    assert.equal(edited.status, 200);
    const conflictResponse = page.waitForResponse(response => response.url().endsWith(`/api/pending-actions/${proposal.id}/confirm`));
    await review.getByRole("button", { name: "确认执行", exact: true }).click();
    assert.equal((await conflictResponse).status(), 409);
    await page
      .locator('[role="alert"]')
      .filter({ hasText: /变化|版本|冲突|重新/ }).first()
      .waitFor();
    assert.equal(
      (await f.json(`/api/pending-actions?patientId=${patient.id}`)).data.actions.find(a => a.id === proposal.id)?.status,
      "pending",
    );
    assert.equal(
      (await f.json(`/api/patients/${patient.id}`)).data.medications[0].name,
      "医生最新合成条目",
    );
    assert.equal(await review.isVisible(), true);
    assert.deepEqual(errors, []);
    await review.getByRole("button", { name: "关闭全屏审核", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "全屏审核", exact: true }).isEnabled(), true);
    await page.getByRole("region", { name: "待确认的操作" }).getByRole("button", { name: "拒绝", exact: true }).click();
    await page.getByRole("button", { name: "不填了，直接拒绝", exact: true }).click();
    await page.locator(".pending-badge").waitFor({ state: "detached", timeout: 2000 });
    assert.equal(
      (await f.json(`/api/pending-actions?patientId=${patient.id}&status=rejected`)).data.actions.find(a => a.id === proposal.id)?.status,
      "rejected",
    );
    await page.locator(".pending-badge").waitFor({ state: "detached", timeout: 2000 });
    await page.reload();
    assert.equal((await f.json(`/api/patients/${patient.id}`)).data.medications[0].name, "医生最新合成条目");
  },
);
