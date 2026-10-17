import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { fixture } from './helpers.mjs';
import { openIntake } from './navigation-ui.mjs';

test('lost intake confirmation response retries into the sole saved patient and survives refresh', {timeout:60000}, async t => {
  const f = await fixture(t);
  const session = await f.session('上传资料建档');
  const upload = (await f.json(`/api/sessions/${session.id}/files`,'POST',{name:'虚构确认重试.txt',text:'仅用于软件测试的虚构患者资料'})).data;
  const draft = f.server.pendingActions.propose({type:'patient-create',summary:'虚构确认重试',payload:{name:'虚构确认重试患者',sourceSessionId:session.id,sourceFileIds:[upload.file?.id || upload.id]}});
  const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  t.after(()=>browser.close());
  const page = await browser.newPage();
  await page.goto(f.origin+'/?view=patients'); await openIntake(page);
  const dialog = page.getByRole('dialog',{name:'上传资料建档'});
  await dialog.getByRole('button',{name:'核对这份草稿',exact:true}).click();
  let confirmed;
  await page.route(`**/api/pending-actions/${draft.id}/confirm`,async route=>{
    const response = await route.fetch(); confirmed = await response.json();
    assert.equal(response.status(),200); await route.abort('failed');
  },{times:1});
  await dialog.getByRole('button',{name:'确认建档',exact:true}).click();
  await dialog.getByText('Failed to fetch',{exact:true}).waitFor();
  assert.equal((await f.json('/api/patients')).data.patients.length,1);
  await dialog.getByRole('button',{name:'确认建档',exact:true}).click();
  await page.getByRole('button',{name:'← 返回列表',exact:true}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('patient'),confirmed.applied.id);
  await page.reload(); await page.getByRole('button',{name:'← 返回列表',exact:true}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('patient'),confirmed.applied.id);
  assert.equal((await f.json('/api/patients')).data.patients.length,1);
  assert.equal((await f.json(`/api/sessions/${confirmed.applied.sessionId}`)).data.files.length,1);
});
