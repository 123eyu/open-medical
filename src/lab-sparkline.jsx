// A tiny trend line for list rows. It only draws when there are at least two
// distinct dates and no same-day conflicts — otherwise a line would imply an
// order that the records do not have.
export function LabSparkline({ group, width = 96, height = 28, flag = "" }) {
  const points = group.points || [];
  const dates = [...new Set(points.map((p) => p.date))];
  if (dates.length < 2 || group.conflict) return null;
  const recent = points.slice(-8);
  const values = recent.map((p) => p.value);
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const start = Date.parse(recent[0].date), end = Date.parse(recent.at(-1).date);
  const x = (p) => 3 + ((Date.parse(p.date) - start) / (end - start || 1)) * (width - 6);
  const y = (p) => height - 4 - ((p.value - min) / span) * (height - 8);
  const last = recent.at(-1);
  const color = flag === "high" ? "var(--high)" : flag === "low" ? "var(--low)" : "var(--accent)";
  return (
    <svg className="lab-sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${group.item} 最近 ${recent.length} 次：${values.join("、")}`}>
      <polyline fill="none" stroke="var(--accent-line, #c8d8ce)" strokeWidth="1.5" points={recent.map((p) => `${x(p)},${y(p)}`).join(" ")} />
      {recent.map((p, i) => <circle key={i} cx={x(p)} cy={y(p)} r={p === last ? 3 : 1.8} fill={p === last ? color : "var(--accent-line, #c8d8ce)"} />)}
    </svg>
  );
}
