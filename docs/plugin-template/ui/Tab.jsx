import { useEffect, useState } from "react";
import { api } from "__ROOT_REL__/src/agent-runtime";

export default function TemplateTab({ patient }) {
  const [notes, setNotes] = useState(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError("");
    return api(`/api/p/__PLUGIN_ID__/notes?patientId=${encodeURIComponent(patient.id)}`)
      .catch(() => ({ notes: [] }))
      .then((result) => setNotes(result.notes || []));
  };

  useEffect(() => {
    let active = true;
    api(`/api/p/__PLUGIN_ID__/notes?patientId=${encodeURIComponent(patient.id)}`)
      .then((result) => {
        if (active) setNotes(result.notes || []);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [patient.id]);

  const submit = async (event) => {
    event.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/api/p/__PLUGIN_ID__/notes", "POST", {
        patientId: patient.id,
        text,
      });
      setText("");
      setNotice("已生成待确认提案，请在「待确认」面板核对后保存。");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="detail-panel" aria-label="__PLUGIN_TITLE__">
      <header>
        <h3>__PLUGIN_TITLE__</h3>
        <p className="muted">模板示例：只读列表 + 写入提案，不会直接修改患者档案。</p>
      </header>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {notice ? <p className="notice" role="status">{notice}</p> : null}
      {notes === null ? (
        <p className="muted" role="status">正在读取记录…</p>
      ) : notes.length ? (
        <ul>
          {notes.map((note) => (
            <li key={note.id}>
              <p>{note.text}</p>
              <small className="muted">{note.createdAt}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">还没有记录。</p>
      )}
      <form onSubmit={submit}>
        <label htmlFor="template-note">新增记录</label>
        <textarea
          id="template-note"
          value={text}
          maxLength={2000}
          rows={3}
          onChange={(event) => setText(event.target.value)}
        />
        <button className="primary" type="submit" disabled={busy || !text.trim()}>
          {busy ? "正在提交…" : "生成待确认提案"}
        </button>
      </form>
    </section>
  );
}
