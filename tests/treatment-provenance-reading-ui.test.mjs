import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { fixture } from './helpers.mjs';

const evidence = 'output/doctor-iteration/cycles/round-2/optimization-retry';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
async function setup(t) {
  mkdirSync(evidence, { recursive: true });
  const f = await fixture(t, { followupOptions: { autoStart: false } });
  const browser = await chromium.launch({ executablePath: chrome, headless: false });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  t.after(() => assert.deepEqual(errors, []));
  const p = (await f.json('/api/patients', 'POST', {
    name: '虚构来源字号复测', patientNumber: 'SYNTHETIC-READING',
    medications: [
      { name: '虚构多来源药', status: 'stopped', dose: '5 mg', frequency: '隔日一次', source: '虚构旧处方', sources: ['虚构旧处方', '虚构补充出处'] },
      { name: '虚构单来源药', status: 'active', dose: '1 mg', source: '虚构单份处方' },
    ],
    labs: [
      { item: '虚构指标', unit: 'U/L', date: '2026-10-15', value: 8 },
      { item: '虚构指标', unit: 'U/L', date: '2026-10-17', value: 6 },
    ],
  })).data;
  assert.ok(p.id);
  const click = name => page.getByRole('button', { name, exact: true }).click();
  const shot = async name => {
    await page.screenshot({ path: `${evidence}/${name}.png` });
    writeFileSync(`${evidence}/${name}.txt`, await page.locator('body').innerText());
  };
  await page.goto(`${f.origin}/?view=patients&patient=${p.id}&tab=medications`);
  await page.getByRole('heading', { name: '治疗方案与预后', exact: true }).waitFor();
  return { ...f, page, p, click, shot };
}

test('medication source correction remains visible alongside deduplicated historical sources after refresh', async t => {
  const f = await setup(t);
  const { page, p, click, shot } = f;
  for (const [name, source] of [['虚构多来源药', '虚构更正新处方'], ['虚构单来源药', '虚构单份更正处方']]) {
    await click('编辑用药与过敏');
    const row = page.locator('.clinical-rows li').filter({ hasText: name });
    await row.getByRole('button', { name: '更正用药', exact: true }).click();
    await page.getByLabel('更正处方来源').fill(source);
    const response = page.waitForResponse(r => r.request().method() === 'PATCH' && new URL(r.url()).pathname === `/api/patients/${p.id}`);
    await click('保存用药更正');
    assert.equal((await response).status(), 200);
    await page.locator('fieldset[aria-busy=false]').waitFor();
    await click('返回记录');
    await page.reload();
    await page.getByRole('heading', { name: '治疗方案与预后', exact: true }).waitFor();
    await page.getByRole('button', { name: '全部', exact: true }).click();
    const med = page.locator('.treatment-medications li').filter({ hasText: name });
    await med.locator('summary').click();
    const provenance = await med.locator('.treatment-provenance p').innerText();
    const saved = (await f.json(`/api/patients/${p.id}`)).data.medications.find(m => m.name === name);
    writeFileSync(`${evidence}/${name}.json`, JSON.stringify({ saved, provenance }, null, 2));
    await shot(name);
    assert.equal(saved.source, source);
    assert.ok(provenance.includes(source), 'updated source must be visible after returning and refreshing');
    if (name === '虚构多来源药') {
      assert.deepEqual(saved.sources, ['虚构旧处方', '虚构补充出处']);
      for (const value of ['虚构旧处方', '虚构补充出处', source]) assert.equal(provenance.split('；').filter(s => s === value).length, 1);
      assert.equal(saved.status, 'stopped');
      assert.equal(saved.dose, '5 mg');
      assert.equal(saved.frequency, '隔日一次');
    } else assert.equal(provenance, source);
  }
});

test('large text applies to both lab and compact treatment axes without page overflow', async t => {
  const { page, click, shot } = await setup(t);
  const metrics = [];
  const measure = async (selector, name, width) => {
    const region = page.locator(selector);
    await region.scrollIntoViewIfNeeded();
    const labels = await region.locator('svg text').evaluateAll(elements => elements.map(e => ({ text: e.textContent, size: parseFloat(getComputedStyle(e).fontSize) * e.getScreenCTM().a })));
    const scroll = await region.locator('.lab-plot-scroll').evaluate(e => {
      e.scrollLeft = e.scrollWidth;
      return { client: e.clientWidth, scroll: e.scrollWidth, left: e.scrollLeft };
    });
    const result = { name, width, labels, scroll, pageWidth: await page.evaluate(() => document.body.scrollWidth) };
    metrics.push(result);
    writeFileSync(`${evidence}/font-metrics.json`, JSON.stringify(metrics, null, 2));
    await shot(`${name}-${width}`);
    assert.ok(labels.every(l => l.size >= 16), JSON.stringify(result));
    assert.ok(result.pageWidth <= width, JSON.stringify(result));
    if (scroll.scroll > scroll.client) assert.ok(scroll.left > 0, 'overflow must remain locally scrollable');
  };
  await page.getByRole('button', { name: /切换字号/ }).click();
  await page.reload();
  await page.locator('.agent-app.large-text').waitFor();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await click('检验趋势');
    await measure('.chart-lab-card', 'lab', width);
    await page.locator('.chart-lab-records summary').click();
    assert.match(await page.locator('.chart-lab-records').innerText(), /2026-10-17/);
    await click('治疗与预后');
    await measure('.treatment-trends', 'treatment', width);
  }
});
