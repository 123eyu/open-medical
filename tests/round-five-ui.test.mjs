import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {mkdirSync} from 'node:fs';
import {fixture} from './helpers.mjs';
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
async function setup(t) {
 const f=await fixture(t,{followupOptions:{autoStart:false}});
 const browser=await chromium.launch({executablePath:chrome,headless:process.env.SHOW_BROWSER!=='1'});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1366,height:900}});page.setDefaultTimeout(10000);page.on('dialog',d=>d.accept());
 const api=async(path,method,data)=>{const r=await f.json(path,method,data);assert.ok(r.status<400,JSON.stringify(r));return r.data;};
 const p=await api('/api/patients','POST',{name:'虚构复诊核对',birthYear:1970});
 const open=async(tab='overview',target=p,window=page)=>{await window.goto(`${f.origin}/?view=patients&patient=${target.id}&tab=${tab}`);await window.getByRole('button',{name:'← 返回列表',exact:true}).waitFor();};
 const click=name=>page.getByRole('button',{name,exact:true}).click();
 const shot=async name=>{if(process.env.EVIDENCE_DIR){mkdirSync(process.env.EVIDENCE_DIR,{recursive:true});await page.screenshot({path:`${process.env.EVIDENCE_DIR}/${name}.png`,fullPage:true});}};
 return {f,browser,page,api,p,open,click,shot};
}

test('keyboard registration cancel restores its trigger; visit date has a required accessible name',async t=>{
 const {f,page,open,click,shot}=await setup(t);
 await page.goto(f.origin+'/?view=patients');const trigger=page.getByRole('button',{name:'手动建档',exact:true});await trigger.focus();await page.keyboard.press('Enter');await page.getByRole('dialog').waitFor();
 for(let i=0;i<16;i++){await page.keyboard.press(i%2?'Shift+Tab':'Tab');assert.ok(await page.evaluate(()=>!!document.activeElement.closest('[role=dialog]')));}
 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);
 await open('visits');await click('编辑记录');const date=page.getByLabel('就诊日期（必填）');assert.equal(await date.getAttribute('required'),'');await date.fill('2026-10-17');await page.getByPlaceholder('就诊事由',{exact:true}).fill('虚构复诊核对');await click('添加');await page.getByText(/2026-10-17 · 虚构复诊核对/).waitFor();await click('返回记录');await page.reload();await page.getByRole('heading',{name:'虚构复诊核对',exact:true}).waitFor();await shot('optimized-visit');
});

test('summary conflict preserves every field and can reconcile a second concurrent update',async t=>{
 const {page,api,p,open,click,shot}=await setup(t);await open('diagnoses');await click('补充摘要');
 for(const [label,value] of [['当前状态','虚构当前状态'],['主要问题','虚构主要问题'],['病程演变','虚构病程演变'],['病史摘要来源','虚构门诊记录']])await page.getByRole('textbox',{name:new RegExp(label)}).fill(value);
 const changed=await api(`/api/patients/${p.id}`,'PATCH',{expectedRevision:p.revision,note:'远端第一版备注'});
 await click('保存摘要');await page.getByRole('region',{name:'摘要版本核对'}).waitFor();await page.setViewportSize({width:320,height:740});await click('Aa · 切换字号（标准/大/特大）');await click('Aa · 切换字号（标准/大/特大）');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await shot('optimized-summary-conflict');await click('确认摘要选择并继续编辑');
 await api(`/api/patients/${p.id}`,'PATCH',{expectedRevision:changed.revision,note:'远端第二版备注'});
 await click('保存摘要');await page.getByRole('region',{name:'摘要版本核对'}).waitFor();assert.equal(await page.getByRole('textbox',{name:/当前状态/}).inputValue(),'虚构当前状态');await click('确认摘要选择并继续编辑');await click('保存摘要');await page.getByRole('button',{name:'保存摘要',exact:true}).waitFor({state:'hidden'});
 await click('← 返回列表');await page.locator('.patient-card').filter({hasText:p.name}).click();await click('诊断与病史');await page.reload();const saved=await api(`/api/patients/${p.id}`);assert.equal(saved.note,'远端第二版备注');assert.equal(saved.clinicalSummary.source,'虚构门诊记录');for(const text of ['虚构当前状态','虚构主要问题','虚构病程演变']){assert.ok(saved.clinicalSummary.text.includes(text));await page.getByText(text,{exact:true}).waitFor();}await shot('optimized-summary-saved');
});

