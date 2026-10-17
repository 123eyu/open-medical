import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import ExcelJS from "exceljs";
import { fixture } from "./helpers.mjs";
import {
  organizerProvider,
  library,
  waitJob,
} from "./knowledge-organization-helpers.mjs";
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
test("knowledge citation opens the cited lines and warns when the source version changed", {skip:!existsSync(chrome)}, async t => {
  const f=await fixture(t);
  await library(f,"引用核验");
  const doc=await f.server.guidelines.addDocument({title:"引用原文",collection:"引用核验",text:"标题\n适用于成人，不适用于儿童。\n参考范围需按实验室核对。"});
  const read=f.server.guidelines.readLines(doc.id,2,2);
  const browser=await chromium.launch({executablePath:chrome,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.goto(f.origin+read.citationUrl);
  await page.locator('.guideline-line.matched[data-line="2"]').waitFor();
  assert.match(await page.locator('.guideline-line.matched').innerText(),/不适用于儿童/);
  assert.equal(await page.locator('.guideline-line.matched').count(),1);
  await page.goto(f.origin+read.citationUrl.replace(doc.sha256,'outdated'));
  await page.getByRole('alert').filter({hasText:'原文已更新'}).waitFor();
  await page.goto(f.origin+read.citationUrl.replace('line=2','line=999'));
  await page.getByRole('alert').filter({hasText:'引用行号已失效'}).waitFor();
});
test("long citations stay visible after delayed text reflow", {skip:!existsSync(chrome)},async t=>{
  const f=await fixture(t);await library(f,"长文引用");
  const doc=await f.server.guidelines.addDocument({title:"长文来源",collection:"长文引用",text:Array.from({length:350},(_,i)=>`原文段落 ${i+1}：软件定位测试。`).join("\n")});
  const browser=await chromium.launch({executablePath:chrome,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1200,height:844}});
  await page.goto(f.origin+f.server.guidelines.readLines(doc.id,272,274).citationUrl);
  await page.locator('.guideline-line.matched').first().waitFor();
  await page.addStyleTag({content:'.guideline-line {font-size: 24px;line-height:2}'});
  await page.waitForFunction(()=>{const e=document.querySelector('.guideline-line.matched');if(!e)return false;const r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return r.top>=Math.max(0,p.top)&&r.bottom<=Math.min(innerHeight,p.bottom);});
  assert.equal(await page.locator('.guideline-line.matched').count(),3);
});
test("manual Excel upload retains the original, shows coverage and supports source-cell lookup", {skip:!existsSync(chrome)}, async t => {
  const f=await fixture(t,{embedder:{model:"ui-test",available:()=>true,status:()=>({enabled:true}),embed:async inputs=>inputs.map(()=>[1,0])}});
  await library(f,"检验资料");
  const browser=await chromium.launch({executablePath:chrome,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(f.origin+"/?view=knowledge");
  await page.locator(".library-card",{hasText:"检验资料"}).getByRole("button",{name:"打开知识库",exact:true}).click();
  const workbook=new ExcelJS.Workbook(), sheet=workbook.addWorksheet("参考范围");
  sheet.addRow(["项目","单位","参考区间"]);sheet.addRow(["合成指标","mg/L","4–8"]);
  await page.getByRole("button",{name:"添加资料",exact:true}).click();
  await page.getByLabel("导入资料文件",{exact:true}).setInputFiles({name:"实验室.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:Buffer.from(await workbook.xlsx.writeBuffer())});
  await page.getByLabel("上传资料性质",{exact:true}).selectOption("检验/检查参考");
  await page.getByRole("button",{name:"导入 1 份资料",exact:true}).click();
  await page.getByText(/已提交 1 份资料/).waitFor();
  await page.getByRole("navigation",{name:"知识库工作区"}).getByRole("button",{name:"资料",exact:true}).click();
  await page.locator(".kw-table tbody tr",{hasText:"实验室"}).waitFor();
  await page.getByRole("navigation",{name:"知识库工作区"}).getByRole("button",{name:"检索",exact:true}).click();
  await page.getByLabel("知识库检索问题").fill("合成指标");
  await page.locator(".kw-search-form").getByRole("button",{name:"检索",exact:true}).click();
  await page.getByText("参考范围 行 2",{exact:false}).waitFor();
  await page.getByRole("button",{name:"查看原文",exact:true}).first().click();
  await page.locator('.kw-cited-row[data-row="2"]').waitFor();
  assert.equal(await page.locator('.guidelines-text').count(),0);
  assert.match(await page.locator('.kw-source-context').innerText(),/参考范围 · 第 2 行/);
  await page.getByLabel("预览工作表").selectOption("参考范围");
  await page.getByLabel("查找表格行").fill("合成指标");
  const tableRow=page.locator('.kw-sheet tbody tr');
  await tableRow.waitFor();
  assert.equal(await tableRow.count(),1);
  assert.match(await tableRow.innerText(),/mg\/L/);
  assert.equal(await page.getByRole('button',{name:'查看提取文本',exact:true}).isVisible(),false);
  assert.equal(await page.getByText('表格读取说明',{exact:true}).count(),0);
  await page.getByRole('button',{name:'更多',exact:true}).click();
  await page.getByRole('button',{name:'查看提取文本',exact:true}).click();
  assert.match(await page.locator('.guidelines-text').innerText(),/B2【单位】=mg\/L/);
  await page.getByRole('button',{name:'收起提取文本'}).click();
  assert.equal(await page.locator('.guidelines-text').count(),0);
  await page.getByRole('button',{name:'关闭溯源',exact:true}).click();
  assert.equal(await page.getByLabel('知识库检索问题').inputValue(),'合成指标');
  await page.getByRole('button',{name:'查看原文',exact:true}).first().click();
  mkdirSync("output/knowledge-media",{recursive:true});
  await page.screenshot({path:"output/knowledge-media/excel-source.png",fullPage:true});
  assert.deepEqual(errors,[]);
});
test(
  "doctor uploads once, leaves background processing, opens a graph with traceable original",
  { skip: !existsSync(chrome) },
  async (t) => {
    const transcriptions = [];
    const f = await fixture(t, { provider: organizerProvider, knowledgeOrganizerOptions: {
      media: async () => ({ duration: 1, hasAudio: true, hasVideo: false }),
      audio: async (_path, folder, index) => join(folder, `synthetic-audio-${index}`),
      transcribeImpl: async (_path, config, start, length) => {
        transcriptions.push({ model: config.model, baseUrl: config.baseUrl, start, length });
        return [{ start, end: start + length, text: "合成音频转写恢复验证。", kind: "speech", timing: "segment" }];
      },
    } });
    await library(f, "教学资料");
    const browser = await chromium.launch({
      executablePath: chrome,
      headless: true,
    });
    t.after(() => browser.close());
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(f.origin + "/?view=knowledge");
    await page
      .locator(".library-card", { hasText: "教学资料" })
      .getByRole("button", { name: "打开知识库", exact: true })
      .click();
    await page.getByRole("button",{name:"添加资料",exact:true}).click();
    await page.getByLabel("同时生成知识图谱",{exact:false}).check();
    await page
      .getByLabel("导入资料文件", { exact: true })
      .setInputFiles({
        name: "合成讲座.srt",
        mimeType: "text/plain",
        buffer: Buffer.from(
          "1\n00:00:01,000 --> 00:00:05,000\n合成疾病讨论合成检查。",
        ),
      });
    await page.getByRole("button",{name:"导入 1 份资料",exact:true}).click();
    await page.getByText(/已提交 1 份资料/).waitFor();
    await page
      .getByRole("button", { name: "← 全部知识库", exact: true })
      .click();
    await page
      .locator(".library-card", { hasText: "教学资料" })
      .getByRole("button", { name: "打开知识库", exact: true })
      .click();
    await page.getByRole("button", { name: "知识图谱", exact: true }).click();
    await page
      .getByRole("button", { name: "知识点：合成疾病", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "知识点：合成疾病", exact: true })
      .click();
    await page.locator(".knowledge-map-evidence").getByText("资料讨论", { exact: false }).first().waitFor();
    mkdirSync("output/knowledge-media", { recursive: true });
    await page.screenshot({
      path: "output/knowledge-media/knowledge-map.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: /查看依据 · 第/ })
      .first()
      .click();
    await page
      .getByRole("heading", { name: "合成资料主题", exact: true })
      .waitFor();
    assert.match(
      await page.locator(".guidelines-text").innerText(),
      /00:00:01/,
    );
    await page.getByRole("button", { name: "更多", exact:true }).click();
    await page.getByRole("button", { name: /打开原文件/ }).click();
    const link = page.getByRole("link", {
      name: "查看或下载原文件",
      exact: true,
    });
    await link.waitFor();
    const response = await page.request.get(
      new URL(await link.getAttribute("href"), f.origin).href,
    );
    assert.equal(response.status(), 200);
    assert.match(await response.text(), /00:00:01,000/);
    await page.getByRole("button", { name: "关闭溯源", exact: true }).click();
    await page.getByRole("navigation",{name:"知识库工作区"}).getByRole("button",{name:"资料",exact:true}).click();
    await page.getByRole("button",{name:"添加资料",exact:true}).click();
    const original = Buffer.from("synthetic-audio-with-mocked-decoder");
    await page.getByLabel("导入资料文件").setInputFiles({name:"转写恢复验证.wav",mimeType:"audio/wav",buffer:original});
    await page.getByText("音视频转写",{exact:true}).click();
    await page.getByText(/尚无可用转写连接.*可以先导入音视频对应的文字稿/).waitFor();
    const uploaded = page.waitForResponse(r => r.url().includes('/api/knowledge/organization?') && r.request().method() === 'POST');
    await page.getByRole("button",{name:"导入 1 份资料",exact:true}).click();
    const pending = await (await uploaded).json();
    let job = await waitJob(f, pending.id);
    assert.equal(job.status, 'needs_input');
    assert.match(job.error, /请配置音频转写服务后继续/);
    assert.deepEqual(readFileSync(job.sourcePath), original);
    assert.equal(transcriptions.length, 0);
    const countBefore = f.server.guidelines.list({ collection: '教学资料' }).length;
    assert.equal(countBefore, 1, 'unconfigured audio cannot become a searchable document');
    await page.reload();
    await page.getByRole('status').filter({hasText:/转写恢复验证.wav · 导入未完成：请配置音频转写服务后继续/}).waitFor();
    assert.equal(f.server.knowledgeOrganizer.get(job.id).status, 'needs_input');
    assert.deepEqual(readFileSync(f.server.knowledgeOrganizer.get(job.id).sourcePath), original);
    // Existing configuration API supplies a synthetic adapter; the current UI
    // offers a transcript fallback instead of a connection form.
    const configured = await f.json('/api/knowledge/transcription-settings', 'PUT', {
      provider: 'local', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-transcription',
    });
    assert.equal(configured.status, 200);
    assert.equal(configured.data.transcriptionReady, true);
    const retry = page.waitForResponse(r => r.url().endsWith(`/api/knowledge/organization/${job.id}/retry`));
    await page.getByRole('button', {name:'重试导入',exact:true}).click();
    assert.equal((await retry).status(), 202);
    job = await waitJob(f, job.id);
    assert.equal(job.status, 'completed', job.error);
    assert.deepEqual(readFileSync(job.sourcePath), original);
    assert.equal(f.server.guidelines.list({ collection: '教学资料' }).length, countBefore + 1);
    assert.deepEqual(transcriptions, [{ model:'synthetic-transcription', baseUrl:'http://127.0.0.1:1/v1', start:0, length:1 }]);
    assert.match(f.server.guidelines.get(job.docId).text, /合成音频转写恢复验证/);
    await page.reload();
    await page.locator('.kw-documents-table tbody tr', {hasText:'转写恢复验证'}).waitFor();
    assert.equal(f.server.knowledgeOrganizer.list('教学资料').filter(j => j.fileName === '转写恢复验证.wav').length, 1);
    assert.deepEqual(errors, []);
  },
);

test('workspace scopes counts, preserves navigation, edits source metadata without a review step and carries search scope into an unsent question', {skip:!existsSync(chrome)},async t=>{
  const f=await fixture(t);
  await library(f,'当前库');await library(f,'另一库');
  const a=await f.server.guidelines.addDocument({title:'当前库依据',collection:'当前库',kind:'指南',text:'合成疾病讨论合成检查。仅为软件测试。'});
  await f.server.guidelines.addDocument({title:'另一库不能混入',collection:'另一库',text:'合成疾病另一个版本。'});
  const browser=await chromium.launch({executablePath:chrome,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(f.origin+'/?view=knowledge');
  await page.locator('.library-card',{hasText:'当前库'}).getByRole('button',{name:'打开知识库',exact:true}).click();
  await page.locator('.kw-documents-table tbody tr').first().waitFor();
  assert.equal(await page.locator('.kw-documents-table tbody tr').count(),1);
  assert.equal(await page.getByText('下一步',{exact:true}).count(),0);
  assert.equal(await page.getByText('最近收录',{exact:true}).count(),0);
  assert.equal(await page.getByText('质量核对',{exact:false}).count(),0);
  assert.equal(await page.getByText('来源待核对',{exact:true}).isVisible(),false);
  const nav=page.getByRole('navigation',{name:'知识库工作区'});
  assert.deepEqual(await nav.getByRole('button').allTextContents().then(labels=>labels.map(x=>x.trim())),['资料','检索','知识图谱']);
  await page.locator('.kw-document-more > summary').click();
  await page.getByRole('button',{name:'来源与版本',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'管理来源与版本'});
  await modal.getByLabel('版本说明').fill('2026 合成版');
  assert.equal(await modal.getByLabel('来源状态',{exact:true}).count(),0);
  assert.equal(await modal.getByText('下次复核日期').count(),0);
  await modal.getByText('对外引用设置',{exact:true}).click();
  await modal.getByRole('checkbox',{name:'允许机器人对外回复引用此资料'}).check();
  await modal.getByRole('button',{name:'保存来源信息'}).click();
  await page.getByRole('status').filter({hasText:'来源信息已保存。'}).waitFor();
  assert.equal(f.server.guidelines.get(a.id).allowExternalUse,true);
  assert.equal(f.server.guidelines.get(a.id).reviewStatus,'unreviewed');
  await nav.getByRole('button',{name:'资料',exact:true}).click();
  await page.reload();
  await page.locator('.kw-table tbody tr').first().waitFor();
  assert.equal(await page.locator('.kw-table tbody tr').count(),1);
  assert.match(await page.locator('.kw-table tbody').innerText(),/当前库依据/);
  await nav.getByRole('button',{name:'检索',exact:true}).click();
  await page.locator('.kw-search-options > summary').click();
  assert.deepEqual(await page.getByLabel('检索来源范围').locator('option').allTextContents(),['使用中的来源','已停用（历史资料）']);
  await page.getByLabel('知识库检索问题').fill('合成疾病');
  await page.locator('.kw-search-form').getByRole('button',{name:'检索',exact:true}).click();
  await page.getByRole('button',{name:'查看原文',exact:true}).first().waitFor();
  assert.doesNotMatch(await page.locator('.kw-results').innerText(),/另一库/);
  assert.equal(await page.locator('.kw-results h3').first().innerText(),'当前库依据');
  await page.getByRole('button',{name:'查看原文',exact:true}).first().click();
  await page.getByRole('button',{name:'关闭溯源',exact:true}).click();
  assert.equal(await page.getByLabel('检索来源范围').inputValue(),'');
  await page.getByRole('button',{name:'带着此问题继续问答'}).click();
  await page.locator('.composer textarea').waitFor();
  const draft=await page.locator('.composer textarea').inputValue();
  assert.match(draft,/当前库/);assert.match(draft,/排除已停用来源/);assert.ok(draft.includes(a.id));assert.match(draft,/当前库依据/);assert.doesNotMatch(draft,/undefined/);
  assert.ok((await f.json('/api/sessions')).data.sessions.every(s=>!s.running));
  assert.deepEqual(errors,[]);
});

test('partial upload retry preserves successes and completed jobs expose failed-index recovery', {skip:!existsSync(chrome)},async t=>{
  let embeddingFails=true;
  const f=await fixture(t,{embedder:{model:'recovery-test',available:()=>true,status:()=>({enabled:true}),embed:async inputs=>{if(embeddingFails)throw Error('合成嵌入服务暂不可用');return inputs.map(()=>[1,0]);}}});
  await library(f,'恢复路径');
  const browser=await chromium.launch({executablePath:chrome,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:900}});let rejected=false;const attempts=[];
  await page.route('**/api/knowledge/organization?**',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    const name=new URL(route.request().url()).searchParams.get('name');attempts.push(name);
    if(name==='待重试.txt'&&!rejected){rejected=true;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'合成网络中断，请重试'})});}
    return route.continue();
  });
  await page.goto(f.origin+'/?view=knowledge&'+new URLSearchParams({collection:'恢复路径'}));
  await page.getByRole('button',{name:'添加资料',exact:true}).click();
  await page.getByLabel('导入资料文件').setInputFiles(['成功.txt','待重试.txt'].map(name=>({name,mimeType:'text/plain',buffer:Buffer.from(`合成软件测试资料：${name}，请保留来源。`)})));
  await page.getByRole('button',{name:'导入 2 份资料',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'导入资料'});await modal.getByRole('alert').filter({hasText:'合成网络中断'}).waitFor();
  assert.equal(await modal.locator('.kw-import-files li').count(),1);
  await modal.getByRole('button',{name:'导入 1 份资料',exact:true}).click();
  await modal.waitFor({state:'hidden'});
  await page.locator('.kw-documents-table tbody tr').filter({hasText:'成功'}).getByText('语义检索暂不可用',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'处理记录',exact:true}).count(),0);
  assert.deepEqual(attempts,['成功.txt','待重试.txt','待重试.txt']);
  assert.equal((await f.json('/api/knowledge?'+new URLSearchParams({collection:'恢复路径'}))).data.documents.length,2);
  embeddingFails=false;
  const card=page.locator('.kw-documents-table tbody tr').filter({hasText:'成功'});
  await card.locator('summary').click();
  await card.getByRole('button',{name:'重建语义索引',exact:true}).click();
  await card.getByRole('button',{name:'重建语义索引',exact:true}).waitFor({state:'hidden'});
  await card.locator('.kw-doc-title').click();
  const heading=page.locator('.guidelines-reader-head h1');await heading.waitFor();
  assert.ok(await heading.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<innerHeight;}),'ordinary reading starts at document information');
  await page.getByRole('button',{name:'返回工作区',exact:true}).click();
  await card.waitFor();
});

