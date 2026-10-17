// Resolve a literal quotation to original offsets, including PDF line wrapping.
// No synonyms, case folding, punctuation changes or inferred medical wording.
const wrappedCompounds = text => new Set([...text.matchAll(/([A-Za-z]+)-[ \t]*\r?\n[ \t]*([A-Za-z]+)/g)].map(m=>m[1]+'-'+m[2]));
function indexedText(text, wrapped = wrappedCompounds(text)) {
  const offsets = [], characters = [];
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) continue;
    if (text[i] === '-' && /[A-Za-z]/.test(text[i - 1] || '')) {
      if (/^\s*\n\s*[A-Za-z]/.test(text.slice(i + 1))) continue;
      // A wrapped hyphen may be a compound separator, not a soft hyphen.
      // Accept either rendering only for compounds actually wrapped in source;
      // leave ordinary identifiers and all numeric signs untouched.
      const left = text.slice(0,i).match(/[A-Za-z]+$/)?.[0];
      const right = text.slice(i+1).match(/^[A-Za-z]+/)?.[0];
      if (wrapped.has(left+'-'+right)) continue;
    }
    offsets.push(i);
    characters.push(text[i]);
  }
  return { text: characters.join(''), offsets };
}

export const knowledgeEvidenceText = (text, sourceText = text) => indexedText(text, wrappedCompounds(sourceText)).text;

export function locateKnowledgeEvidence(text, quote, { startLine, endLine, baseLine = 1, maxLines = 40 } = {}) {
  if (typeof quote !== 'string' || quote.trim().length < 4) return null;
  const wrapped = wrappedCompounds(text);
  const source = indexedText(text, wrapped), needle = indexedText(quote, wrapped).text;
  if (!needle) return null;
  const matches = [];
  for (let at = source.text.indexOf(needle); at >= 0; at = source.text.indexOf(needle, at + 1)) {
    const start = source.offsets[at], end = source.offsets[at + needle.length - 1] + 1;
    const first = baseLine + (text.slice(0, start).match(/\n/g) || []).length;
    const last = first + (text.slice(start, end).match(/\n/g) || []).length;
    if (last - first <= maxLines) matches.push({ quote: text.slice(start, end), startLine: first, endLine: last });
  }
  const scoped = matches.filter(m => m.startLine >= startLine && m.endLine <= endLine);
  return scoped.length === 1 ? scoped[0] : matches.length === 1 ? matches[0] : null;
}

export function knowledgeCitationUrl(doc, startLine, endLine) {
  return '/?' + new URLSearchParams({ view: 'knowledge', knowledgeDoc: doc.id,
    line: String(startLine), endLine: String(endLine), sourceHash: doc.sha256 });
}