test('lab conflict reload keeps the pending addition, other patient and remote records',async t=>{
 const {page,api,p,open,click,shot}=await setup(t);await open('labs');await click('编辑记录');
 for(const [placeholder,value] of [['项目','本地虚构指标'],['数值','0'],['单位','mg/L']])await page.getByPlaceholder(placeholder,{exact:true}).fill(value);
 await page.getByLabel('检验日期（采样日，必填）').fill('2026-10-16');await page.getByLabel('检验来源',{exact:true}).fill('虚构报告');await page.getByLabel('检验备注',{exact:true}).fill('虚构备注');
 await api(`/api/patients/${p.id}`,'PATCH',{expectedRevision:p.revision,labs:[{item:'远端虚构指标',value:9,date:'2026-10-17'}]});await click('添加');await page.getByRole('region',{name:'临床记录版本核对'}).waitFor();await shot('optimized-lab-conflict');
 // A failed reload must leave the draft and recovery action usable.
 await page.route(`**/api/patients/${p.id}`,r=>r.request().method()==='GET'?r.fulfill({status:503,json:{error:'合成读取故障'}}):r.continue());await click('保留输入并载入最新记录');await page.getByRole('alert').filter({hasText:/读取最新记录失败/}).waitFor();await page.unroute(`**/api/patients/${p.id}`);
 await click('保留输入并载入最新记录');await page.getByText('远端虚构指标',{exact:true}).waitFor();assert.equal(await page.getByPlaceholder('项目',{exact:true}).inputValue(),'本地虚构指标');assert.equal(await page.getByLabel('检验来源',{exact:true}).inputValue(),'虚构报告');await click('添加');await page.getByText('本地虚构指标',{exact:true}).waitFor();await click('返回记录');await page.reload();
 const saved=await api(`/api/patients/${p.id}`);assert.equal(saved.labs.length,2);assert.deepEqual(saved.labs.find(l=>l.item==='本地虚构指标'),{item:'本地虚构指标',value:0,unit:'mg/L',date:'2026-10-16',source:'虚构报告',note:'虚构备注'});
 const other=await api('/api/patients','POST',{name:'虚构另一患者'});await open('labs',other);assert.equal(await page.getByText('本地虚构指标',{exact:true}).count(),0);await open('labs');await page.getByText('本地虚构指标',{exact:true}).first().waitFor();await shot('optimized-labs-saved');
});

