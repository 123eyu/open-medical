// Scale labels describe the axis only; measured values remain untouched.
export function labAxis(values) {
  const valid = values.filter(Number.isFinite);
  const min = valid.length ? Math.min(...valid) : 0;
  const max = valid.length ? Math.max(...valid) : 1;
  let low = min, high = max;
  if (low === high) {
    const pad = Math.abs(low) * .1 || 1;
    low -= pad; high += pad;
  }
  const raw = (high - low) / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const ratio = raw / power;
  const step = (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * power;
  let start = Math.floor(low / step) * step;
  let end = Math.ceil(high / step) * step;
  // Very large finite values can overflow while calculating a padded range.
  if (!Number.isFinite(step) || step <= 0 || !Number.isFinite(start) || !Number.isFinite(end) || start === end) {
    start = Number.isFinite(low) ? low : min; end = Number.isFinite(high) ? high : max;
    if (start === end) { start = min > 0 ? min / 2 : min; end = max < 0 ? max / 2 : max || 1; }
    return { low: start, high: end, ticks: [start, end].map(value => ({ value, label: String(value) })), position: value => Number.isFinite(end - start) && end !== start ? (value - start) / (end - start) : (value / 2 - start / 2) / (end / 2 - start / 2) };
  }
  const count = Math.round((end - start) / step);
  const precision = Math.max(0, -Math.floor(Math.log10(step)));
  const magnitude = Math.max(Math.abs(start), Math.abs(end));
  const scientific = magnitude >= 1e7 || (magnitude > 0 && magnitude < 1e-4) || precision > 12;
  const digits = Math.min(16, Math.max(0, Math.ceil(Math.log10(magnitude || 1)) - Math.floor(Math.log10(step))));
  const ticks = Array.from({ length: count + 1 }, (_, index) => {
    const value = start + index * step;
    const clean = Math.abs(value) < step * 1e-8 ? 0 : value;
    return { value: clean, label: scientific ? clean.toExponential(digits) : clean.toFixed(Math.min(15, precision)) };
  });
  if (new Set(ticks.map(tick => tick.label)).size !== ticks.length) for (const tick of ticks) tick.label = tick.value.toPrecision(17);
  return { low: start, high: end, ticks, position: value => (value - start) / (end - start) };
}
