import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { composeDigest } from '../server/patients.mjs';
const today = () => { const d = new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); };

test('manual messages retain uncertain time and family identity through storage and digest, deduplicate per patient, and reject invalid batches atomically', async t => {
  const f = await fixture(t, {followupOptions:{autoStart:false}});
  const p = (await f.json('/api/patients','POST',{name:'虚构消息甲'})).data;
  const q = (await f.json('/api/patients','POST',{name:'虚构消息乙'})).data;
  const url = `/api/patients/${p.id}/messages`;
  const message = {direction:'in',speaker:'family',rawSpeaker:'家属',timeUnknown:true,time:'',rawTime:'时间待核对',text:'虚构家属代述'};
  assert.equal((await f.json(url,'POST',{messages:[message]})).data.stored,1);
  assert.equal((await f.json(url,'POST',{messages:[message]})).data.duplicates,1);
  assert.equal((await f.json(`/api/patients/${q.id}/messages`,'POST',{messages:[message]})).data.stored,1);
  const list=(await f.json(url)).data.messages;
  assert.equal(list.length,1); assert.equal(list[0].time,''); assert.equal(list[0].speaker,'family'); assert.equal(list[0].rawTime,'时间待核对'); assert.ok(list[0].collectedAt);
  const digest=composeDigest(list); assert.match(digest,/家属代述/); assert.match(digest,/时间待核对/); assert.doesNotMatch(digest,/患者发来/);
  assert.equal((await f.json(url,'POST',{messages:[{...message,text:'不应部分导入'},{direction:'invalid',text:'坏行'}]})).status,400);
  assert.equal((await f.json(url)).data.messages.length,1);
  const insert=f.server.patients.insertMessage.bind(f.server.patients);let calls=0;
  t.mock.method(f.server.patients,'insertMessage',(...args)=>{if (++calls===2) throw new Error('isolated disk failure');return insert(...args);});
  assert.equal((await f.json(url,'POST',{messages:[{...message,text:'回滚甲'},{...message,text:'回滚乙'}]})).status,500);
  assert.equal((await f.json(url)).data.messages.length,1);
});

test('appointments retain full correction history, reject stale edits and archived writes, and restore mistakenly missed results',async t=>{
  const f=await fixture(t,{followupOptions:{autoStart:false}});
  const p=(await f.json('/api/patients','POST',{name:'虚构预约甲'})).data;
  const a=(await f.json(`/api/patients/${p.id}/appointments`,'POST',{date:today(),time:'09:00',place:'虚构门诊一',reason:'原事项'})).data;
  const url=`/api/appointments/${a.id}`;
  const changed=await f.json(url,'PATCH',{expectedRevision:0,time:'15:00',place:'虚构门诊二',reason:'更正事项',correctionReason:'录入错误'});
  assert.equal(changed.status,200);assert.equal(changed.data.time,'15:00');assert.equal(changed.data.history[0].place,'虚构门诊一');assert.equal(changed.data.history[0].reason,'原事项');
  assert.equal((await f.json(url,'PATCH',{expectedRevision:0,time:'16:00'})).status,409);
  const missed=(await f.json(url,'PATCH',{expectedRevision:1,status:'missed'})).data;
  assert.equal((await f.json(url,'PATCH',{expectedRevision:missed.revision,status:'scheduled'})).status,400);
  const corrected=(await f.json(url,'PATCH',{expectedRevision:missed.revision,status:'scheduled',correctionReason:'误点未到诊'})).data;
  assert.equal(corrected.status,'scheduled');assert.equal(corrected.history.at(-1).status,'missed');assert.equal(corrected.history.at(-1).correctionReason,'误点未到诊');
  assert.ok((await f.json('/api/doctor/overview?kind=visit')).data.items.some(i=>i.patientId===p.id));
  let current=corrected;
  for(let i=0;i<22;i++) current=(await f.json(url,'PATCH',{expectedRevision:current.revision,note:`补充${i}`})).data;
  assert.equal(current.history.length,25);
  await f.json(`/api/patients/${p.id}`,'PATCH',{expectedRevision:0,archived:true});
  assert.equal((await f.json(url,'PATCH',{expectedRevision:current.revision,time:'17:00'})).status,409);
  assert.equal((await f.json(`/api/patients/${p.id}/appointments`)).data.appointments[0].time,'15:00');
});

