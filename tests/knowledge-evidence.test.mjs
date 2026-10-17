import test from 'node:test';
import assert from 'node:assert/strict';
import { locateKnowledgeEvidence } from '../server/medical/knowledge-evidence.mjs';
import { KnowledgeOrganizer, validateKnowledgeBatch, compactKnowledgeRetries } from '../server/medical/knowledge-organizer.mjs';
import { Store } from '../server/store.mjs';
import { GuidelineLibrary, knowledgeTools } from '../server/medical/guidelines.mjs';
import { verifyKnowledgeAnswer, finalizeKnowledgeAnswer, knowledgeRunEvidence } from '../server/medical/knowledge-answer.mjs';

test('literal evidence resolves PDF wrapping and wrong line estimates without rewriting the source', () => {
  const text = 'Intro\nNo follow-up is recom-\nmended for typical findings.\nException: underlying disease.';
  const found = locateKnowledgeEvidence(text, 'No follow-up is recommended for typical findings.', {startLine:1,endLine:2});
  assert.deepEqual(found, {quote:'No follow-up is recom-\nmended for typical findings.',startLine:2,endLine:3});
  assert.equal(locateKnowledgeEvidence(text, 'Follow-up is recommended for typical findings.'), null);
  assert.equal(locateKnowledgeEvidence('Threshold -5 mg\nThreshold 5 mg', 'Threshold 5 mg').startLine,2);
  assert.equal(locateKnowledgeEvidence('Repeated evidence\nRepeated evidence', 'Repeated evidence'),null);
  assert.equal(locateKnowledgeEvidence('Repeated evidence\nRepeated evidence', 'Repeated evidence', {startLine:2,endLine:2}).startLine,2);
});

test('graph evidence stores recovered source coordinates and preserves conditions', () => {
  const batch={startLine:10,endLine:13,text:'Title\nOnly in adults, not children,\nuse the reference range 4–8 mg/L.\nEnd'};
  const result=validateKnowledgeBatch({title:'Reference',summary:'Reference',nodes:[{label:'Adults reference',type:'指标',startLine:10,endLine:11,quote:'Only in adults, not children, use the reference range 4–8 mg/L.',attributes:[]}],relations:[]},batch,'检验/检查参考');
  assert.equal(result.nodes[0].startLine,11);
  assert.equal(result.nodes[0].endLine,12);
  assert.match(result.nodes[0].quote,/not children/);
});

test('knowledge citations validate literal evidence, expose numbered text and resolve to the same version', async t => {
  const store=new Store(':memory:');t.after(()=>store.close());
  const library=new GuidelineLibrary(store);
  const doc=await library.addDocument({title:'Source',text:'Title\nNo follow-up for typical findings.\nException: underlying disease.',collection:'test'});
  const read=library.readLines(doc.id,2,3);
  assert.equal(read.numberedText,'L2: No follow-up for typical findings.\nL3: Exception: underlying disease.');
  const cite=knowledgeTools(library).find(t=>t.definition.function.name==='knowledge_cite');
  const result=await cite.execute({docId:doc.id,quote:'No follow-up for typical findings.',startLine:1,endLine:3});
  assert.equal(result.startLine,2);assert.equal(result.endLine,2);
  const url=new URL(result.url,'http://localhost');
  assert.equal(url.searchParams.get('knowledgeDoc'),doc.id);
  assert.equal(url.searchParams.get('sourceHash'),doc.sha256);
  assert.equal(url.searchParams.get('line'),'2');
  assert.throws(()=>cite.execute({docId:doc.id,quote:'Always follow-up for typical findings.',startLine:1,endLine:3}),{code:'KNOWLEDGE_CITATION'});
  assert.throws(()=>cite.execute({docId:doc.id,quote:'No follow-up for typical findings.',startLine:3,endLine:3}),{code:'KNOWLEDGE_CITATION'});
});

test('bge-m3 weak semantic candidates are excluded while literal matches remain available', async t => {
  const store=new Store(':memory:');t.after(()=>store.close());
  const embedder={model:'BAAI/bge-m3',available:()=>true,embed:async()=>[[1,0]],status:()=>({enabled:true})};
  let docId;
  const vectors={upsertDoc:async()=>{},stats:async()=>({backend:'test',chunks:1,models:[{model:embedder.model}]}),search:async()=>[{docId,ord:1,score:0.37}]};
  const library=new GuidelineLibrary(store,embedder,vectors);
  const doc=await library.addDocument({title:'Evidence',text:'Known laboratory reference.',collection:'test'});docId=doc.id;
  assert.equal((await library.search({query:'unrelated driving licence',collection:'test'})).hits.length,0);
  assert.equal((await library.search({query:'laboratory',collection:'test'})).hits.length,1);
});

