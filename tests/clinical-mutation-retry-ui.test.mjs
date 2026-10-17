import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { fixture } from './helpers.mjs';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
for (const section of ['visits', 'labs', 'medications']) test(`saved ${section} retry after response loss remains exactly once across navigation and refresh`, { skip: !existsSync(chrome) }, async t => {
  const f = await fixture(t, { followupOptions: { autoStart: false } });
  const patient = (await f.json('/api/patients', 'POST', { name: `虚构重试${section}` })).data;
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage(); page.setDefaultTimeout(10000);
  await page.goto(`${f.origin}/?view=patients&patient=${patient.id}&tab=${section}`);
  await page.getByRole('button', { name: section === 'medications' ? '编辑用药与过敏' : '编辑记录', exact: true }).click();
  const fill = async () => {
    if (section === 'visits') { await page.getByLabel('就诊日期（必填）').fill('2026-01-01'); await page.getByPlaceholder('就诊事由').fill('虚构复诊重试'); }
    if (section === 'labs') { await page.getByPlaceholder('项目', { exact: true }).fill('虚构指标'); await page.getByPlaceholder('数值', { exact: true }).fill('7'); await page.getByLabel('检验日期（采样日，必填）').fill('2026-01-01'); }
    if (section === 'medications') await page.getByPlaceholder('药名', { exact: true }).fill('虚构药物');
  };
  await fill();
  const add = page.locator('.clinical-add-med').getByRole('button', { name: '添加', exact: true });
  const requests = []; let lost = true;
  await page.route(`**/api/patients/${patient.id}`, async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    requests.push(route.request().postDataJSON());
    if (lost) { lost = false; const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort('failed'); }
    else await route.continue();
  });
  await add.click(); await page.getByRole('alert').filter({ hasText: 'Failed to fetch' }).waitFor();
  assert.equal((await f.json(`/api/patients/${patient.id}`)).data[section].length, 1);
  await page.getByRole('button', { name: '概览', exact: true }).click();
  await page.getByRole('button', { name: ({visits:'就诊经过',labs:'检验趋势',medications:'治疗与预后'})[section], exact: true }).click();
  await add.click();
  await page.waitForFunction(() => !document.querySelector('.clinical-panel[aria-busy="true"]'));
  const saved = (await f.json(`/api/patients/${patient.id}`)).data;
  assert.equal(saved[section].length, 1); assert.equal(saved.revision, 1);
  assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1]);
  await page.reload();
  assert.equal((await f.json(`/api/patients/${patient.id}`)).data[section].length, 1);
  await page.getByRole('button', { name: section === 'medications' ? '编辑用药与过敏' : '编辑记录', exact: true }).click();
  await fill(); await add.click();
  await page.waitForFunction(() => !document.querySelector('.clinical-panel[aria-busy="true"]'));
  assert.equal((await f.json(`/api/patients/${patient.id}`)).data[section].length, 2);
  assert.notEqual(requests[2].requestId, requests[0].requestId);
});
