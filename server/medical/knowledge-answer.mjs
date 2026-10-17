import { check } from '../errors.mjs';

// Require model-authored source links to come from successful citation tools.
// This validates provenance, not the medical interpretation of the quotation.
export function verifyKnowledgeAnswer({messages = [], text = '', evidence = {}}) {
  // Old turns are background evidence, not an obligation to cite on every
  // subsequent greeting or unrelated task.
  const latestInput = messages.findLastIndex(m => m.role === 'user' && m.name === 'runtime_task_input');
  if (latestInput >= 0) messages = messages.slice(latestInput);
  // Runtime text contains earlier rejected drafts as well as the final answer.
  text = finalKnowledgeCandidate(messages) ?? text;
  const calls = new Map(), citations = new Set(evidence.urls || []);
  let read = Boolean(evidence.read);
  for (const message of messages) {
    for (const call of message.tool_calls || []) calls.set(call.id, call.function?.name);
    if (message.role !== 'tool') continue;
    const name = calls.get(message.tool_call_id);
    if (!['knowledge_read','guideline_read','knowledge_cite','guideline_cite'].includes(name)) continue;
    let value;try {value=JSON.parse(message.content);}catch{continue;}
    if (value?.error) continue;
    if (name.endsWith('_read') && Array.isArray(value?.lines)) read = true;
    if (name.endsWith('_cite') && typeof value?.url === 'string') citations.add(value.url);
  }
  const links = [...text.matchAll(/\]\((\/\?view=knowledge&[^\s)]+)\)/g)].map(m => m[1].replaceAll('&amp;','&'));
  if (!read && !citations.size && !links.length) return;
  if (links.length && links.every(link => citations.has(link))) return;
  const attempts = messages.filter(m => m.name === 'runtime_control' && m.content?.includes('知识库引用核验：')).length;
  check(false, attempts < 2 ? 'COMPLETE_RETRY' : 'KNOWLEDGE_CITATION',
    '知识库引用核验：回答缺少已核验的引用链接，或含未经核验的链接。请对实际支持结论的连续原文调用 knowledge_cite，复制返回的 citation；每个知识库链接必须来自成功返回。删除无法支持的结论，不要自行拼行号、哈希或链接。若仅报告资料不完整，可引用原文中的范围说明。');
}

function finalKnowledgeCandidate(messages) {
  const last = messages.at(-1);
  return last?.role === 'assistant' && !last.tool_calls?.length && typeof last.content === 'string' ? last.content : null;
}

export function finalizeKnowledgeAnswer(result) {
  const messages = result.messages || [];
  const candidate = finalKnowledgeCandidate(messages);
  if (candidate !== null && (candidate.includes('](/?view=knowledge') ||
    messages.some(m => m.name === 'runtime_control' && m.content?.includes('知识库引用核验：')))) {
    return {...result, text: candidate};
  }
  return result;
}

// Tool receipts survive model-context compaction. Scope them to this exact run;
// quotations from previous runs must not authorize newly invented links.
export function knowledgeRunEvidence(db, {workspaceId, runId} = {}) {
  if (!workspaceId || !runId) return {};
  const rows = db.prepare(`SELECT data FROM agent_trace WHERE workspace_id=? AND run_id=?
    AND json_extract(data,'$.type')='tool.result'
    AND json_extract(data,'$.call.function.name') IN ('knowledge_read','guideline_read','knowledge_cite','guideline_cite')`).all(workspaceId,runId);
  const urls = new Set(); let read = false;
  for (const row of rows) {
    const {call,output} = JSON.parse(row.data);
    if (!output || output.error) continue;
    if (call.function.name.endsWith('_read') && Array.isArray(output.lines)) read = true;
    if (call.function.name.endsWith('_cite') && typeof output.url === 'string') urls.add(output.url);
  }
  return {read, urls:[...urls]};
}
