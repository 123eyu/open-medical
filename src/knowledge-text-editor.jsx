import { useEffect, useRef, useState } from "react";
import { api } from "./agent-runtime";

// Keep an unfinished edit when the reader is closed and reopened in this tab.
// Source text is deliberately not copied into browser persistent storage.
const drafts = new Map();
window.addEventListener("beforeunload", (event) => {
  if ([...drafts.values()].some((draft) => draft.text !== draft.original)) {
    event.preventDefault();
    event.returnValue = "";
  }
});

export function KnowledgeTextEditor({ doc, onSaved, onClose }) {
  const [draft, setDraft] = useState(
    () =>
      drafts.get(doc.id) || {
        text: doc.text,
        revision: doc.revision || 0,
        original: doc.text,
      },
  );
  const [latest, setLatest] = useState(null),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const lock = useRef(false);
  const dirty = draft.text !== draft.original;
  useEffect(() => {
    let alive = true;
    api(`/api/knowledge/${doc.id}`)
      .then((current) => {
        if (!alive) return;
        const saved = drafts.get(doc.id);
        if (saved && saved.revision !== (current.revision || 0))
          setLatest(current);
        else if (!saved)
          setDraft({
            text: current.text,
            original: current.text,
            revision: current.revision || 0,
          });
        setReady(true);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [doc.id, retry]);
  const change = (next) => {
    drafts.set(doc.id, next);
    setDraft(next);
  };
  const complete = (current) => {
    drafts.delete(doc.id);
    setDraft({
      text: current.text,
      original: current.text,
      revision: current.revision || 0,
    });
    onSaved(current);
  };
  const submit = async (event) => {
    event.preventDefault();
    if (lock.current || latest || !ready) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const desired = draft.text.trim();
    try {
      const current = await api(`/api/knowledge/${doc.id}/text`, "PUT", {
        text: desired,
        expectedRevision: draft.revision,
      });
      complete(current);
    } catch (e) {
      // A response may be lost after the transaction committed. Read back the
      // saved body before offering a retry; never blindly rebase a stale edit.
      try {
        const current = await api(`/api/knowledge/${doc.id}`);
        if (current.text === desired) {
          complete(current);
          return;
        }
        if ((current.revision || 0) !== draft.revision) setLatest(current);
      } catch {
        /* Keep the draft and original revision for a safe retry. */
      }
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section aria-label="修正知识正文" className="kw-section">
      <h2>修正知识正文</h2>
      <p>
        请对照原文件核对识别错误。保存后保留原件，重建检索索引；旧图谱和时间定位失效，请重新生成图谱并核对引用。资料将重新变为待审核。
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            修正后的完整正文
            <textarea
              aria-label="修正后的完整正文"
              rows={16}
              value={draft.text}
              onChange={(event) =>
                change({ ...draft, text: event.target.value })
              }
            />
          </label>
          {error && (
            <p role="alert" className="form-error">
              保存尚未确认：{error}。当前草稿仍保留。
              {!ready && (
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setRetry((value) => value + 1);
                  }}
                >
                  重新读取版本
                </button>
              )}
            </p>
          )}
          {latest && (
            <div role="alert">
              <p>资料已被其他操作修改。请对照最新正文合并，不能直接覆盖。</p>
              <label>
                服务器最新正文
                <textarea
                  aria-label="服务器最新正文"
                  readOnly
                  rows={10}
                  value={latest.text}
                />
              </label>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  change({
                    ...draft,
                    original: latest.text,
                    revision: latest.revision || 0,
                  });
                  setLatest(null);
                  setError("");
                }}
              >
                已对照合并，使用最新版本继续编辑
              </button>
            </div>
          )}
          <button
            className="primary"
            disabled={!ready || !dirty || !draft.text.trim() || Boolean(latest)}
          >
            {busy ? "正在保存正文…" : "保存正文修正"}
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            收起编辑（保留草稿）
          </button>
          {dirty && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                if (window.confirm("放弃尚未保存的正文修正？")) {
                  drafts.delete(doc.id);
                  onClose();
                }
              }}
            >
              放弃草稿
            </button>
          )}
        </fieldset>
      </form>
    </section>
  );
}
