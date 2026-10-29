import { usePluginActive, usePluginEnabled } from "./plugin-slots";

const starters = [
  ['assessment', '分析病情', '请结合这位患者的病史和检查，分析目前病情、主要依据及需要关注的问题。'],
  ['medication', '查看用药', '请结合这位患者的记录，解释当前用药，并分析需要关注的用药问题。'],
  ['literature', '文献研究', '请围绕这位患者的主要诊疗问题，查阅相关指南和研究，比较证据并总结对这位患者的参考价值。'],
  ['similar', '相似病例', '请查找这位患者的相似病例，比较共同点、差异和可参考的经验。'],
  ['followup', '整理随访', '请结合已记录的诊疗安排，整理这位患者的后续复查与随访事项。'],
];

export function PatientQuestionStarters({ onChoose }) {
  const similarCasesEnabled = usePluginEnabled("similar-cases");
  const followupActive = usePluginActive("followup");
  const available = starters.filter(([id]) => (id !== "similar" || similarCasesEnabled) && (id !== "followup" || followupActive));
  return <div className="patient-question-starters">
    <p>直接输入问题，或选择一个方向开始。</p>
    <div aria-label="常用患者问题">{available.map(([id, label, prompt]) => <button type="button" className="secondary" key={id} onClick={() => onChoose({ prompt, ...(id === 'literature' ? { workflow: 'literature-research' } : {}) })}>{label}</button>)}</div>
  </div>;
}
