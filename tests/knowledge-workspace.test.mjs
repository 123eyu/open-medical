import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { fixture } from './helpers.mjs';
import { library, waitJob, organizerProvider } from './knowledge-organization-helpers.mjs';
import { documentIssues, summarizeWorkspace } from '../src/knowledge-workspace-model.mjs';

test('quality distinguishes complete ingestion, indexing, review and retired sources',()=>{
  const full={id:'a',coverage:{status:'complete'},indexing:{status:'ready'},reviewStatus:'unreviewed',edition:'2026'};
  assert.deepEqual(documentIssues(full).map(i=>i.type),[]);
  const excerpt={...full,id:'b',reviewStatus:'reviewed',coverage:{status:'excerpt'}};
  assert.deepEqual(documentIssues(excerpt).map(i=>i.type),['coverage']);
  const retired={...excerpt,id:'c',reviewStatus:'retired'};
  assert.deepEqual(documentIssues(retired),[]);
  assert.deepEqual(summarizeWorkspace([full,excerpt,retired],[{status:'failed'},{status:'completed'},{status:'running'}]),{total:3,searchable:2,complete:1,reviewed:1,attention:1,running:1,failed:1});
});

test('table preview preserves cells and original locators when a graph is added after indexing',async t=>{
  const f=await fixture(t,{provider:organizerProvider,embedder:{model:'test',available:()=>true,status:()=>({enabled:true}),embed:async inputs=>inputs.map(()=>[1,0])}});
  await library(f,'表格原文');
  const book=new ExcelJS.Workbook(),a=book.addWorksheet('实验室甲'),b=book.addWorksheet('实验室乙');
  a.addRow(['项目','单位','范围']);a.addRow(['合成疾病讨论合成检查','mg/L','4–8']);a.addRow(['多行\n含 | 分隔符',null,{formula:'1+1'}]);
  b.state='hidden';b.addRow(['项目','单位','范围']);b.addRow(['同名指标','mmol/L','1–2']);
  const bytes=await book.xlsx.writeBuffer();
  const response=await fetch(f.origin+'/api/knowledge/organization?'+new URLSearchParams({collection:'表格原文',name:'范围.xlsx',sourceKind:'检验/检查参考',indexOnly:'true'}),{method:'POST',headers:{'x-medical-token':f.server.token,'x-knowledge-consent':'true'},body:bytes});
  const uploaded=await response.json();assert.equal(response.status,202);
  const job=await waitJob(f,uploaded.id);assert.equal(job.status,'completed');
  const table=(await f.json(`/api/knowledge/${job.docId}/table`)).data;
  assert.equal(table.sheets.length,2);
  const row=table.sheets[0].rows.find(r=>r.row===3);
  assert.equal(row.values[0].value,'多行\n含 | 分隔符');
  assert.equal(row.values.some(v=>v.column===2),false);
  assert.match(row.values.find(v=>v.column===3).value,/公式无缓存结果/);
  assert.equal(table.sheets[1].rows[1].hidden,true);
  assert.equal(table.sheets[1].rows[1].values[1].value,'mmol/L');
  assert.ok(row.startLine>0);
  // Existing installations without structured values are previewed from their retained original.
  const old=f.server.knowledgeOrganizer.get(job.id);for(const p of old.parts)delete p.values;f.server.knowledgeOrganizer.write(old);
  assert.deepEqual((await f.json(`/api/knowledge/${job.docId}/table`)).data,table);
  const organized=(await f.json(`/api/knowledge/${job.docId}/organization`,'POST',{externalConsent:true,sourceKind:'检验/检查参考'})).data;
  await waitJob(f,organized.id);
  const detail=(await f.json(`/api/knowledge/${job.docId}/organization`)).data;
  assert.equal(detail.job.hasOriginal,true);assert.ok(detail.locators.length>0);
  assert.deepEqual((await f.json(`/api/knowledge/${job.docId}/table`)).data,table);
  const play=(await f.json(`/api/knowledge/organization/${detail.job.id}/playback`,'POST',{})).data;
  const original=await fetch(f.origin+play.url);assert.deepEqual(Buffer.from(await original.arrayBuffer()),Buffer.from(bytes));
  // Never produce misleading source anchors after stored source content changes.
  const doc=f.server.guidelines.docRow(job.docId);doc.text='changed';f.server.store.db.prepare('UPDATE guideline_docs SET data=? WHERE id=?').run(JSON.stringify(doc),doc.id);
  const changed=(await f.json(`/api/knowledge/${job.docId}/table`)).data;
  assert.ok(changed.sheets.every(s=>s.rows.every(r=>r.startLine===null)));
});
