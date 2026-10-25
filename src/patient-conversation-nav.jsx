import { patientQuestions } from "../shared/patient-conversations.mjs";
export function PatientConversationNav({ session, runId, busy, onSelect }) {
  const questions = patientQuestions(session);
  return <section className="patient-question-nav" aria-label="患者问答">
    <div className="patient-question-actions">
      <strong>{runId ? "当前问答" : "问一个新问题"}</strong>
      <button className="secondary" disabled={busy || !runId} title={runId ? undefined : "当前已经在新问题表单中，直接在下方输入即可"} onClick={() => onSelect(null)}>＋ 问新问题</button>
    </div>
    {!!questions.length && <details className="patient-question-history">
      <summary>以前的问答 · {questions.length}</summary>
      <p>选择问答查看记录；可追问的回答会显示入口。</p>
      <div>{questions.map(question => <button key={question.id} disabled={busy} aria-current={runId === question.id ? "true" : undefined} onClick={e => { onSelect(question.id); e.currentTarget.closest("details").open = false; }}>
        <span>{question.title}</span><small>{question.status === "completed" ? (question.mode === "local" ? "查看记录" : "查看 / 追问") : "查看未完成问答"}</small>
      </button>)}</div>
    </details>}
  </section>;
}