test('citation side panel preserves the answer, switches sources, retries errors and closes accessibly', {skip:!existsSync(chrome)},async t=>{
  let answer='';
  const provider={provider:'stub',model:'stub',apiKey:'stub',async complete(){return {message:{role:'assistant',content:answer}};}};
  const f=await fixture(t,{provider});await library(f,'回答出处');
  const doc=await f.server.guidelines.addDocument({title:'回答依据甲',collection:'回答出处',text:Array.from({length:120},(_,i)=>`段落 ${i+1}：仅软件引用测试。`).join('\n')});
  const second=await f.server.guidelines.addDocument({title:'回答依据乙',collection:'回答出处',text:'第二份资料\n乙资料原文。'});
  const citation=f.server.guidelines.readLines(doc.id,100,101).citationUrl;
  const other=f.server.guidelines.readLines(second.id,2,2).citationUrl;
  answer=Array.from({length:24},(_,i)=>`回答段落 ${i+1}：保留回答上下文。`).join('\n\n')+`\n\n[依据甲](${citation}) · [依据乙](${other}) · [旧版](${other.replace(second.sha256,'outdated')}) · [失效行号](${other.replace('line=2','line=999')})`;
  const session=await f.legacy('引用侧栏测试');await f.chat(session.id,'请给出引用',{mode:'model',externalConsent:true});
  const browser=await chromium.launch({executablePath:chrome,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(f.origin+'/?view=workbench&session='+session.id);
  const link=page.getByRole('link',{name:'依据甲',exact:true});await link.scrollIntoViewIfNeeded();
  const url=page.url(),scroll=await page.locator('.message-list').evaluate(e=>e.scrollTop);
  await page.locator('.composer textarea').fill('保留尚未发送的追问');
  await link.click();
  const panel=page.getByRole('dialog',{name:'回答依据甲',exact:true});await panel.waitFor();
  await page.locator('.kw-source-body .guideline-line.matched[data-line="100"]').waitFor();
  await page.waitForFunction(()=>{const e=document.querySelector('.kw-source-body .matched'),p=document.querySelector('.kw-source-body');return e.getBoundingClientRect().top>=p.getBoundingClientRect().top&&e.getBoundingClientRect().bottom<=p.getBoundingClientRect().bottom;});
  assert.equal(page.url(),url);assert.equal(page.context().pages().length,1);
  assert.ok(await page.locator('.message-list').evaluate(e=>e.getBoundingClientRect().right<=document.querySelector('.kw-source-panel').getBoundingClientRect().left+1));
  assert.equal(await page.locator('.composer textarea').inputValue(),'保留尚未发送的追问');
  // A slow earlier request must not replace a newer citation.
  await page.route('**/api/knowledge/'+doc.id,async route=>{await new Promise(r=>setTimeout(r,250));await route.continue();});
  await link.click();await page.getByRole('link',{name:'依据乙',exact:true}).click();
  await page.getByRole('dialog',{name:'回答依据乙',exact:true}).waitFor();
  assert.equal(await page.locator('.kw-source-panel').getByText('来源待核对',{exact:true}).isVisible(),false);
  assert.equal(await page.locator('.kw-source-panel').getByText('版本未注明',{exact:true}).count(),0);
  await page.getByRole('button',{name:'更多',exact:true}).click();
  await page.locator('.kw-source-panel').getByText('使用中',{exact:true}).waitFor();
  await page.getByRole('button',{name:'更多',exact:true}).click();
  f.server.guidelines.updateMetadata(second.id,{expectedRevision:0,reviewStatus:'retired',reviewNote:'测试停用'});
  await page.getByRole('link',{name:'依据乙',exact:true}).click();
  await page.locator('.kw-source-context').getByRole('alert').filter({hasText:'来源已停用'}).waitFor();
  await page.getByRole('link',{name:'旧版',exact:true}).click();await page.locator('.kw-source-context').getByRole('alert').filter({hasText:'原文已更新'}).waitFor();
  await page.getByRole('link',{name:'失效行号',exact:true}).click();await page.locator('.kw-source-panel').getByRole('alert').filter({hasText:'引用行号已失效'}).waitFor();
  let fail=true;await page.route('**/api/knowledge/'+second.id,route=>fail?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'合成读取失败'})}):route.continue());
  await page.getByRole('link',{name:'依据乙',exact:true}).click();await page.locator('.kw-source-panel').getByText('合成读取失败').waitFor();fail=false;
  await page.getByRole('button',{name:'重试读取'}).click();await page.getByRole('dialog',{name:'回答依据乙',exact:true}).waitFor();
  await page.keyboard.press('Escape');await page.locator('.kw-source-panel').waitFor({state:'hidden'});
  assert.equal(page.url(),url);assert.equal(await page.locator('.composer textarea').inputValue(),'保留尚未发送的追问');
  assert.ok(Math.abs(await page.locator('.message-list').evaluate(e=>e.scrollTop)-scroll)<5,'answer scroll position is retained');
  await page.setViewportSize({width:390,height:844});await link.click();await page.getByRole('dialog',{name:'回答依据甲',exact:true}).waitFor();
  assert.equal(await page.locator('.kw-source-panel').getAttribute('aria-modal'),'true');
  assert.ok(await page.locator('.kw-source-panel').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth+2;}));
  assert.ok(await page.locator('.product-content').evaluate(e=>e.inert));
  await page.getByRole('button',{name:'关闭溯源'}).click();await page.locator('.kw-source-panel').waitFor({state:'hidden'});
  assert.equal(await page.locator('.product-content').evaluate(e=>e.inert),false);
  assert.equal(await link.evaluate(e=>document.activeElement===e),true);
  assert.equal(page.url(),url);assert.deepEqual(errors,[]);
});


