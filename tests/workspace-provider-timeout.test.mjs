import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
for (const wrapped of [false, true]) test(`provider timeout is actionable and remains failed (wrapped=${wrapped})`, async t => {
  const provider = {apiKey:'synthetic',model:'synthetic-timeout',timeoutMs:90000,async complete(){
    const error = new DOMException('no model response','TimeoutError');
    throw wrapped ? new Error('aborted', {cause:error}) : error;
  }};
  const f = await fixture(t, {provider});
  const session = await f.session();
  const result = await f.chat(session.id, '合成测试任务', {mode:"standard",externalConsent:true,sessionRevision:session.revision});
  assert.equal(result.status,200);
  assert.match(result.text,/PROVIDER_TIMEOUT/);
  assert.match(result.text,/90 秒未响应/);
  const saved = (await f.json(`/api/sessions/${session.id}`)).data;
  assert.equal(saved.runs.at(-1).status,'failed');
});