test('answers cannot finish with fabricated knowledge links or unverified line numbers', () => {
  const url='/?view=knowledge&knowledgeDoc=gl_example&line=2&endLine=2&sourceHash=abc';
  const messages=[{role:'assistant',tool_calls:[{id:'read',function:{name:'knowledge_read'}},{id:'cite',function:{name:'knowledge_cite'}}]},
    {role:'tool',tool_call_id:'read',content:JSON.stringify({lines:['Evidence']})},
    {role:'tool',tool_call_id:'cite',content:JSON.stringify({url})}];
  assert.doesNotThrow(()=>verifyKnowledgeAnswer({messages,text:`Answer [source](${url})`}));
  assert.throws(()=>verifyKnowledgeAnswer({messages,text:'Answer: L99'}),{code:'COMPLETE_RETRY'});
  assert.throws(()=>verifyKnowledgeAnswer({messages,text:`Answer [source](${url.replace('line=2','line=99')})`}),{code:'COMPLETE_RETRY'});
  const repeated=[...messages,...Array.from({length:2},()=>({name:'runtime_control',content:'知识库引用核验：修正出处'}))];
  assert.throws(()=>verifyKnowledgeAnswer({messages:repeated,text:'No checked links'}),{code:'KNOWLEDGE_CITATION'});
  assert.doesNotThrow(()=>verifyKnowledgeAnswer({messages:[],text:'No knowledge-base question.'}));
  assert.doesNotThrow(()=>verifyKnowledgeAnswer({messages:[...messages,{role:'user',name:'runtime_task_input',content:'谢谢'}],text:'不客气'}));
});

test('organizer retry compaction keeps complete source and latest validation without accumulating failed output', () => {
  const input={role:'user',name:'runtime_task_input',content:'L1: Original full source'};
  const messages=[{role:'system',content:'Rules'},input,{role:'assistant',tool_calls:[{id:'1',function:{arguments:'very large failed output'}}]},
    {role:'tool',tool_call_id:'1',content:'{"error":"copy literal quote"}'}];
  const compacted=compactKnowledgeRetries(messages).messages;
  assert.ok(compacted.some(m=>m===input));
  assert.ok(compacted.some(m=>m.content.includes('copy literal quote')));
  assert.ok(!JSON.stringify(compacted).includes('very large failed output'));
});


test('citation receipts survive compaction and corrected answers discard rejected drafts', t => {
  const store=new Store(':memory:');t.after(()=>store.close());
  store.db.exec('CREATE TABLE agent_trace (workspace_id TEXT,run_id TEXT,data TEXT)');
  const url='/?view=knowledge&knowledgeDoc=gl_test&line=2&endLine=2&sourceHash=abc';
  const add=(run,output)=>store.db.prepare('INSERT INTO agent_trace VALUES (?,?,?)').run('w',run,JSON.stringify({type:'tool.result',call:{function:{name:'knowledge_cite'}},output}));
  add('old',{url:url+'old'});add('current',{url});add('current',{url:url+'error',error:'rejected'});
  const evidence=knowledgeRunEvidence(store.db,{workspaceId:'w',runId:'current'});
  assert.deepEqual(evidence,{read:false,urls:[url]});
  const text=`Corrected [source](${url})`;
  const messages=[{role:'user',name:'runtime_task_input',content:'Question'},
    {role:'assistant',content:'Rejected [source]('+url+'fake)'},
    {role:'user',name:'runtime_control',content:'知识库引用核验：修正出处'},
    {role:'assistant',content:text}];
  assert.doesNotThrow(()=>verifyKnowledgeAnswer({messages,text:'Rejected draft '+text,evidence}));
  assert.equal(finalizeKnowledgeAnswer({messages,text:'Rejected draft '+text}).text,text);
  assert.throws(()=>verifyKnowledgeAnswer({messages,text,evidence:knowledgeRunEvidence(store.db,{workspaceId:'other',runId:'current'})}),{code:'COMPLETE_RETRY'});
});


test('wrapped compound hyphens match without relaxing identifiers or negative numbers',()=>{
  const text='On diffusion-\nweighted MRI, use high b-values.\nNot HLA-B in this source.';
  const result=locateKnowledgeEvidence(text,'On diffusion-weighted MRI, use high b-values.');
  assert.equal(result.startLine,1);assert.equal(result.endLine,2);
  assert.equal(result.quote,'On diffusion-\nweighted MRI, use high b-values.');
  assert.equal(locateKnowledgeEvidence('The identifier is HLA-B.','The identifier is HLAB.'),null);
  assert.equal(locateKnowledgeEvidence('Threshold -5 mg','Threshold 5 mg'),null);
  assert.equal(locateKnowledgeEvidence('diffusion-weighted MRI\ndiffusion-\nweighted MRI','diffusion-weighted MRI'),null);
});


test('large graphs rank relevant later evidence before limiting generic entity matches',()=>{
  const evidence=(quote,line)=>({docId:'allowed',quote,startLine:line,endLine:line});
  const generic=Array.from({length:15},(_,i)=>({id:String(i),label:'ABC',aliases:[],evidence:[evidence('ABC background introduction',i+1)]}));
  const relevant={id:'last',label:'ABC',aliases:[],evidence:[evidence('ABC exercise duration randomized participants',300)]};
  const hidden={id:'hidden',label:'ABC',aliases:[],evidence:[{...evidence('ABC exercise duration randomized participants',1),docId:'other'}]};
  const hits=KnowledgeOrganizer.prototype.searchEvidence.call({graph:()=>({nodes:[...generic,relevant,hidden],edges:[]})},'ABC exercise duration',new Set(['allowed']));
  assert.equal(hits[0].startLine,300);assert.ok(hits.every(h=>h.docId==='allowed'));
});
