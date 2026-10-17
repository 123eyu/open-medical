import { normalizeMedicalTerm } from './medical-graph.mjs';

// Search labels and source-provided aliases; never invent synonyms or edges.
// Multi-entity questions match each term independently, including entities
// embedded in a Chinese sentence without spaces.
export function graphNodeScore(node, query) {
  const search = normalizeMedicalTerm(query);
  if (!search) return 1;
  const terms = search.match(/[\p{L}\p{N}]+(?:[.-][\p{L}\p{N}]+)*/gu) || [];
  if (!terms.length) return 0;
  return Math.max(0, ...[node.label, ...(node.aliases || [])].filter(Boolean).map(raw => {
    const label = normalizeMedicalTerm(raw);
    if (label === search) return 100;
    if (label.includes(search)) return 80;
    if (label.length > 1 && search.includes(label)) return 70;
    return terms.reduce((score, term) => score + (label.includes(term) || (label.length > 1 && term.includes(label)) ? 10 : 0), 0);
  }));
}

export function graphSlice(graph, {
  query = '', type = '', community = '', relation = '', selected = '',
  limit = 90, edgeLimit = Infinity, includeNeighbors = false,
} = {}) {
  const nodeIds = new Set(graph.nodes.map(n => n.id));
  const allowedEdges = graph.edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to) && (!relation || e.relationType === relation));
  const relatedIds = new Set(allowedEdges.flatMap(e => [e.from, e.to]));
  const scores = new Map(graph.nodes.map(n => [n.id, graphNodeScore(n, query)]));
  const matches = graph.nodes.filter(n => (!type || n.type === type) && (!community || n.community === community) && (!relation || relatedIds.has(n.id)) && scores.get(n.id) > 0);
  const matchIds = new Set(matches.map(n => n.id));
  const seeds = selected ? new Set([selected]) : matchIds;
  const incident = allowedEdges.filter(e => seeds.has(e.from) || seeds.has(e.to));
  const neighbors = new Set(incident.flatMap(e => [e.from, e.to]));
  const candidates = selected
    ? graph.nodes.filter(n => n.id === selected || (neighbors.has(n.id) && matchIds.has(n.id)))
    : includeNeighbors && query.trim()
      ? graph.nodes.filter(n => matchIds.has(n.id) || neighbors.has(n.id))
      : matches;
  const candidateIds = new Set(candidates.map(n => n.id));
  const relevantEdges = allowedEdges.filter(e => candidateIds.has(e.from) && candidateIds.has(e.to) && (!includeNeighbors || !query.trim() || seeds.has(e.from) || seeds.has(e.to)));
  const nodes = [...candidates].sort((a, b) =>
    (b.id === selected) - (a.id === selected) ||
    Number(matchIds.has(b.id)) - Number(matchIds.has(a.id)) ||
    (scores.get(b.id) || 0) - (scores.get(a.id) || 0) ||
    (b.degree || 0) - (a.degree || 0) || a.id.localeCompare(b.id),
  ).slice(0, limit);
  const ids = new Set(nodes.map(n => n.id));
  const edges = relevantEdges.filter(e => ids.has(e.from) && ids.has(e.to)).slice(0, edgeLimit);
  return { nodes, edges, total: candidates.length, matchedNodes: matches.length, matchedEdges: relevantEdges.length,
    truncated: candidates.length > nodes.length || relevantEdges.length > edges.length };
}
