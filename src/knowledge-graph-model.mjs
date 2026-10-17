export const nodeColors = {
  疾病: "#b86b51",
  诊断: "#b86b51",
  症状: "#b98b39",
  体征: "#b98b39",
  药物: "#537aab",
  检查: "#8a6baa",
  指标: "#8a6baa",
  治疗: "#397d72",
  诊疗路径: "#397d72",
  禁忌: "#b55362",
  不良反应: "#b55362",
  人群: "#8a8271",
  随访: "#5b8b63",
};
export { graphSlice } from "../shared/knowledge-graph-search.mjs";
// Deterministic force layout: graph topology drives positions, collision forces
// reserve label space. Computed only when the visible subgraph changes.
export function layoutGraph(nodes, edges) {
  if (!nodes.length) return [];
  const points = nodes.map((n, i) => ({
    ...n,
    x: 480 + Math.cos(i * 2.39996) * Math.sqrt(i + 1) * 35,
    y: 300 + Math.sin(i * 2.39996) * Math.sqrt(i + 1) * 28,
  }));
  const byId = new Map(points.map((n) => [n.id, n]));
  const topology = [
    ...new Map(edges.map((e) => [[e.from, e.to].sort().join(":"), e])).values(),
  ];
  for (let step = 0; step < 180; step++) {
    const force = new Map(
      points.map((n) => [
        n.id,
        { x: (480 - n.x) * 0.012, y: (300 - n.y) * 0.012 },
      ]),
    );
    for (let i = 0; i < points.length; i++)
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i],
          b = points[j],
          dx = a.x - b.x,
          dy = a.y - b.y,
          d = Math.max(1, Math.hypot(dx, dy));
        const repulsion = 1400 / (d * d) + (d < 125 ? (125 - d) * 0.065 : 0);
        force.get(a.id).x += (dx / d) * repulsion;
        force.get(a.id).y += (dy / d) * repulsion;
        force.get(b.id).x -= (dx / d) * repulsion;
        force.get(b.id).y -= (dy / d) * repulsion;
      }
    for (const e of topology) {
      const a = byId.get(e.from),
        b = byId.get(e.to);
      if (!a || !b) continue;
      const dx = b.x - a.x,
        dy = b.y - a.y,
        d = Math.max(1, Math.hypot(dx, dy)),
        pull = (d - 155) * 0.018;
      force.get(a.id).x += (dx / d) * pull;
      force.get(a.id).y += (dy / d) * pull;
      force.get(b.id).x -= (dx / d) * pull;
      force.get(b.id).y -= (dy / d) * pull;
    }
    const cooling = 1 - step / 220;
    for (const n of points) {
      const f = force.get(n.id);
      n.x += Math.max(-12, Math.min(12, f.x)) * cooling;
      n.y += Math.max(-12, Math.min(12, f.y)) * cooling;
    }
  }
  return points;
}

export const graphEdgeKey = (e) =>
  JSON.stringify([e.from, e.to, e.relation, e.relationType, e.assertion]);
export function bundleGraphEdges(edges) {
  const groups = new Map();
  for (const edge of edges) {
    const key = graphEdgeKey(edge),
      group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { ...edge, count: 1 });
  }
  const pairs = new Map();
  for (const edge of groups.values()) {
    const key = [edge.from, edge.to].sort().join(":");
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(edge);
  }
  for (const pair of pairs.values())
    pair.forEach((edge, i) => {
      edge.curve =
        (i - (pair.length - 1) / 2) * 52 * (edge.from < edge.to ? 1 : -1);
    });
  return [...groups.values()];
}
