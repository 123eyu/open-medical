import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fixture} from './helpers.mjs';
async function setup(t){
 const f=await fixture(t,{followupOptions:{autoStart:false}});
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.SHOW_BROWSER!=='1'});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1366,height:900}});page.setDefaultTimeout(10000);page.on('dialog',d=>d.accept());
 const errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));
 await page.addInitScript(()=>{window.navRecords=[];for(const method of ['pushState','replaceState']){const original=history[method].bind(history);history[method]=(...args)=>{window.navRecords.push({method,url:String(args[2])});return original(...args);};}addEventListener('popstate',()=>window.navRecords.push({method:'popstate',url:location.href}));});
 const api=async(path,method,data)=>{const r=await f.json(path,method,data);assert.ok(r.status<400,JSON.stringify(r));return r.data;};
 const click=name=>page.getByRole('button',{name,exact:true}).click();
 const evidence=async name=>{if(process.env.EVIDENCE_DIR){mkdirSync(process.env.EVIDENCE_DIR,{recursive:true});await page.screenshot({path:`${process.env.EVIDENCE_DIR}/${name}.png`,fullPage:true});writeFileSync(`${process.env.EVIDENCE_DIR}/${name}.json`,JSON.stringify(await page.evaluate(()=>({url:location.href,title:document.title,historyLength:history.length,events:window.navRecords})),null,2));}};
 const settled=()=>page.waitForLoadState('networkidle');
 return {f,page,api,click,evidence,settled};
}

test('patient task navigation has one history entry and back-forward restores task and patient after reload',async t=>{
 const {f,page,api,click,evidence,settled}=await setup(t);const p=await api('/api/patients','POST',{name:'虚构历史甲',patientNumber:'HISTORY-A'});
 await page.goto(`${f.origin}/?view=patients&patient=${p.id}&tab=assistance`);await page.getByRole('textbox',{name:'本次诊疗问题'}).fill('请核对用药信息');await click('准备诊疗评估');await page.getByText(/当前尚未执行/).waitFor();await click('发送任务');await click('查看结果');await settled();
 const taskURL=page.url();await page.reload();await click('查看结果');await settled();const before=await page.evaluate(()=>history.length);await click('患者档案');await page.getByRole('heading',{name:'患者概览',exact:true}).waitFor();await settled();
 assert.equal(await page.evaluate(()=>history.length),before+1,'one user navigation adds exactly one entry');const patientURL=page.url();assert.equal(new URL(patientURL).searchParams.get('patient'),p.id);assert.equal(new URL(patientURL).searchParams.get('tab'),'overview');await evidence('history-patient');
 await page.evaluate(()=>window.navRecords=[]);
 await page.goBack();await page.locator('.conversation-head h1').filter({hasText:p.name}).waitFor();await settled();assert.equal(page.url(),taskURL);await click('查看结果');await evidence('history-back-task');
 await page.goBack();await page.getByRole('textbox',{name:'本次诊疗问题'}).waitFor();await settled();assert.equal(new URL(page.url()).searchParams.get('tab'),'assistance');
 await page.goForward();await page.locator('.conversation-head h1').filter({hasText:p.name}).waitFor();await settled();assert.equal(page.url(),taskURL);
 await page.goForward();await page.getByRole('heading',{name:'患者概览',exact:true}).waitFor();await settled();assert.equal(page.url(),patientURL);assert.match(await page.title(),/虚构历史甲.*HISTORY-A/);assert.equal(await page.evaluate(()=>window.navRecords.filter(e=>e.method==='pushState').length),0,'history restoration must never push a new entry');await evidence('history-forward-patient');
 await page.reload();await page.getByRole('heading',{name:'患者概览',exact:true}).waitFor();await page.goBack();await page.locator('.conversation-head h1').filter({hasText:p.name}).waitFor();await settled();assert.equal(page.url(),taskURL);assert.equal((await api(`/api/sessions/${p.sessionId}`)).artifacts.length,1);
 // Historical/bookmarked links without tab must normalize in place too.
 await page.goto(`${f.origin}/?view=patients&patient=${p.id}`);await page.getByRole('heading',{name:'患者概览',exact:true}).waitFor();await settled();assert.equal(await page.evaluate(()=>window.navRecords.filter(e=>e.method==='pushState').length),0);await page.goBack();await page.locator('.conversation-head h1').filter({hasText:p.name}).waitFor();await settled();assert.equal(page.url(),taskURL);await page.goForward();await page.getByRole('heading',{name:'患者概览',exact:true}).waitFor();await settled();assert.equal(new URL(page.url()).searchParams.get('patient'),p.id);await evidence('history-legacy-forward');
});

