import test from 'node:test';
import assert from 'node:assert/strict';
import {createKnowledgeQueryExpander, fuseKnowledgeQueries} from '../server/medical/knowledge-query.mjs';
import {GuidelineLibrary} from '../server/medical/guidelines.mjs';
import {Store} from '../server/store.mjs';

test('query hints retain numbers, stay separate from evidence, cache and invalidate on provider change',async()=>{
  let calls=0;
  let provider={provider:'stub',model:'test',apiKey:'stub',complete:async()=>{calls++;return {message:{content:JSON.stringify(['adult condition 5 mg','adult condition 50 mg'])}};}};
  const expand=createKnowledgeQueryExpander(()=>provider);
  assert.deepEqual(await expand('成人 5 mg'),{queries:['adult condition 5 mg'],status:'ready'});
  await expand('成人 5 mg');assert.equal(calls,1);
  provider={...provider};await expand('成人 5 mg');assert.equal(calls,2);
  provider={...provider,complete:async()=>{throw Error('transport');}};
  assert.deepEqual(await expand('成人'),{queries:[],status:'unavailable'});
});

test('query variants respect library filtering; localOnly and exact identifiers never call a model',async t=>{
  const store=new Store(':memory:');t.after(()=>store.close());let calls=0;
  const library=new GuidelineLibrary(store,null,null,{expandQuery:async()=>{calls++;return {queries:['unique source evidence'],status:'ready'};}});
  const doc=await library.addDocument({title:'Allowed',collection:'A',text:'unique source evidence'});
  await library.addDocument({title:'Other',collection:'B',text:'unique source evidence'});
  const result=await library.search({query:'独有证据',collection:'A'});
  assert.equal(result.hits[0].docId,doc.id);assert.equal(result.hits.length,1);assert.equal(calls,1);
  await library.search({query:'独有证据',collection:'A',localOnly:true});
  await library.search({query:'QX-17',collection:'A'});assert.equal(calls,1);
  assert.equal((await library.search({query:'独有证据',collection:'missing'})).hits.length,0);
});

test('multiple query channels fuse the same source without duplicating its citation',()=>{
  const hit={docId:'a',ord:1,startLine:3};
  const result=fuseKnowledgeQueries({hits:[hit],count:1},[{hits:[hit,{docId:'b',ord:1,startLine:1}]}],5);
  assert.equal(result.hits.length,2);assert.equal(result.hits[0].docId,'a');
});

test('English lexical retrieval tolerates one inflected term without dropping numeric constraints',async t=>{
  const store=new Store(':memory:');t.after(()=>store.close());const library=new GuidelineLibrary(store);
  const doc=await library.addDocument({title:'Study',text:'Adult participants randomized to exercise, duration 12 weeks.'});
  const result=await library.search({query:'adult participants randomization',localOnly:true});
  assert.equal(result.hits[0].docId,doc.id);assert.equal(result.hits[0].lexicalMatchType,'partial');
  assert.equal((await library.search({query:'adult participants 24 weeks',localOnly:true})).hits.length,0);
});
