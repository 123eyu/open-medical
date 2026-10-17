import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { graphSlice } from '../shared/knowledge-graph-search.mjs';
import { assembleKnowledgeGraph } from '../server/medical/knowledge-graph.mjs';

const evidence = {quote:'虚构疾病甲与虚构药物乙关联；虚构指标丙用于观察。',startLine:1,endLine:1};
const graph = () => assembleKnowledgeGraph([{doc:{id:'source-a',title:'虚构来源',sha256:'source-hash'},analysis:{batches:[{
  nodes:[{label:'虚构疾病甲',type:'疾病',aliases:['Example Syndrome'],...evidence},{label:'虚构药物乙',type:'药物',aliases:['TestMed'],...evidence},{label:'虚构指标丙',type:'指标',...evidence}],
  relations:[{from:'虚构疾病甲',to:'虚构药物乙',relation:'资料讨论',...evidence},{from:'虚构药物乙',to:'虚构指标丙',relation:'观察',...evidence}],
}]}}]);

test('graph query shares multi-term and alias matching with UI and returns grounded one-hop neighbors', () => {
  const source=graph();
  const multi=graphSlice(source,{query:'疾病甲 药物乙',includeNeighbors:true});
  assert.equal(multi.matchedNodes,2); assert.equal(multi.nodes.length,3); assert.equal(multi.edges.length,2);
  assert.equal(graphSlice(source,{query:'疾病甲、药物乙'}).matchedNodes,2);
  const alias=graphSlice(source,{query:'EXAMPLE SYNDROME',includeNeighbors:true});
  assert.equal(alias.matchedNodes,1); assert.equal(alias.nodes.length,2); assert.equal(alias.edges.length,1);
  assert.equal(alias.nodes[0].label,'虚构疾病甲');
  assert.equal(alias.edges[0].docId,'source-a'); assert.equal(alias.edges[0].quote,evidence.quote); assert.equal(alias.edges[0].sourceHash,'source-hash');
  assert.equal(graphSlice(source,{query:'虚构疾病甲的相关药物',includeNeighbors:true}).matchedNodes,1);
  assert.equal(graphSlice(source,{query:'完全不存在'}).matchedNodes,0);
  assert.ok(multi.edges.every(e=>multi.nodes.some(n=>n.id===e.from)&&multi.nodes.some(n=>n.id===e.to)));
});

test('graph truncation reports dropped neighbors and parallel source edges without dangling endpoints', () => {
  const nodes=Array.from({length:36},(_,i)=>({id:String(i),label:i?'邻居'+i:'中心',aliases:[],degree:i?1:35}));
  const edges=nodes.slice(1).flatMap(n=>Array.from({length:2},(_,i)=>({id:`e${n.id}-${i}`,from:'0',to:n.id,docId:`doc-${i}`})));
  const result=graphSlice({nodes,edges},{query:'中心',includeNeighbors:true,limit:30,edgeLimit:50});
  assert.equal(result.matchedNodes,1); assert.equal(result.total,36); assert.equal(result.matchedEdges,70);
  assert.equal(result.nodes.length,30); assert.equal(result.edges.length,50); assert.equal(result.truncated,true);
  assert.ok(result.edges.every(e=>result.nodes.some(n=>n.id===e.from)&&result.nodes.some(n=>n.id===e.to)));
});

test('registered map tool distinguishes empty graph from no match, preserves citations and reports evidence limits', async t => {
  const f=await fixture(t);
  const tool=f.server.runtime.toolPlugins.get('knowledge_map');
  const source=graph(); source.nodes[0].evidence=Array.from({length:4},(_,i)=>({...source.nodes[0].evidence[0],startLine:i+1,endLine:i+1}));
  const organizer=f.server.knowledgeOrganizer;
  t.mock.method(organizer,'graph',collection=>collection==='empty'?{nodes:[],edges:[]}:source);
  const empty=tool.execute({collection:'empty',query:'疾病甲'});
  assert.equal(empty.status,'empty_graph'); assert.equal(empty.graphNodes,0);
  const absent=tool.execute({collection:'synthetic',query:'不存在'});
  assert.equal(absent.status,'no_matches'); assert.equal(absent.graphNodes,3); assert.equal(absent.graphEdges,2);
  const found=tool.execute({collection:'synthetic',query:'疾病甲 TestMed'});
  assert.equal(found.status,'matched'); assert.equal(found.matchedNodes,2); assert.equal(found.returnedNodes,3); assert.equal(found.returnedEdges,2);
  assert.equal(found.truncated,true); assert.equal(found.nodes.find(n=>n.id===source.nodes[0].id).evidenceCount,4);
  assert.equal(found.nodes.find(n=>n.id===source.nodes[0].id).evidence.length,3);
  assert.equal(found.collection,'synthetic');
});
