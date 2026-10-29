import { patientQuestions } from "../shared/patient-conversations.mjs";
export function PatientConversationNav({ session, runId, busy, onSelect }) {
  const questions = patientQuestions(session);
  if (!questions.length) return null;
  return <section className="patient-question-nav" aria-label="患者问答">
    {runId && <button className="text-button" disabled={busy} onClick={() => onSelect(null)}>＋ 新问题</button>}
    {!!questions.length && <details className="patient-question-history">
      <summary>历史问答</summary>
      <div>{questions.map(question => <button key={question.id} disabled={busy} aria-current={runId === question.id ? "true" : undefined} onClick={e => { onSelect(question.id); e.currentTarget.closest("details").open = false; }}>
        <span>{question.title}</span><small>{question.status === "completed" ? (question.mode === "local" ? "查看记录" : "查看 / 追问") : "查看未完成问答"}</small>
      </button>)}</div>
    </details>}
  </section>;
}