for (const automatic of [false, true]) test(`${automatic ? 'scheduled' : 'manual'} digest sends original speaker and uncertain time to the local provider`,async t=>{
  const calls=[];
  const f=await fixture(t,{provider:{apiKey:'synthetic',model:'local-test',async complete(messages){calls.push(messages);return {message:{role:'assistant',content:'仅返回隔离测试占位结果'},usage:{total_tokens:1}};}},followupOptions:{autoStart:false}});
  const p=(await f.json('/api/patients','POST',{name:'虚构来源甲'})).data;
  await f.json(`/api/patients/${p.id}/messages`,'POST',{messages:[
    {direction:'in',speaker:'family',rawSpeaker:'家属',timeUnknown:true,rawTime:'时间待核对',time:'',text:'合成家属代述A'},
    {direction:'in',speaker:'unknown',rawSpeaker:'未确认联系人',timeUnknown:true,rawTime:'未提供',time:'',text:'合成未知来源B'},
    {direction:'in',speaker:'patient',time:new Date().toISOString(),text:'合成本人反馈C'}]});
  const brief=(await f.json(`/api/patients/${p.id}/brief`)).data;
  const family=brief.messages.find(m=>m.text==='合成家属代述A');assert.equal(family.speaker,'family');assert.equal(family.timeUnknown,true);assert.equal(family.rawSpeaker,'家属');assert.ok(family.collectedAt);assert.equal(family.at,'');
  if(automatic){
    const job=(await f.json(`/api/patients/${p.id}/followups`,'POST',{name:'虚构来源摘要',intervalDays:7,firstDueAt:new Date(Date.now()+1000).toISOString(),externalConsent:true})).data;
    assert.equal((await f.server.followups.execute(job)).digest,true);
  }else assert.equal((await f.json(`/api/patients/${p.id}/messages/digest`,'POST',{externalConsent:true})).data.status,'completed');
  assert.ok(calls.length);const input=calls.flat().filter(m=>m.role==='user').map(m=>m.content).join('\n');
  assert.match(input,/家属代述.*合成家属代述A/);assert.match(input,/身份待核对.*合成未知来源B/);assert.match(input,/患者本人.*合成本人反馈C/);assert.match(input,/时间待核对（原文：时间待核对；采集时间：/);
  assert.doesNotMatch(input,/患者本人[^\n]*合成家属代述A/);
});

test('care projections, triage and follow-up extraction preserve speaker and uncertain timestamps',async t=>{
  const {triageMessages,extractFollowup}=await import('../server/care/triage.mjs');
  const {careTools}=await import('../server/care/tools.mjs');
  const f=await fixture(t,{followupOptions:{autoStart:false}});
  const p=(await f.json('/api/patients','POST',{name:'虚构沟通来源甲'})).data;
  await f.json(`/api/patients/${p.id}/messages`,'POST',{messages:[{direction:'in',speaker:'family',rawSpeaker:'家属',timeUnknown:true,time:'',rawTime:'时间未知',text:'合成代述原文'}]});
  const m=(await f.json(`/api/patients/${p.id}/messages`)).data.messages[0];
  assert.equal(f.server.care.message(m.id).speaker,'family');
  const thread=f.server.care.thread(p.id,m.id);assert.equal(thread[0].rawTime,'时间未知');assert.equal(thread[0].time,'');
  const triage=triageMessages({thread,knowledge:[]});assert.match(triage[1].content,/家属代述/);assert.match(triage[1].content,/时间待核对/);assert.doesNotMatch(triage[1].content,/"方向":"患者"/);
  let input;await extractFollowup({async complete(messages){input=messages[1].content;return {message:{content:'{"summary":"合成摘要","needsDoctor":false}'}};}},{questions:[],text:'合成随访',replies:thread});assert.match(input,/家属代述/);assert.match(input,/时间待核对/);
  const tool=careTools(()=>f.server.care).find(t=>t.definition.function.name==='care_patient_thread');const result=tool.execute({patientId:p.id});assert.equal(result.messages[0].speaker,'family');assert.equal(result.messages[0].rawTime,'时间未知');
});