test('two material editors recover date and OCR conflicts without losing local or latest text',async t=>{
 const {browser,page,api,p,open,click,shot}=await setup(t);
 const image=await api(`/api/sessions/${p.sessionId}/files`,'POST',{name:'虚构报告.png',image:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='});
 await api(`/api/sessions/${p.sessionId}/files/${image.id}/text`,'PUT',{expectedRevision:0,text:'原始虚构记录：未诉胸痛。'});
 await open('library');await page.getByText('类型与资料日期',{exact:true}).click();const other=await browser.newPage();other.on('dialog',d=>d.accept());await open('library',p,other);await other.getByText('类型与资料日期',{exact:true}).click();
 await other.getByLabel('资料日期',{exact:true}).fill('2026-10-10');await other.getByText('资料信息已保存',{exact:true}).waitFor();await page.getByLabel('资料日期',{exact:true}).fill('2026-10-11');await page.getByRole('region',{name:'资料信息版本核对'}).waitFor();await page.getByText('最新：其他 · 2026-10-10',{exact:true}).waitFor();await page.setViewportSize({width:320,height:740});await click('Aa · 切换字号（标准/大/特大）');await click('Aa · 切换字号（标准/大/特大）');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await shot('optimized-material-date-conflict');
 assert.equal((await api(`/api/sessions/${p.sessionId}`)).files[0].documentDate,'2026-10-10');await click('核对后保存本地修改');await page.getByText('资料信息已保存',{exact:true}).waitFor();await other.reload();
 await click('修正文字');await other.getByRole('button',{name:'修正文字',exact:true}).click();await page.getByRole('textbox',{name:/修正.*识别文本/}).fill('本地补充：否认胸痛。');await other.getByRole('textbox',{name:/修正.*识别文本/}).fill('最新核对：未诉胸痛，未诉发热。');await other.getByRole('button',{name:'保存修正',exact:true}).click();await other.getByRole('button',{name:'保存修正',exact:true}).waitFor({state:'hidden'});
 await click('保存修正');await page.getByRole('region',{name:'识别文字版本核对'}).waitFor();assert.equal(await page.getByRole('textbox',{name:/修正.*识别文本/}).inputValue(),'本地补充：否认胸痛。');await page.getByRole('region',{name:'识别文字版本核对'}).getByText('最新核对：未诉胸痛，未诉发热。',{exact:true}).waitFor();await shot('optimized-ocr-conflict');
 await click('已核对最新文字，继续编辑');await page.getByRole('textbox',{name:/修正.*识别文本/}).fill('已合并：否认胸痛，未诉发热；本地补充已核对。');await click('保存修正');await page.getByRole('button',{name:'保存修正',exact:true}).waitFor({state:'hidden'});await click('← 返回列表');await page.locator('.patient-card').filter({hasText:p.name}).click();await click('资料库');await page.reload();await page.getByText('已合并：否认胸痛，未诉发热；本地补充已核对。',{exact:true}).waitFor();
 const saved=(await api(`/api/sessions/${p.sessionId}`)).files[0];assert.equal(saved.documentDate,'2026-10-11');assert.equal(saved.text,'已合并：否认胸痛，未诉发热；本地补充已核对。');await shot('optimized-material-saved');
});

test('visible local medication task shows missing fields and known birth year through return and refresh',async t=>{
 const {page,api,p,open,click,shot}=await setup(t);
 const run=async()=>{await open('assistance');await page.getByRole('textbox',{name:'本次诊疗问题'}).fill('请核对当前用药信息');await click('准备诊疗评估');await page.getByText(/当前尚未执行/).waitFor();await click('发送任务');await page.getByRole('button',{name:'查看结果',exact:true}).first().click();};
 await api(`/api/patients/${p.id}`,'PATCH',{expectedRevision:p.revision,labs:[{item:'虚构指标',value:5,unit:'mg/L',date:'2026-10-16'}]});await run();await page.getByText(/出生年：1970/).first().waitFor();await page.getByText(/不能确定周岁/).first().waitFor();await page.getByText(/药品名称：未明确/).first().waitFor();await shot('optimized-no-medications');
 await click('患者档案');await page.reload();await open('medications');await click('编辑用药与过敏');await page.getByPlaceholder('药名',{exact:true}).fill('虚构甲药');await page.getByPlaceholder('剂量',{exact:true}).fill('2mg');await page.getByPlaceholder('频次',{exact:true}).fill('每日一次');await page.locator('.clinical-add-med').getByRole('button',{name:'添加',exact:true}).click();await page.getByText('虚构甲药',{exact:true}).waitFor();await click('返回记录');await run();
 await page.getByText(/虚构甲药 · 频次：材料中有记载/).first().waitFor();await page.getByText(/虚构甲药 · 途径：未明确/).first().waitFor();await shot('optimized-medication-fields');await click('患者档案');await page.reload();await page.getByRole('heading',{name:'患者概览',exact:true}).waitFor();
});
