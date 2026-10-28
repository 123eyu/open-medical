import { isCalendarDate } from './calendar-date.mjs';

// Only compare observations with exactly matching item names and units.
export function dashboardLabGroups(labs = []) {
  const groups = new Map();
  for (const lab of labs) {
    const key = JSON.stringify([lab.item, lab.unit || '']);
    if (!groups.has(key)) groups.set(key, { key, item: lab.item, unit: lab.unit || '', records: [] });
    groups.get(key).records.push(lab);
  }
  return [...groups.values()].map(group => {
    const records = group.records.toSorted((a,b) => String(a.date || '').localeCompare(String(b.date || '')));
    const dated = records.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') && Number.isFinite(Date.parse(r.date)) && new Date(r.date).toISOString().slice(0,10) === r.date && Number.isFinite(r.value));
    const dates = new Map();
    for(const r of dated) { if(!dates.has(r.date)) dates.set(r.date,new Set()); dates.get(r.date).add(r.value); }
    const conflictDates = [...dates].filter(([,values]) => values.size > 1).map(([date]) => date);
    const conflict = conflictDates.length > 0;
    const latestConflict = conflictDates.includes(records.at(-1)?.date);
    // 绘图不再要求「≥2 个不同日期且同日唯一」：散点画出全部有效记录（同日多值并列），
    // 是否连线（趋势）由 LabPlot 判断——只有 ≥2 个日期且无同日冲突才连。
    const points = dated.toSorted((a,b) => a.date===b.date ? a.value-b.value : String(a.date).localeCompare(String(b.date)));
    return { ...group, records, points, conflict, conflictDates, latestConflict, distinctDates: dates.size, canPlot: points.length > 0 };
  });
}

// Unknown dates must not compete with known dates for the "most recent" result.
// Keep every source record for review, even when values happen to be identical.
export function dashboardLabSummary(group) {
  const dated = group.records.filter(record => isCalendarDate(record.date));
  const date = dated.map(record => record.date).sort().at(-1) || '';
  const records = date ? dated.filter(record => record.date === date) : group.records;
  return {
    ...group,
    date,
    latestRecords: records,
    values: [...new Set(records.map(record => record.value ?? '结果未记录'))],
    undatedCount: group.records.length - dated.length,
  };
}

// Compare distinct dated observations only; an ambiguous value must never become
// an apparently precise change. Units are already separated by dashboardLabGroups.
export function dashboardLabComparison(group) {
  const summary = dashboardLabSummary(group);
  const previousDate = group.records.map(record => record.date)
    .filter(date => isCalendarDate(date) && date < summary.date).sort().at(-1) || '';
  const previousRecords = group.records.filter(record => previousDate && record.date === previousDate);
  const previousValues = [...new Set(previousRecords.map(record => record.value ?? '结果未记录'))];
  let delta = null, deltaReason = '';
  if (!summary.date) deltaReason = '日期未明确';
  else if (!previousDate) deltaReason = '暂无可比记录';
  else if (summary.values.length !== 1 || previousValues.length !== 1) deltaReason = '同日多值，暂不比较';
  else if (!group.unit?.trim()) deltaReason = '单位未明确';
  else if (!Number.isFinite(summary.values[0]) || !Number.isFinite(previousValues[0])) deltaReason = '非精确数值';
  else {
    const difference = summary.values[0] - previousValues[0];
    if (Number.isFinite(difference)) delta = Number(difference.toPrecision(12));
    else deltaReason = '变化超出数值范围';
  }
  return { ...summary, previousDate, previousValues, delta, deltaReason };
}

// Notes contain arbitrary provenance/identity checks and are never a clinical summary.
export function dashboardHistory(patient) {
  return [...(patient.visits || [])].sort((a,b)=>String(a.date || "9999").localeCompare(String(b.date || "9999")));
}

// Display preferences affect presentation only; observations and alerts are unchanged.
export function dashboardLabLayout(labs = [], preferences = {}, monitors = []) {
  const groups = dashboardLabGroups(labs);
  const score = g => (monitors.some(m => m.status !== 'paused' && m.item === g.item && (!m.unitHint || m.unitHint === g.unit)) ? 4 : 0) + (g.conflict ? 2 : 0) + (g.distinctDates > 1 ? 1 : 0);
  const order = preferences.order || [];
  groups.sort((a, b) => {
    const ai = order.indexOf(a.key), bi = order.indexOf(b.key);
    return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi) || score(b) - score(a) || a.item.localeCompare(b.item, 'zh-CN') || a.unit.localeCompare(b.unit);
  });
  const hidden = new Set(preferences.hidden || []), collapsed = new Set(preferences.collapsed || []);
  const visible = groups.filter(g => !hidden.has(g.key));
  return { groups, visible, hidden: groups.filter(g => hidden.has(g.key)), collapsed,
    comparison: visible.filter(g => !preferences.compare || preferences.compare.includes(g.key)) };
}