test('pasted messages do not invent dates, normalize impossible calendar dates, or split plain paragraphs into speakers',async()=>{
  const {parsePastedMessages}=await import('../shared/message-import.mjs');
  for(const rawTime of ['时间待核对','2026-02-30 10:00','10:00','2026-13-01 10:00']){
    const [m]=parsePastedMessages(`${rawTime} | 家属 | 合成原文`);assert.equal(m.timeUnknown,true);assert.equal(m.time,'');assert.equal(m.rawTime,rawTime);assert.equal(m.speaker,'family');
  }
  const [known]=parsePastedMessages('2026-02-28 10:00 | 患者 | 合成已知');assert.equal(known.timeUnknown,false);assert.equal(known.speaker,'patient');
  const [unknown]=parsePastedMessages('2026-02-28 10:00 | 未核实联系人 | 合成未知');assert.equal(unknown.speaker,'unknown');assert.equal(unknown.rawSpeaker,'未核实联系人');
  const paragraph='合成第一段\n合成第二段';const values=parsePastedMessages(paragraph);assert.equal(values.length,1);assert.equal(values[0].text,paragraph);assert.equal(values[0].speaker,'unknown');
});

for (const timeUnknown of [false, true]) test(`manual deduplication preserves distinct original family speakers with ${timeUnknown ? 'unknown' : 'known'} message time`, async t => {
  const f = await fixture(t, { followupOptions: { autoStart: false } });
  const p = (await f.json('/api/patients', 'POST', { name: '虚构家属去重边界' })).data;
  const url = `/api/patients/${p.id}/messages`;
  const messages = ['母亲', '父亲'].map(rawSpeaker => ({ direction: 'in', speaker: 'family', rawSpeaker,
    timeUnknown, time: timeUnknown ? '' : '2026-10-17T01:00:00.000Z', rawTime: timeUnknown ? '时间待核对' : '2026-10-17 09:00', text: '合成同文反馈' }));
  const first = await f.json(url, 'POST', { messages });
  assert.equal(first.data.stored, 2); assert.equal(first.data.duplicates, 0);
  const replay = await f.json(url, 'POST', { messages });
  assert.equal(replay.data.stored, 0); assert.equal(replay.data.duplicates, 2);
  const another = await f.json(url, 'POST', { messages: [{ ...messages[0], rawSpeaker: '配偶' }] });
  assert.equal(another.data.stored, 1); assert.equal(another.data.duplicates, 0);
  const stored = (await f.json(url)).data.messages;
  assert.equal(stored.length, 3); assert.deepEqual(stored.map(m => m.rawSpeaker).sort(), ['母亲', '父亲', '配偶'].sort());
  const scheduled = f.server.followups.pendingMessages(p);
  const brief = (await f.json(`/api/patients/${p.id}/brief`)).data;
  for (const projection of [stored, scheduled, brief.messages]) assert.deepEqual(projection.map(m => m.rawSpeaker).sort(), ['母亲', '父亲', '配偶'].sort());
  for (const input of [composeDigest(stored), composeDigest(scheduled)]) for (const role of ['母亲', '父亲', '配偶']) assert.ok(input.includes(`原始发言人：${role}`));
});
