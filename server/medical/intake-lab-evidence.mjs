import { createHash } from 'node:crypto';

const numberPattern = '[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';
const datePattern = /\b(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?\b/u;
const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s:：]/gu, '').trim();
const number = value => Number(String(value).replace(/,/g, ''));
const date = value => {
  const match = String(value ?? '').match(datePattern);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : '';
};
const cleanItem = value => value.trim().replace(/^(?:检验|化验|检测)(?:结果|项目)?\s*[:：]\s*/u, '').trim();

function readRows(sources) {
  const rows = [];
  for (const source of sources) {
    let section = false, reportDate = '';
    const lines = String(source.text || '').split('\n');
    for (let offset = 0; offset < lines.length; offset++) {
      const quote = lines[offset], text = quote.normalize('NFKC');
      if (/^(?:\s*#{1,6}\s*)?(?:检验|化验|实验室|血常规|生化)(?:记录|结果|报告|检查)?[\s:：,，]/u.test(text)) section = true;
      else if (/^(?:\s*#{1,6}\s*)?(?:用药|药物|就诊|病史|诊断|过敏|影像)(?:记录|经历|史)?[\s:：,，]/u.test(text)) section = false;
      if (/(?:采样|采集|检验|检查|报告)日期\s*[:：]/u.test(text)) reportDate = date(text);
      // Only explicit result fields, or a separated item/value/unit row, are
      // extracted. Narrative numbers and reference ranges are not measurements.
      const labelled = text.match(new RegExp(`(?:项目|检验项目|检测项目|item)\\s*[:：]?\\s*(.+?)\\s*[;；|\\t]\\s*(?:数值|测定值|结果|value|result)\\s*[:：]?\\s*([<>≤≥]?)\\s*(${numberPattern})(?=\\s|[;；|]|$)`, 'iu'));
      let item, value, unit, qualifier = '';
      if (labelled) {
        [, item, qualifier, value] = labelled;
        unit = text.match(/(?:单位|unit)\s*[:：]?\s*([^;；|\t(（]+)/iu)?.[1]?.trim().replace(/[。.,，]+$/u, '') || '';
      } else {
        const withoutDate = text.replace(datePattern, '').replace(/^\s*[:：|]\s*/u, '').trim();
        const separated = withoutDate.match(new RegExp(`^(.+?)\\s+(?:[:：]\\s*)?([<>≤≥]?)\\s*(${numberPattern})\\s*((?:[a-zA-Zμµ%/°]|10\\^)[a-zA-Z0-9μµ%/^.×*+-]*)(?=\\s|[;；|,，。)]|$)`, 'u'));
        if (!separated || (!section && !/^(?:检验|化验|检测)\s*[:：]/u.test(withoutDate))) continue;
        [, item, qualifier, value, unit] = separated;
      }
      item = cleanItem(item);
      unit = String(unit || '').replace(/[。.,，]+$/u, '');
      if (!item || /(?:参考|范围|日期|编号|未检测|未检验|未提供)/u.test(item) || /^e[+-]?\d+$/iu.test(unit) || !Number.isFinite(number(value))) continue;
      rows.push({ sourceId: source.id, sourceName: source.name, startLine: offset + 1, endLine: offset + 1, quote,
        item, value: number(value), unit: unit || '', qualifier, date: date(text) || reportDate });
    }
  }
  return rows;
}

function citedLines(source, citation) {
  if (!citation || (!citation.includes(source.name) && !citation.includes(source.id))) return null;
  const start = Math.max(citation.indexOf(source.name), citation.indexOf(source.id));
  const tail = citation.slice(start);
  const match = tail.match(/(?:第\s*|\bL)(\d+)\s*(?:[–—−~-]\s*(?:L|第)?\s*(\d+))?\s*(?:行|\b)/iu);
  if (!match) return { startLine: 1, endLine: String(source.text || '').split('\n').length, bounded: false };
  return { startLine: Number(match[1]), endLine: Number(match[2] || match[1]), bounded: true };
}

function citationEvidence(sources, citation) {
  for (const source of sources) {
    const range = citedLines(source, citation);
    if (!range) continue;
    const lines = String(source.text || '').split('\n');
    if (range.startLine < 1 || range.endLine < range.startLine || range.startLine > lines.length) continue;
    return { sourceId: source.id, sourceName: source.name, startLine: range.startLine,
      endLine: Math.min(range.endLine, lines.length), quote: lines.slice(range.startLine - 1, Math.min(range.endLine, range.startLine + 4)).join('\n') };
  }
  return { sourceId: '', sourceName: '', startLine: 0, endLine: 0, quote: '' };
}

function issue(kind, message, evidence, claim, index) {
  const { sourceId, sourceName, startLine, endLine, quote } = evidence;
  const identity = JSON.stringify([kind, sourceId, startLine, endLine, quote, claim]);
  return { id: `lab-${createHash('sha256').update(identity).digest('hex').slice(0, 24)}`, section: 'labs', kind,
    message, sourceId, sourceName, startLine, endLine, quote, ...(index === undefined ? {} : { index }) };
}

/** Audit extracted lab claims against imported text; never manufacture a result. */
export function auditIntakeLabs({ payload, sources, notes = [] }) {
  void notes; // Original text remains authoritative when model notes disagree.
  if (!Array.isArray(sources) || !sources.length) return [];
  const rows = readRows(sources), issues = [], represented = new Set();
  for (const [index, lab] of (payload.labs || []).entries()) {
    const claim = { item: lab.item, value: lab.value, unit: lab.unit || '', date: lab.date || '', source: lab.source || '' };
    const itemRows = rows.filter(row => normalize(row.item) === normalize(lab.item));
    const dated = itemRows.filter(row => !row.date || !date(lab.date) || row.date === date(lab.date));
    const citation = String(lab.source || '');
    const cited = rows.filter(row => {
      const source = sources.find(source => source.id === row.sourceId), range = citedLines(source, citation);
      return range && row.startLine >= range.startLine && row.endLine <= range.endLine;
    });
    const candidates = citation ? dated.filter(row => cited.includes(row)) : dated;
    const exact = candidates.filter(row => !row.qualifier && row.value === Number(lab.value) && normalize(row.unit) === normalize(lab.unit)
      && (!row.date || row.date === date(lab.date)));
    if (exact.length && citation) {
      for (const row of exact) represented.add(row);
      // Identical measurements copied into another document do not create a
      // spurious omission; differing results on the same day remain reviewable.
      for (const row of rows) if (exact.some(other => normalize(row.item) === normalize(other.item) && row.date === other.date
        && row.value === other.value && normalize(row.unit) === normalize(other.unit) && row.qualifier === other.qualifier)) represented.add(row);
      continue;
    }
    const conflicting = exact.length ? null : candidates.length === 1 ? candidates[0] : cited.length === 1 ? cited[0] : null;
    if (conflicting) {
      represented.add(conflicting);
      issues.push(issue('value-conflict', `“${lab.item}”的项目、结果、单位或日期与所引原文不一致，请逐项核对；不能以摘要代替原文。`, conflicting, claim, index));
    } else {
      // Unrecognized layouts require an explicit human review instead of a
      // guessed value. The citation is a navigation aid, not proof of accuracy.
      issues.push(issue('source-unverified', `未能从明确原文核实“${lab.item}”的结果、单位及日期，请补充来源并核对。`, citationEvidence(sources, citation), claim, index));
      for (const row of exact) represented.add(row);
    }
  }
  for (const row of rows) {
    if (represented.has(row)) continue;
    const claim = { item: row.item, date: row.date, value: row.value, unit: row.unit, qualifier: row.qualifier };
    issues.push(issue('omission', `原文检验“${row.item}”${row.date ? `（${row.date}）` : ''}尚未完整纳入草稿，请补充或说明排除理由。`, row, claim));
  }
  return issues;
}
