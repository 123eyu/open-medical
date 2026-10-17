import test from 'node:test';
import assert from 'node:assert/strict';
import {ToolRegistry} from '../server/core/tool-registry.mjs';
import {PermissionEngine} from '../server/core/permissions.mjs';
import {configureSimilarCaseTools, similarCaseAnswer} from '../server/medical/similar-case-workflow.mjs';

const comparison = () => ['disease','stage','treatment','medications','demographics'].map(dimension=>({dimension,current:'未知',candidate:'未知',currentQuote:'',candidateQuote:'',relation:'unknown',reason:'尚未核对'}));
function setup(handlers, searchScope='local') {
  const registry = new ToolRegistry();
  for (const [name,execute] of Object.entries(handlers)) registry.register({permission:'tools.execute',capability:{backend:'local'},definition:{type:'function',function:{name,parameters:{type:'object',additionalProperties:true}}},execute});
  const run = {id:'synthetic-run',policy:{workflow:'similar-case-search',searchScope},artifacts:[]};
  configureSimilarCaseTools(registry,{},run);
  const permissions = new PermissionEngine({profile:'standard',grants:{}});
  return {run,execute:(name,args={})=>registry.execute(name,args,{},permissions)};
}

for (const dated of [true,false]) test(`summary cannot assert missing dates or new clinical facts from free model prose (source dated=${dated})`, async () => {
  const candidate = {caseId:'patient:synthetic',diagnosis:'虚构核验病',keyLabs:[{item:'虚构指标',value:7,unit:'TEST',...(dated?{date:'2026-03-07',source:'虚构报告第2行'}:{})}]};
  const {execute,run} = setup({similar_case_search:async()=>({count:1,matches:[candidate]}),read_patient_brief:async()=>({diagnoses:['虚构核验病']})});
  await execute('read_patient_brief'); await execute('similar_case_search');
  const rows = comparison(); rows[0] = {...rows[0],current:'虚构核验病',candidate:'虚构核验病',currentQuote:'虚构核验病',candidateQuote:'虚构核验病',relation:'match'};
  const proposed = {summary:'候选检验日期未标注，必须立即停止用药。',limitations:['候选缺少采样日期，当前患者已确诊严重感染。'],items:[{reference:'patient:synthetic',reason:'未标日期',differences:'未标日期',comparison:rows}]};
  const result = await execute('finish_similar_case_search',proposed);
  assert.notEqual(result.summary,proposed.summary);
  assert.doesNotMatch(JSON.stringify({summary:result.summary,limitations:result.limitations}),/未标注|缺少采样日期|立即停止|严重感染/);
  assert.match(result.summary,/1 条本地记录/);
  assert.match(result.limitations.join('\n'),/尚未完成双方证据对照；这不等于原始档案未记录/);
  assert.equal(result.cases[0].comparison[0].currentQuote,'虚构核验病');
  assert.match(result.cases[0].reason,/虚构核验病/);
  const source = JSON.parse(result.cases[0].evidence.text);
  assert.equal(source.keyLabs[0].date,dated?'2026-03-07':undefined);
  assert.equal(source.keyLabs[0].source,dated?'虚构报告第2行':undefined);
  run.artifacts.push(result);
  const answer = similarCaseAnswer({runs:[run]},run.id,{text:proposed.summary});
  assert.doesNotMatch(answer.text,/未标注|缺少采样日期|立即停止|严重感染/);
});

test('overview distinguishes abstract evidence, metadata-only candidates, and failed online sources', async () => {
  const {execute} = setup({
    online_case_search:async()=>({candidates:[{pmid:'1',title:'Synthetic metadata'},{pmid:'2',title:'Synthetic abstract'}],searches:[{source:'a',status:'ok'},{source:'b',status:'failed',error:'synthetic timeout'}]}),
    literature_fetch:async()=>({abstract:'Synthetic retrieved abstract.'}),
  },'online');
  await execute('online_case_search'); await execute('literature_fetch',{pmid:'2'});
  const result = await execute('finish_similar_case_search',{summary:'所有候选已核对全文，未发生失败。',limitations:[],items:['1','2'].map(reference=>({reference,reason:'ignored',differences:'ignored',comparison:comparison()}))});
  assert.match(result.summary,/0 条本地记录、1 条已取得摘要、1 条仅题录/);
  const limits = result.limitations.join('\n');
  assert.match(limits,/2 次，其中 1 次失败/); assert.match(limits,/1 条候选仅取得题录/);
  assert.match(limits,/1 条候选的证据范围为已取得的摘要，尚未核对全文/);
  assert.doesNotMatch(JSON.stringify(result),/所有候选已核对全文|未发生失败/);
});

for (const failed of [true,false]) test(`zero candidates preserve retrieval failure versus successful empty search (failed=${failed})`, async () => {
  const {execute} = setup({similar_case_search:async()=>{if(failed)throw Error('synthetic local read failure');return {count:0,matches:[]};}});
  await execute('similar_case_search');
  const result = await execute('finish_similar_case_search',{summary:'世界上不存在类似患者。',limitations:['候选已完全匹配。'],items:[]});
  assert.equal(result.cases.length,0);
  assert.match(result.summary,/未展示候选.*不代表不存在/);
  assert.equal(result.localFailed,failed);
  assert.match(result.limitations.join('\n'),failed?/本地检索失败/:/本地检索返回 0 条候选/);
  assert.doesNotMatch(JSON.stringify(result),/世界上不存在|候选已完全匹配/);
});