test('table citation opens the correct sheet and page without duplicate extracted text', {skip:!existsSync(chrome)}, async t=>{
  const f=await fixture(t,{embedder:{model:'table-ui',available:()=>true,status:()=>({enabled:true}),embed:async inputs=>inputs.map(()=>[1,0])}});
  await library(f,'表格定位');const book=new ExcelJS.Workbook();
  for(const [name,unit] of [['实验室甲','mg/L'],['实验室乙','mmol/L']]){
    const sheet=book.addWorksheet(name);sheet.addRow(['项目','单位','参考区间']);
    for(let i=2;i<=125;i++)sheet.addRow([`指标-${i}`,unit,i===102?'1–2':'未提供']);
  }
  const uploaded=await fetch(f.origin+'/api/knowledge/organization?'+new URLSearchParams({collection:'表格定位',name:'定位.xlsx',sourceKind:'检验/检查参考',indexOnly:'true'}),{method:'POST',headers:{'x-medical-token':f.server.token,'x-knowledge-consent':'true'},body:Buffer.from(await book.xlsx.writeBuffer())});
  const job=await waitJob(f,(await uploaded.json()).id);assert.equal(job.status,'completed');
  const table=(await f.json(`/api/knowledge/${job.docId}/table`)).data;
  const row=table.sheets[1].rows.find(r=>r.row===102);
  const citation=f.server.guidelines.readLines(job.docId,row.startLine,row.endLine).citationUrl;
  const browser=await chromium.launch({executablePath:chrome,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(f.origin+citation);
  await page.locator('.kw-cited-row[data-row="102"]').waitFor();
  assert.equal(await page.getByLabel('预览工作表').inputValue(),'实验室乙');
  assert.match(await page.locator('.kw-cited-row').innerText(),/mmol\/L/);
  assert.equal(await page.locator('.kw-sheet tbody tr[data-row="1"]').count(),0);
  assert.equal(await page.locator('.guidelines-text').count(),0);
  assert.match(await page.locator('.kw-pagination').innerText(),/3 \/ 3/);
  await page.getByLabel('预览工作表').selectOption('实验室甲');
  await page.getByRole('button',{name:'回到引用行'}).waitFor();
  assert.equal(await page.locator('tbody .kw-cited-row').count(),0);
  assert.match(await page.locator('.kw-table-citation').innerText(),/实验室乙 · 第 102 行/);
  await page.getByRole('button',{name:'回到引用行'}).click();
  await page.getByLabel('查找表格行').fill('不存在的数据');
  await page.getByRole('button',{name:'回到引用行'}).click();
  assert.equal(await page.getByLabel('查找表格行').inputValue(),'');
  await page.locator('.kw-cited-row[data-row="102"]').waitFor();
  await page.locator('.kw-source-details > summary').click();
  await page.getByLabel('显示单元格位置').check();assert.match(await page.locator('.kw-cited-row').innerText(),/B102/);
  // Failed table reads retain a clear fallback; successful retry restores the formatted view.
  let failed=true;await page.route('**/api/knowledge/'+job.docId+'/table',route=>failed?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'合成表格读取失败'})}):route.continue());
  await page.reload();await page.getByRole('button',{name:'重试表格读取'}).waitFor();
  await page.locator('.guidelines-text').waitFor();failed=false;await page.getByRole('button',{name:'重试表格读取'}).click();
  await page.locator('.kw-cited-row[data-row="102"]').waitFor();assert.equal(await page.locator('.guidelines-text').count(),0);
});


