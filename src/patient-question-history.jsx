import { patientQuestions } from "../shared/patient-conversations.mjs";
export function PatientQuestionHistory({ session, runId, busy, onSelect }) {
  const questions = patientQuestions(session);
  if (!questions.length) return null;
  return <details className="patient-question-history">
      <summary>查看以前的问答</summary>
      <div>{questions.map(question => <button key={question.id} disabled={busy} aria-current={runId === question.id ? "true" : undefined} onClick={e => { onSelect(question.id); e.currentTarget.closest("details").open = false; }}>
        <span title={question.title}>{question.title}</span>
      </button>)}</div>
    </details>;
}
