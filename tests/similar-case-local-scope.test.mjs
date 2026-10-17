import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { DeepSeekProvider } from '../server/provider.mjs';
import { similarCaseSearchScope } from '../server/medical/similar-case-workflow.mjs';

test('local-only search accepts common explicit restrictions without treating nonexclusive local wording as a restriction', () => {
  for (const wording of ['仅使用本机患者档案，不进行网上检索','只查本地','仅在院内档案中寻找相似患者','禁止联网','不要进行网上检索','不使用网络检索','无需上网','只做离线检索','检索范围为本机已有患者档案','仅限本地病例库','local only','only use local records','without internet']) {
    assert.equal(similarCaseSearchScope(wording),'local',wording);
  }
  for (const wording of ['找相似患者','先查本地，再查网上','不要只查本地，也查网上','不限于本地病例','不只是本地，也要网上']) {
    assert.equal(similarCaseSearchScope(wording),'online',wording);
  }
});

for (const wording of ['仅使用本机患者档案，不进行网上检索','只在本地查找','不要进行网上检索']) {
  test(`local similar-patient task saves grounded candidates and excludes all online tools: ${wording}`, async t => {
    const provider = new DeepSeekProvider({apiKey:'synthetic',model:'synthetic-local-contract'});
    let round = 0, candidateId;
    const call = (name,args={}) => ({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}});
    provider.complete = async (messages,tools) => {
      round++;
      assert.ok(!tools.some(tool=>['online_case_search','literature_fetch','web_search'].includes(tool.function.name)),'network tools are absent before any model choice');
      if (round===1) return {message:{role:'assistant',content:'',tool_calls:[call('read_patient_brief'),call('similar_case_search',{caseText:'虚构同类病',diagnosis:'虚构同类病',limit:3})]}};
      if (round===2) {
        const results = messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));
        const result = results.find(r=>r.matches);
        assert.ok(result.matches.length>0); assert.ok(result.matches.some(m=>m.caseId===`patient:${candidateId}`));
        const candidate = result.matches.find(m=>m.caseId===`patient:${candidateId}`);
        const comparison = ['disease','stage','treatment','medications','demographics'].map(dimension=>({dimension,current:dimension==='disease'?'虚构同类病':'未知',candidate:dimension==='disease'?'虚构同类病':'未知',currentQuote:dimension==='disease'?'虚构同类病':'',candidateQuote:dimension==='disease'?'虚构同类病':'',relation:dimension==='disease'?'match':'unknown',reason:dimension==='disease'?'已记录同一虚构诊断':'资料未提供，不能假定相同'}));
        return {message:{role:'assistant',content:'',tool_calls:[call('finish_similar_case_search',{summary:'仅检索本机档案，找到一个虚构候选。',items:[{reference:String(candidate.id||candidate.patientId||candidate.caseId),reason:'已记录同一虚构诊断',differences:'分期、治疗与用药资料不足',comparison}],limitations:['仅本机档案，未进行网上检索']})]}};
      }
      assert.equal(tools.length,0); return {message:{role:'assistant',content:'结束'}};
    };
    const f = await fixture(t,{provider});
    const patient = (await f.json('/api/patients','POST',{name:'虚构本地范围甲',diagnoses:[{name:'虚构同类病'}]})).data;
    const candidate = (await f.json('/api/patients','POST',{name:'虚构本地范围乙',diagnoses:[{name:'虚构同类病'}]})).data;
    candidateId = candidate.id;
    await f.chat(patient.sessionId,`寻找相似患者，${wording}`,{mode:'standard',externalConsent:true});
    for (let refresh=0;refresh<2;refresh++) {
      const saved = (await f.json(`/api/sessions/${patient.sessionId}`)).data;
      const run = saved.runs.at(-1), result = saved.artifacts.find(a=>a.type==='similar_cases');
      assert.equal(run.policy.searchScope,'local'); assert.equal(run.status,'completed'); assert.equal(run.outcome,'delivered');
      assert.equal(result.cases.length,1); assert.equal(result.cases[0].reference,`patient:${candidateId}`); assert.notEqual(result.cases[0].reference,`patient:${patient.id}`);
      assert.equal(result.cases[0].sourceKind,'local'); assert.equal(result.searches.length,0);
      assert.ok(result.cases[0].comparison.find(r=>r.dimension==='disease').currentQuote);
      assert.ok(result.cases[0].differences); assert.equal(result.cases[0].evidence.type,'local-record');
    }
    assert.deepEqual((await f.json(`/api/patients/${candidateId}`)).data,candidate,'retrieval never writes the other patient');
    assert.equal(round,2,'successful finish ends the workflow without another model round');
  });
}
