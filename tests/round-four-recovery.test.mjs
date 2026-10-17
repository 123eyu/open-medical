import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.mjs';
import {DeepSeekProvider} from '../server/provider.mjs';
import {ModelChoices} from '../server/core/model-choices.mjs';

const until = async fn => {
 const end=Date.now()+5000;
 while (Date.now()<end) { const value=await fn(); if(value) return value; await new Promise(r=>setTimeout(r,10)); }
 throw new Error('Expected state not reached');
};
test('disconnecting chat keeps both session engines running; explicit cancel remains available',async t=>{
 const provider=new DeepSeekProvider({apiKey:'synthetic',model:'probe'});
 let entered,release;
 provider.complete=async(_m,_t,{signal}={})=>new Promise((resolve,reject)=>{
  entered=true;release=resolve;signal.addEventListener('abort',()=>reject(new Error('synthetic abort')),{once:true});
 });
 const f=await fixture(t,{provider});
 for(const create of [f.session,f.legacy]) {
  const session=await create('虚构断线恢复');entered=false;
  const controller=new AbortController();
  const res=await fetch(`${f.origin}/api/chat/${session.id}`,{method:'POST',signal:controller.signal,headers:{'content-type':'application/json','x-medical-token':f.server.token},body:JSON.stringify({message:'虚构连接测试，不给医疗结论',mode:'standard',externalConsent:true})});
  assert.equal(res.status,200);await until(()=>entered);
  controller.abort(); await res.text().catch(()=>{});
  assert.equal((await f.json(`/api/sessions/${session.id}`)).data.runs.at(-1).status,'running');
  release({message:{role:'assistant',content:'合成完成，非医疗结论'}});
  await until(async()=> (await f.json(`/api/sessions/${session.id}`)).data.runs.at(-1).status==='completed');
 }
 const session=await f.session('虚构主动停止');entered=false;
 const pending=f.chat(session.id,'虚构主动停止验证',{mode:'standard',externalConsent:true});
 await until(()=>entered);
 assert.equal((await f.json(`/api/chat/${session.id}/cancel`,'POST',{})).data.cancelled,true);
 await pending;
 const run=(await f.json(`/api/sessions/${session.id}`)).data.runs.at(-1);
 assert.equal(run.status,'cancelled');assert.match(run.error,/由你停止/);assert.doesNotMatch(run.error,/执行失败|检查模型/);
});

test('local medication check reads the associated patient record and preserves unknowns and source hashes',async t=>{
 const f=await fixture(t);
 const a=(await f.json('/api/patients','POST',{name:'虚构甲',patientNumber:'R4-A',medications:[{name:'虚构药甲',dose:'5mg',frequency:'每日一次',status:'active'}]})).data;
 const b=(await f.json('/api/patients','POST',{name:'虚构乙',patientNumber:'R4-B',medications:[{name:'虚构药乙',dose:'7mg',frequency:'每周一次',status:'active'}]})).data;
 for (const p of [a,b]) {
  await f.chat(p.sessionId,'请核对用药信息',{mode:'local'});
  const s=(await f.json(`/api/sessions/${p.sessionId}`)).data, art=s.artifacts.at(-1);
  assert.equal(art.type,'medication_review');
  const source=art.matches.filter(m=>m.sourceName==='当前患者已登记档案');
  assert.ok(source.some(m=>m.quote.includes(p.id===a.id?'5mg':'7mg')));
  assert.ok(source.every(m=>m.sourceId===`patient-record:${p.id}` && /^[a-f0-9]{64}$/.test(m.hash)));
  assert.ok(art.information.some(row=>row.name.endsWith(' · 频次') && row.status==='材料中有记载'));
  assert.ok(art.missing.some(name=>name.endsWith(' · 途径')));
  assert.ok(source.some(m=>m.quote.includes(p.id===a.id?'每日一次':'每周一次')));
  assert.ok(art.missing.includes('过敏史'));
  assert.doesNotMatch(JSON.stringify(art),p.id===a.id?/虚构药乙|7mg/:/虚构药甲|5mg/);
 }
});