test('multiple patient back-forward steps retain each medication draft and saved data',async t=>{
 const {f,page,api,click,evidence,settled}=await setup(t);const a=await api('/api/patients','POST',{name:'虚构草稿甲'}),b=await api('/api/patients','POST',{name:'虚构草稿乙'});
 await page.goto(`${f.origin}/?view=patients`);await page.locator('.patient-card').filter({hasText:a.name}).click();await click('治疗与预后');await click('编辑用药与过敏');await page.getByPlaceholder('药名',{exact:true}).fill('甲的虚构药草稿');await click('← 返回列表');await page.locator('.patient-card').filter({hasText:b.name}).click();await click('治疗与预后');await click('编辑用药与过敏');assert.equal(await page.getByPlaceholder('药名',{exact:true}).inputValue(),'');await page.getByPlaceholder('药名',{exact:true}).fill('乙的虚构药草稿');await settled();const bURL=page.url();
 await page.evaluate(()=>window.navRecords=[]);
 await page.goBack();await page.getByRole('heading',{name:'患者概览',exact:true}).waitFor();await settled();assert.equal(new URL(page.url()).searchParams.get('patient'),b.id);
 await page.goBack();await page.locator('.patient-card').filter({hasText:a.name}).waitFor();await settled();assert.equal(new URL(page.url()).searchParams.has('patient'),false);
 await page.goBack();await page.getByPlaceholder('药名',{exact:true}).waitFor();await settled();assert.equal(new URL(page.url()).searchParams.get('patient'),a.id);assert.equal(await page.getByPlaceholder('药名',{exact:true}).inputValue(),'甲的虚构药草稿');await evidence('history-draft-a');
 await page.goForward();await page.locator('.patient-card').filter({hasText:b.name}).waitFor();await settled();await page.goForward();await page.getByRole('heading',{name:'患者概览',exact:true}).waitFor();await settled();await page.goForward();await page.getByPlaceholder('药名',{exact:true}).waitFor();await settled();assert.equal(page.url(),bURL);assert.equal(await page.getByPlaceholder('药名',{exact:true}).inputValue(),'乙的虚构药草稿');assert.equal(await page.evaluate(()=>window.navRecords.filter(e=>e.method==='pushState').length),0);await evidence('history-draft-b');
 await page.locator('.clinical-add-med').getByRole('button',{name:'添加',exact:true}).click();await page.getByText('乙的虚构药草稿',{exact:true}).waitFor();await click('返回记录');await page.reload();await page.getByText('乙的虚构药草稿',{exact:true}).waitFor();assert.deepEqual((await api(`/api/patients/${a.id}`)).medications,[]);assert.equal((await api(`/api/patients/${b.id}`)).medications[0].name,'乙的虚构药草稿');
});

test('patient list scroll position survives browser back-forward restoration',async t=>{
 const {f,page,api,click,settled,evidence}=await setup(t);
 for(let i=0;i<24;i++)await api('/api/patients','POST',{name:`虚构列表患者${String(i).padStart(2,'0')}`});
 await page.goto(`${f.origin}/?view=patients`);const card=page.locator('.patient-card').last();await card.scrollIntoViewIfNeeded();await settled();const offset=await page.locator('.patients-view').evaluate(e=>e.scrollTop);assert.ok(offset>100,`list scroll must be exercised: ${offset}`);await card.click();await page.getByRole('heading',{name:'患者概览',exact:true}).waitFor();await settled();const patientURL=page.url();
 await page.goBack();await page.locator('.patient-card').last().waitFor();await settled();assert.ok(Math.abs(await page.locator('.patients-view').evaluate(e=>e.scrollTop)-offset)<3);await evidence('history-list-position');
 await page.goForward();await page.getByRole('heading',{name:'患者概览',exact:true}).waitFor();await settled();assert.equal(page.url(),patientURL);await click('← 返回列表');await page.locator('.patient-card').last().waitFor();
});
