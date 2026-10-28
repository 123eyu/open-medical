import { useClinicalDraft } from './clinical-drafts';
import { clinicalDiagnoses } from '../shared/diagnoses.mjs';
import './clinical-assistance.css';

const starters = [
  ['assessment', '分析病情', '请结合这位患者的病史和检查，分析目前病情、主要依据及需要关注的问题。'],
  ['medication', '查看用药', '请结合这位患者的记录，解释当前用药，并分析需要关注的用药问题。'],
  ['literature', '文献研究', '请围绕这位患者的主要诊疗问题，查阅相关指南和研究，比较证据并总结对这位患者的参考价值。'],
  ['similar', '相似病例', '请查找这位患者的相似病例，比较共同点、差异和可参考的经验。'],
  ['followup', '整理随访', '请结合已记录的诊疗安排，整理这位患者的后续复查与随访事项。'],
];

export function ClinicalAssistance({ patient, session, onNavigate, onOpenTask }) {
  const [question, setQuestion] = useClinicalDraft(patient.id, 'assistanceQuestion', '');
  const [kind, setKind] = useClinicalDraft(patient.id, 'assistanceKind', 'question');
  const diagnoses = clinicalDiagnoses(patient.diagnoses).map(d => d.name);
  const results = (session?.artifacts || []).filter(a => ['treatment_review', 'similar_cases'].includes(a.type));
  const start = event => {
    event.preventDefault();
    if (!question.trim()) return;
    onOpenTask(patient.sessionId, { draft: question.trim(), ...(kind === 'literature' ? { workflow: 'literature-research' } : {}) });
  };
  return <section className="clinical-assistance" aria-label="患者诊疗辅助面板">
    <header className="assistance-intro"><h1>围绕这位患者，直接提问</h1><p>结合已保存的病历和资料，分析问题、查阅证据，或帮助整理记录。</p></header>
    <form className="assistance-question" onSubmit={start}>
      <label className="sr-only" htmlFor="assistance-question">本次诊疗问题</label>
      <textarea id="assistance-question" aria-label="本次诊疗问题" value={question} onChange={e => setQuestion(e.target.value)} placeholder="你想了解什么，或者希望帮这位患者做什么？"/>
      <div className="assistance-question-footer"><span>已关联 {patient.name} 的档案</span><button type="submit" className="primary" disabled={!question.trim()}>进入对话 →</button></div>
    </form>
    <div className="assistance-starters" aria-label="选择问题方向">{starters.map(([id, label, prompt]) => <button className="secondary" key={id} aria-pressed={kind === id} onClick={() => { setKind(id); setQuestion(prompt); }}>{label}</button>)}</div>
    <details className="assistance-patient-context"><summary>查看已关联的病情资料{diagnoses.length ? ` · ${diagnoses.slice(0, 2).join('、')}` : ''}</summary>
      {patient.clinicalSummary?.text && <p>{patient.clinicalSummary.text}</p>}
      {!!diagnoses.length && <ul>{diagnoses.map((name, index) => <li key={index}>{name}</li>)}</ul>}
      <div className="assistance-links"><button className="text-button" onClick={() => onNavigate('diagnoses')}>诊断与病史</button><button className="text-button" onClick={() => onNavigate('medications')}>治疗与用药</button><button className="text-button" onClick={() => onNavigate('labs')}>检验结果</button><button className="text-button" onClick={() => onNavigate('library')}>原始资料</button></div>
    </details>
    {!!results.length && <details className="assistance-saved"><summary>已有分析 · {results.length} 份</summary>{results.slice(-3).reverse().map(result => <button key={result.id} className="text-button" onClick={() => onOpenTask(patient.sessionId, { tab: 'results', artifactId: result.id })}>{result.title || '查看分析'}</button>)}</details>}
  </section>;
}