test('library shows documents and graph directly without assistant or processing-history entry points', {skip:!existsSync(chrome)}, async t=>{
  const f=await fixture(t);await library(f,'资料管理');
  await f.server.guidelines.addDocument({title:'合成资料：用于界面验证的长标题与版本说明',collection:'资料管理',org:'合成研究机构',edition:'2026',text:'仅用于界面验证，不是医学资料。'});
  const retired=await f.server.guidelines.addDocument({title:'历史资料',collection:'资料管理',text:'合成历史资料。'});
  f.server.guidelines.updateMetadata(retired.id,{expectedRevision:0,reviewStatus:'retired',reviewNote:'测试历史版本'});
  const browser=await chromium.launch({executablePath:chrome,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const url=f.origin+'/?view=knowledge&'+new URLSearchParams({collection:'资料管理',knowledgeTab:'overview'});
  await page.goto(url);
  await page.locator('.kw-documents-table tbody tr').first().waitFor();
  assert.equal(await page.locator('.kw-documents-table tbody tr').count(),2);
  assert.equal(await page.getByRole('button',{name:'资料',exact:true}).getAttribute('aria-current'),'page');
  await page.getByLabel('查找资料',{exact:true}).fill('研究机构');
  assert.equal(await page.locator('.kw-documents-table tbody tr').count(),1);
  assert.equal(await page.getByRole('button',{name:/AI 修改|AI 助手|处理记录/}).count(),0);
  await page.getByRole('button',{name:'知识图谱',exact:true}).click();
  await page.getByLabel('知识地图',{exact:true}).waitFor();
  await page.reload();
  await page.getByLabel('知识地图',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'知识图谱',exact:true}).getAttribute('aria-current'),'page');
  await page.goto(url.replace('overview','processing'));
  await page.locator('.kw-documents-table tbody tr').first().waitFor();
  await page.goto(url);
  await page.locator('.kw-documents-table tbody tr').first().waitFor();
  mkdirSync('output/playwright',{recursive:true});
  await page.screenshot({path:'output/playwright/knowledge-simple-wide.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'output/playwright/knowledge-simple-mobile.png',fullPage:true});
  assert.ok(await page.locator('.kw-workspace').evaluate(e=>e.getBoundingClientRect().right<=innerWidth+1));
  await page.setViewportSize({width:1440,height:1000});
  const row=page.locator('.kw-documents-table tbody tr',{hasText:'历史资料'});
  await row.getByRole('button',{name:'删除',exact:true}).click();
  await page.getByRole('dialog',{name:'删除资料'}).getByRole('button',{name:'取消',exact:true}).click();
  assert.equal((await f.json('/api/knowledge?'+new URLSearchParams({collection:'资料管理'}))).data.documents.length,2);
  await row.getByRole('button',{name:'删除',exact:true}).click();
  await page.getByRole('button',{name:'确认删除',exact:true}).click();
  await page.getByText('资料已删除。',{exact:false}).waitFor();
  assert.equal(await page.locator('.kw-documents-table tbody tr').count(),1);
});
