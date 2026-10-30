import { createHash } from "node:crypto";
import { knowledgeProfile } from "../../shared/knowledge-profiles.mjs";

export const KNOWLEDGE_TEXT_LIMIT = 2000000;
export const CHUNK_VERSION = "structure-v1";
const pageNumber = (line) =>
  Number(line.match(/^\[(?:PDF\s*)?第\s*(\d+)\s*页\]/)?.[1]) || null;
const headingOf = (line) => {
  const md = line.match(/^(#{1,6})\s+(.{1,160})$/);
  if (md) return { level: md[1].length, title: md[2] };
  if (
    /^(第[一二三四五六七八九十百\d]+[章节篇]|\d+(?:\.\d+){0,3}\s+|【[^】]+】)/.test(
      line,
    ) &&
    line.length <= 80 &&
    !/[。；;.!?]$/.test(line)
  )
    return { level: 2, title: line };
  if (/^\[工作表：/.test(line)) return { level: 1, title: line };
  return null;
};

// Exact source slices remain separate from inherited headings/table headers.
// Character bounds are conservative; this is not advertised as token counting.
export function knowledgeChunks(
  text,
  { maxChars = 1600, kind, sourceKind } = {},
) {
  const lines = text.split("\n"),
    chunks = [];
  let page = null,
    headings = [],
    current = [],
    size = 0,
    start = 1,
    startColumn = 0,
    header = "";
  let metadata = {};
  const flush = () => {
    if (!current.length) return;
    const body = current.join("\n");
    const context = [...metadata.headings, metadata.tableHeader]
      .filter(Boolean)
      .join("\n")
      .slice(0, 350);
    chunks.push({
      ord: chunks.length + 1,
      startLine: start,
      endLine: start + current.length - 1,
      text: body,
      metadata: {
        ...metadata,
        startColumn,
        endColumn:
          current.at(-1).length + (current.length === 1 ? startColumn : 0),
      },
      embeddingText: context ? `${context}\n${body}` : body,
    });
    current = [];
    size = 0;
    startColumn = 0;
  };
  for (const [i, line] of lines.entries()) {
    const nextPage = pageNumber(line),
      heading = headingOf(line);
    if (nextPage || heading) {
      flush();
      header = "";
      if (nextPage) page = nextPage;
      if (heading) {
        headings = headings.slice(0, heading.level - 1);
        headings[heading.level - 1] = heading.title;
      }
    }
    if (
      /^\s*\|.*\|\s*$/.test(line) &&
      /^\s*\|?\s*:?-{3}/.test(lines[i + 1] || "")
    ) {
      flush();
      header = line;
    } else if (header && line.trim() && !line.includes("|")) {
      flush();
      header = "";
    }
    if (
      current.length &&
      (size + line.length + 1 > maxChars || current.length >= 60)
    )
      flush();
    let offset = 0;
    do {
      if (!current.length) {
        start = i + 1;
        startColumn = offset;
        const sheet = headings
          .filter(Boolean)
          .findLast((h) => /^\[工作表：/.test(h));
        const rowMatch = line.match(/^行 (\d+):/);
        metadata = {
          sheet: sheet?.slice(5, -1),
          row: rowMatch ? Number(rowMatch[1]) : null,
          headings: headings.filter(Boolean),
          page,
          tableHeader: header,
          sourceKind: knowledgeProfile(sourceKind, kind).name,
          chunkVersion: CHUNK_VERSION,
        };
      }
      let end = Math.min(line.length, offset + maxChars);
      if (end < line.length && /[\uD800-\uDBFF]/.test(line[end - 1])) end--;
      const row = line.match(/^行 (\d+):/);
      if (row) {
        metadata.row = Number(row[1]);
        metadata.cells = [...line.matchAll(/(?:^|\s)([A-Z]+\d+)(?:【|=)/g)].map(
          (m) => m[1],
        );
      }
      current.push(line.slice(offset, end));
      size += end - offset + 1;
      offset = end;
      if (offset < line.length) flush();
    } while (offset < line.length);
  }
  flush();
  return chunks;
}

export function sourceCoverage(
  text,
  {
    extraction,
    trusted = false,
    excerpt = false,
    originalRetained = false,
    sampled = false,
  } = {},
) {
  const markers = [...text.matchAll(/^\[(?:PDF\s*)?第\s*(\d+)\s*页\]/gm)].map(
    (m) => Number(m[1]),
  );
  const totalPages = Number.isInteger(extraction?.pageCount)
    ? extraction.pageCount
    : null;
  const pages = [...new Set(markers)];
  const missingPages = totalPages
    ? Array.from({ length: totalPages }, (_, i) => i + 1).filter(
        (p) => !pages.includes(p),
      )
    : [];
  const emptyPages = [...new Set(extraction?.emptyPages || [])];
  const gaps =
    sampled ||
    /\[(?:本页未识别到文字|本页没有可提取文字)/.test(text) ||
    missingPages.length > 0 ||
    emptyPages.length > 0;
  return {
    status: excerpt
      ? "excerpt"
      : gaps
        ? "needs_review"
        : trusted
          ? "complete"
          : "unknown",
    totalPages,
    processedPages: totalPages
      ? pages.filter((p) => p <= totalPages).length
      : pages.length,
    missingPages,
    emptyPages,
    originalRetained,
    textHash: createHash("sha256").update(text).digest("hex"),
    sampled,
    note: sampled
      ? "视频画面为抽样识别，不代表完整视觉内容。"
      : trusted
        ? "处理范围指提交的文件或附件文本，不代表来源或临床内容已复核。"
        : "未与原文件核对完整性。",
  };
}

export function knowledgeTokens(text) {
  const normalized = text.normalize("NFKC").toLowerCase();
  const tokens =
    normalized.match(/[a-z0-9]+(?:[.-][a-z0-9]+)*|[\u3400-\u9fff]+/g) || [];
  return tokens.flatMap((token) =>
    /^[\u3400-\u9fff]+$/.test(token) && token.length > 1
      ? Array.from({ length: token.length - 1 }, (_, i) =>
          token.slice(i, i + 2),
        )
      : [token],
  );
}

// Chunk token statistics are reused across queries: tokenizing every chunk on
// each search dominated latency for larger libraries. Keyed by the exact text,
// so edited or re-chunked content never reuses stale statistics.
const tokenCache = new Map();
const TOKEN_CACHE_LIMIT = 50000;
function tokenStats(text) {
  let stats = tokenCache.get(text);
  if (stats) return stats;
  const counts = new Map();
  const tokens = knowledgeTokens(text);
  for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);
  stats = { counts, length: tokens.length };
  if (tokenCache.size >= TOKEN_CACHE_LIMIT) tokenCache.delete(tokenCache.keys().next().value);
  tokenCache.set(text, stats);
  return stats;
}

export function bm25Scores(query, records) {
  const terms = [...new Set(knowledgeTokens(query))];
  const stats = records.map((r) => tokenStats(r.text));
  const average =
    stats.reduce((s, t) => s + t.length, 0) / (records.length || 1) || 1;
  const dfs = new Map(
    terms.map((term) => [
      term,
      stats.reduce((n, s) => n + (s.counts.has(term) ? 1 : 0), 0),
    ]),
  );
  return stats.map(({ counts, length }) =>
    terms.reduce((score, term) => {
      const tf = counts.get(term) || 0;
      if (!tf) return score;
      const idf = Math.log(
        1 + (records.length - dfs.get(term) + 0.5) / (dfs.get(term) + 0.5),
      );
      return (
        score +
        (idf * tf * 2.2) /
          (tf + 1.2 * (0.25 + (0.75 * length) / average))
      );
    }, 0),
  );
}
