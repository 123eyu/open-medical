export function recommendedKnowledgeView(diagrams = []) {
  if (diagrams.some((d) => d.type === "flowchart")) return "flowchart";
  if (diagrams.some((d) => d.type === "mindmap")) return "mindmap";
  return "graph";
}
export function wrapDiagramText(text, size = 18) {
  const chars = Array.from(text || ""),
    lines = [];
  for (let i = 0; i < chars.length; i += size)
    lines.push(chars.slice(i, i + size).join(""));
  return lines.length ? lines : [""];
}
// Layout follows the saved source structure. Documented cycles use side lanes.
export function layoutKnowledgeDiagram(diagram) {
  const nodes = diagram.nodes.map((n) => {
    const lines = wrapDiagramText(n.label);
    const textWidth = Math.max(...lines.map((l) => Array.from(l).length)) * 14;
    return {
      ...n,
      width:
        n.role === "decision"
          ? Math.max(220, textWidth * 1.8 + 40)
          : Math.max(150, textWidth + 32),
      height:
        n.role === "decision"
          ? Math.max(100, lines.length * 36 + 30)
          : Math.max(58, lines.length * 18 + 30),
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map(nodes.map((n) => [n.id, []]));
  for (const e of diagram.edges) outgoing.get(e.from)?.push(e.to);
  const root = byId.get(diagram.rootId) || nodes[0];
  const depths = new Map([[root.id, 0]]),
    queue = [root.id];
  for (let i = 0; i < queue.length; i++)
    for (const id of outgoing.get(queue[i]))
      if (!depths.has(id)) {
        depths.set(id, depths.get(queue[i]) + 1);
        queue.push(id);
      }
  const maxWidth = Math.max(...nodes.map((n) => n.width));
  const maxHeight = Math.max(...nodes.map((n) => n.height));
  if (diagram.type === "mindmap") {
    let leaf = 0;
    const place = (id) => {
      const n = byId.get(id),
        children = outgoing.get(id);
      n.x = maxWidth / 2 + 30 + depths.get(id) * (maxWidth + 100);
      if (!children.length)
        n.y = maxHeight / 2 + 30 + leaf++ * (maxHeight + 40);
      else {
        children.forEach(place);
        n.y =
          children.reduce((sum, child) => sum + byId.get(child).y, 0) /
          children.length;
      }
    };
    place(root.id);
  } else {
    const levels = new Map();
    for (const n of nodes) {
      const depth = depths.get(n.id) || 0;
      if (!levels.has(depth)) levels.set(depth, []);
      levels.get(depth).push(n);
    }
    const columns = Math.max(...[...levels.values()].map((a) => a.length));
    let y = 30;
    for (const [depth, row] of [...levels].sort((a, b) => a[0] - b[0])) {
      const rowHeight = Math.max(...row.map((n) => n.height));
      row.forEach((n, i) => {
        n.x =
          maxWidth / 2 +
          30 +
          ((columns - row.length) / 2 + i) * (maxWidth + 100);
        n.y = y + rowHeight / 2;
      });
      const labels = diagram.edges.filter(
        (e) => depths.get(e.from) === depth && depths.get(e.to) > depth,
      );
      y +=
        rowHeight +
        Math.max(
          0,
          ...labels.map((e) =>
            e.label ? wrapDiagramText(e.label).length * 18 + 16 : 0,
          ),
        ) +
        70;
    }
  }
  const labelWidth = text => Math.max(60, Math.max(...wrapDiagramText(text).map(l => Array.from(l).length)) * 14 + 24);
  let sideLane = Math.max(...nodes.map((n) => n.x + Math.max(n.width / 2, 136))) + 40;
  const edges = diagram.edges.map((e, index) => {
    e = { ...e, labelWidth: labelWidth(e.label) };
    const a = byId.get(e.from),
      b = byId.get(e.to);
    if (diagram.type === "mindmap")
      return {
        ...e,
        key: index,
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        path: `M ${a.x + a.width / 2} ${a.y} C ${a.x + a.width / 2 + 50} ${a.y}, ${b.x - b.width / 2 - 50} ${b.y}, ${b.x - b.width / 2} ${b.y}`,
      };
    if (b.y <= a.y) {
      const side = sideLane + e.labelWidth / 2;
      sideLane += e.labelWidth + 30;
      return {
        ...e,
        key: index,
        x: side,
        y: (a.y + b.y) / 2,
        path: `M ${a.x + a.width / 2} ${a.y} H ${side} V ${b.y} H ${b.x + b.width / 2}`,
      };
    }
    const ay = a.y + a.height / 2,
      by = b.y - b.height / 2;
    return {
      ...e,
      key: index,
      x: b.x,
      y: (ay + by) / 2 + 10,
      path: `M ${a.x} ${ay} V ${ay + 20} H ${b.x} V ${by}`,
    };
  });
  return {
    nodes,
    edges,
    root,
    width: Math.max(
      ...nodes.map((n) => n.x + n.width / 2 + 30),
      ...edges.map((e) => e.x + (e.label ? e.labelWidth / 2 + 20 : 0)),
    ),
    height: Math.max(...nodes.map((n) => n.y + n.height / 2)) + 30,
  };
}
