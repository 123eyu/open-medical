import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.mjs';
import {artifactLines} from '../shared/medical.mjs';
import {DeepSeekProvider} from '../server/core/providers.mjs';

test('local medication review separates labs, each drug field and birth-year precision', async t=>{
  const f=await fixture(t);
  const p=(await f.json('/api/patients','POST',{name:'虚构核对',birthYear:1970,labs:[{item:'虚构指标',value:5,unit:'mg/L',date:'2026-10-16'}]})).data;
  const review=async()=>{await f.chat(p.sessionId,'请核对用药信息',{mode:'local'});return (await f.json(`/api/sessions/${p.sessionId}`)).data.artifacts.at(-1);};
  const empty=await review();
  assert.equal(empty.matches.length,0);
  assert.ok(empty.missing.includes('药品名称'));assert.ok(empty.missing.includes('规格'));
  const age=empty.information.find(x=>x.name==='年龄');
  assert.equal(age.status,'未明确');assert.match(age.sources[0].quote,/1970/);
  assert.match(artifactLines(empty).join('\n'),/出生年：1970/);assert.match(artifactLines(empty).join('\n'),/不能确定周岁/);
  const saved=await f.json(`/api/patients/${p.id}`,'PATCH',{expectedRevision:p.revision,medications:[{name:'合成甲药',dose:'2mg',frequency:'每日一次',status:'active'},{name:'合成乙药',status:'stopped'}]});
  assert.equal(saved.status,200);
  const meds=await review();
  const field=name=>meds.information.find(x=>x.name===name);
  assert.equal(field('合成甲药 · 剂量').status,'材料中有记载');
  assert.equal(field('合成甲药 · 频次').status,'材料中有记载');
  for(const name of ['合成甲药 · 途径','合成甲药 · 用法','合成甲药 · 规格','合成乙药 · 剂量','合成乙药 · 频次']) assert.equal(field(name).status,'未明确',name);
  assert.match(field('合成乙药 · 剂量').note,/已停用/);
  assert.ok(meds.matches.every(x=>x.sourceId===`patient-record:${p.id}` && /^[a-f0-9]{64}$/.test(x.hash)));
  assert.ok(!meds.matches.some(x=>x.quote.includes('mg/L')));
});

test('material metadata and corrected text reject stale and absent revisions without overwriting either writer',async t=>{
 const f=await fixture(t);const p=(await f.json('/api/patients','POST',{name:'虚构资料并发'})).data;
 const file=(await f.json(`/api/sessions/${p.sessionId}/files`,'POST',{name:'虚构.txt',text:'未诉胸痛'})).data;
 const base=`/api/sessions/${p.sessionId}/files/${file.id}`;
 const one=await f.json(`${base}/meta`,'PATCH',{expectedRevision:0,documentDate:'2026-10-10'});assert.equal(one.status,200);
 for(const expectedRevision of [0,undefined]) {
  assert.equal((await f.json(`${base}/meta`,'PATCH',{expectedRevision,documentDate:'2026-10-11'})).status,409);
  assert.equal((await f.json(`${base}/text`,'PUT',{expectedRevision,text:'有胸痛'})).status,409);
 }
 const text=await f.json(`${base}/text`,'PUT',{expectedRevision:one.data.revision,text:'未诉胸痛，家属补充已核对'});assert.equal(text.status,200);
 assert.equal((await f.json(`${base}/text`,'PUT',{expectedRevision:one.data.revision,text:'第二份未核对文本'})).status,409);
 const final=(await f.json(`/api/sessions/${p.sessionId}`)).data.files[0];
 assert.equal(final.documentDate,'2026-10-10');assert.equal(final.text,'未诉胸痛，家属补充已核对');assert.equal(final.revision,2);
 const recovered=await f.json(`${base}/meta`,'PATCH',{expectedRevision:final.revision,documentDate:'2026-10-11'});assert.equal(recovered.status,200);assert.equal(recovered.data.text,final.text);
});

test('a delayed OCR result cannot overwrite a doctor correction made while recognition runs',async t=>{
 const provider=new DeepSeekProvider({apiKey:'synthetic',model:'synthetic-ocr'});provider.vision=true;
 let release, entered;const started=new Promise(resolve=>{entered=resolve;});
 provider.complete=async()=>{entered();return new Promise(resolve=>{release=()=>resolve({message:{content:'迟到的合成识别文字：患者有胸痛'}});});};
 const f=await fixture(t,{provider});const session=await f.session('虚构识别并发');
 const image=(await f.json(`/api/sessions/${session.id}/files`,'POST',{name:'虚构.png',image:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='})).data;
 const base=`/api/sessions/${session.id}/files/${image.id}`;
 const recognition=f.json(`${base}/prepare`,'POST',{force:true,preferVision:true});
 await started;
 assert.equal((await f.json(`${base}/text`,'PUT',{expectedRevision:0,text:'医生核对：未诉胸痛'})).status,200);
 release();assert.equal((await recognition).status,409);
 assert.equal((await f.json(`/api/sessions/${session.id}`)).data.files[0].text,'医生核对：未诉胸痛');
});
