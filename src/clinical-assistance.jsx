import { useRef, useState } from 'react';
import { useClinicalDraft } from './clinical-drafts';
import { PatientQuestionStarters } from './patient-question-starters';
import './clinical-assistance.css';

export function ClinicalAssistance({ patient, onOpenTask }) {
  const [question, setQuestion] = useClinicalDraft(patient.id, 'assistanceQuestion', '');
  const [workflow, setWorkflow] = useClinicalDraft(patient.id, 'assistanceWorkflow', '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const submit = async event => {
    event.preventDefault();
    if (sending.current || !question.trim()) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      await onOpenTask(patient.sessionId, { draft: question.trim(), workflow, submit: true, newQuestion: true });
      setQuestion('');
      setWorkflow('');
    } catch (err) { setError(err.message); }
    finally { sending.current = false; setBusy(false); }
  };
  return <section className="clinical-assistance" aria-label="患者诊疗辅助面板">
    <h1>本次想了解什么？</h1>
    <form onSubmit={submit}>
      <textarea aria-label="本次诊疗问题" value={question} onChange={e => setQuestion(e.target.value)} placeholder="输入诊疗问题，助手会结合当前患者的相关记录与资料分析。" disabled={busy} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e); }}/>
      <div className="assistance-submit"><span>Enter 发送 · Shift + Enter 换行</span><button type="submit" className="primary" disabled={busy || !question.trim()}>{busy ? '正在开始…' : '发送问题'}</button></div>
    </form>
    {error && <p role="alert" className="error-text">{error}</p>}
    <PatientQuestionStarters onChoose={({ prompt, workflow = '' }) => { setQuestion(prompt); setWorkflow(workflow); }}/>
  </section>;
}
