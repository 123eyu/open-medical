import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { fixture } from './helpers.mjs';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
test('patient connection flow explains availability without asking for developer credentials', { skip: !existsSync(chrome) }, async t => {
  const f = await fixture(t, { wecom: {}, care: { kfPollMs: null } });
  const browser = await chromium.launch({ executablePath: chrome, headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); page.setDefaultTimeout(10000);
  await page.goto(f.origin + '/?view=care');
  await page.getByRole('button', { name: '查看连接方式' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText(/当前尚无可用的企业微信客服连接/).waitFor();
  assert.equal(await dialog.locator('input, textarea').count(), 0);
  await dialog.getByRole('link', { name: '扫码连接我的飞书或微信助手 →' }).click();
  await page.getByRole('button', { name: '连接飞书', exact: true }).waitFor();
});