test('local discovery reports unavailable vs empty, unknown image support and nonsecret service identity',async()=>{
 const settings={provider:()=>({}),saved:{}},profiles={all:()=>({})};
 const failed=new ModelChoices(settings,profiles,{fetchImpl:async()=>{throw Error('offline')}});
 assert.equal((await failed.list()).discovery.status,'unavailable');
 const empty=new ModelChoices(settings,profiles,{fetchImpl:async()=>({ok:true,json:async()=>({models:[]})})});
 assert.equal((await empty.list()).discovery.status,'empty');
 const loaded=new ModelChoices(settings,profiles,{fetchImpl:async()=>({ok:true,json:async()=>({models:[{name:'synthetic'}]})})});
 const result=await loaded.list();assert.equal(result.discovery.status,'ready');assert.equal(result.choices[0].vision,null);assert.equal(result.choices[0].baseUrl,'http://127.0.0.1:11434/v1');assert.equal('apiKey' in result.choices[0],false);
});

test('remote endpoint cannot be saved as a local model to bypass connection consent',async t=>{
 const f=await fixture(t);
 const before=(await f.json('/api/model-settings')).data;
 const rejected=await f.json('/api/model-settings','PUT',{provider:'local',baseUrl:'https://synthetic.invalid/v1',model:'remote'});
 assert.equal(rejected.status,400);assert.match(rejected.data.error,/回环地址/);
 assert.deepEqual((await f.json('/api/model-settings')).data,before);
});

test('connection probe shares one 30-second deadline across text, tools and JSON', {timeout:40000},async t=>{
 const {createServer}=await import('node:http');let calls=0;
 const upstream=createServer(async(req,res)=>{
  for await(const _ of req) { /* consume request */ }
  calls++;
  const timer=setTimeout(()=>{
   res.writeHead(200,{'content-type':'text/event-stream'});
   res.end('data: '+JSON.stringify({choices:[{index:0,delta:{content:'OK'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
  },17000);
  res.on('close',()=>clearTimeout(timer));
 });
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 t.after(()=>{upstream.closeAllConnections();return new Promise(r=>upstream.close(r));});
 const f=await fixture(t);
 const start=Date.now();const result=await f.json('/api/model-settings/test','POST',{provider:'local',baseUrl:`http://127.0.0.1:${upstream.address().port}/v1`,model:'synthetic',maxTokens:256,timeoutMs:90000});
 const elapsed=Date.now()-start;t.diagnostic(`shared probe deadline elapsed=${elapsed}ms calls=${calls}`);
 assert.equal(result.status,200);assert.equal(result.data.checks[0].ok,true);assert.equal(result.data.checks[1].ok,false);assert.equal(result.data.checks[2].ok,false);
 assert.equal(calls,2,'deadline prevents starting JSON probe');assert.ok(elapsed>=29000 && elapsed<33000,`${elapsed}ms`);
});

test('model source labels omit credentials and query strings from legacy environment URLs',async()=>{
 const config={provider:'openai-compatible',model:'synthetic',apiKey:'synthetic-key',baseUrl:'https://private-user:private-password@synthetic.invalid/v1?token=private-query#private-fragment'};
 const picker=new ModelChoices({saved:config,provider:()=>config},{all:()=>({sameName:{...config,baseUrl:'https://another.invalid/v1'}})},{fetchImpl:async()=>{throw Error('offline')}});
 const result=await picker.list();assert.equal(result.choices[0].baseUrl,'https://synthetic.invalid/v1');assert.equal(result.choices[1].baseUrl,'https://another.invalid/v1');assert.doesNotMatch(JSON.stringify(result),/private-user|private-password|private-query|private-fragment|synthetic-key/);
});
