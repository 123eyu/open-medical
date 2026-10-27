export function retrievalLabel(hit) {
  if (hit.matchedVia === 'text') return hit.lexicalMatchType === 'partial' ? '部分词语命中' : hit.lexicalMatchType === 'exact' ? '关键词命中' : '文字相关';
  if (hit.matchedVia === 'vector') return '语义相关';
  if (hit.matchedVia === 'hybrid') return hit.lexicalMatchType === 'partial' ? '部分词语与语义相关' : '关键词与语义相关';
  if (hit.matchedVia === 'graph') return '原文图谱关联';
  return '匹配方式未提供';
}
export function retrievalMatches(hit, query) {
  return hit.retrievalMatches?.length ? hit.retrievalMatches : [{ query: hit.queryUsed || query, original: !hit.queryUsed || hit.queryUsed === query,
    matchedVia: hit.matchedVia, lexicalMatchType: hit.lexicalMatchType, matchedTerms: hit.matchedTerms || [] }];
}
export function highlightFragments(text, originalTerms = [], expandedTerms = []) {
  const original = new Set(originalTerms.filter(t => typeof t === 'string').map(t => t.toLowerCase()));
  const terms = [...new Set([...originalTerms, ...expandedTerms].filter(t => typeof t === 'string' && t.length && t.length <= 200))].sort((a, b) => b.length - a.length).slice(0, 80);
  if (!terms.length) return [{ text, kind: null }];
  const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(escaped.join('|'), 'giu'), result = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) result.push({ text: text.slice(cursor, match.index), kind: null });
    result.push({ text: match[0], kind: original.has(match[0].toLowerCase()) ? 'original' : 'expanded' });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) result.push({ text: text.slice(cursor), kind: null });
  return result;
}
