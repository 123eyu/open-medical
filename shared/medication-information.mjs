// Information completeness only. Never infer current use or pharmacological safety.
const unknown = /未记录|未知|未提供|不详|待补|未查|未测/;
const known = value => !!String(value || '').trim() && !unknown.test(value);
const row = (name, sources, available, note) => ({name, status: available ? '材料中有记载' : '未明确', sources, ...(note ? {note} : {})});
export function medicationInformation(lines) {
  const record = lines.filter(l=>l.sourceId.startsWith('patient-record:'));
  const groups = [];
  for (const line of record) {
    if (line.quote.startsWith('药物：')) groups.push({name:line.quote.slice(3), lines:[line], fields:{名称:line}});
    else if (/^(剂量|频次|途径|用法|规格|用药状态)：/.test(line.quote) && groups.length) {
      groups.at(-1).lines.push(line);
      groups.at(-1).fields[line.quote.split('：')[0]] = line;
    }
  }
  // Free text is only a candidate, never a complete structured medication record.
  const candidates = lines.filter(l=>!l.sourceId.startsWith('patient-record:') && /药品|药物[：:]|用药[：:]|服用|处方/.test(l.quote) && !/\b(?:mg|g|mmol)\s*\/\s*(?:L|dL)\b/i.test(l.quote));
  const information = [];
  const age = lines.filter(l=>/出生年|\d+\s*岁|年龄/.test(l.quote));
  const birthOnly = age.some(l=>/出生年[：:]\s*\d{4}/.test(l.quote)) && !age.some(l=>/\d+\s*岁/.test(l.quote));
  information.push(row('年龄',age,age.some(l=>/\d+\s*岁/.test(l.quote) && known(l.quote)),birthOnly ? '已记录出生年；缺少完整出生日期，不能确定周岁，请核对。' : undefined));
  if (!groups.length) {
    information.push(row('药品名称',candidates,false,'尚无可逐药核对的登记记录；原文候选需医生确认。'));
    for (const field of ['规格','剂量','用法','频次','途径']) information.push(row(field,[],false));
  }
  for (const group of groups) {
    const state = group.fields['用药状态']?.quote.split('：').slice(1).join('：') || '未记录';
    for (const field of ['名称','规格','剂量','用法','频次','途径']) {
      const source = group.fields[field];
      const value = source?.quote.split('：').slice(1).join('：');
      information.push(row(`${group.name} · ${field === '名称' ? '药品名称' : field}`,source ? [source] : [],known(value),`用药状态：${state}；登记名称不代表已核实通用名，剂量不等于制剂规格。`));
    }
  }
  for (const [name, regex] of [['过敏史',/过敏/],['肾功能信息',/肌酐|eGFR|肾功能/i],['肝功能信息',/ALT|AST|肝功能/i],['合并用药',/合并用药|同时服用/]]) {
    const matches=lines.filter(l=>regex.test(l.quote));
    information.push(row(name,matches,matches.some(l=>known(l.quote))));
  }
  return {information,matches:[...groups.flatMap(g=>g.lines),...candidates]};
}
