import { useEffect, useState } from "react";
import { api } from "./agent-runtime";
import { KnowledgeView } from "./knowledge";
import { EducationTools } from "./education-materials";
import "./medical-modules.css";
import "./knowledge-clarity.css";

// Close the enclosing <details> menu before running a menu action.
function closeMenu(event) {
  const menu = event.currentTarget.closest("details");
  if (menu) menu.open = false;
}
export function KnowledgeLibraries({ onOpenTask }) {
  const [loading, setLoading] = useState(true);
  const [libraries, setLibraries] = useState([]),
    [selected, setSelected] = useState(null),
    [form, setForm] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState(null),
    [notice, setNotice] = useState("");
  const [materialsVersion, setMaterialsVersion] = useState(0);
  const [initialCitation, setInitialCitation] = useState(null);
  const [libraryQuery, setLibraryQuery] = useState("");
  const selectLibrary = (item) => {
    setInitialCitation(null);
    setSelected(item);
    const url = new URL(window.location.href);
    for (const key of [
      "knowledgeDoc",
      "line",
      "endLine",
      "sourceHash",
      "knowledgeTab",
    ])
      url.searchParams.delete(key);
    if (item) url.searchParams.set("collection", item.name);
    else url.searchParams.delete("collection");
    window.history.replaceState(null, "", url);
  };
  const load = async () => {
    const data = await api("/api/knowledge/collections");
    setLibraries(data.collections);
  };
  useEffect(() => {
    load()
      .then(() => {
        const name = new URLSearchParams(window.location.search).get(
          "collection",
        );
        // A citation must select its library together with the loaded document.
        // Mounting the workspace first loses its one-time initial reader state.
        if (name && !new URLSearchParams(window.location.search).has("knowledgeDoc"))
          return api("/api/knowledge/collections").then((data) =>
            setSelected(data.collections.find((c) => c.name === name) || null),
          );
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("knowledgeDoc");
    if (!id) return;
    let alive = true;
    Promise.all([
      api(`/api/knowledge/${encodeURIComponent(id)}`),
      api("/api/knowledge/collections"),
    ])
      .then(([doc, data]) => {
        if (!alive) return;
        const library = data.collections.find(
          (c) => c.name === (doc.collection || "默认知识库"),
        );
        if (!library) throw new Error("引用所属知识库已不存在");
        const stale = params.get("sourceHash") !== doc.sha256;
        const startLine = Number(params.get("line")),
          endLine = Number(params.get("endLine"));
        if (!stale && (
          !Number.isInteger(startLine) ||
          !Number.isInteger(endLine) ||
          startLine < 1 ||
          endLine < startLine ||
          endLine > doc.lineCount
        ))
          throw new Error("引用行号已失效，请检索并重新核对原文");
        setInitialCitation({
          doc,
          highlight: stale ? null : { startLine, endLine },
          stale,
        });
        setSelected(library);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (deleting)
      document
        .getElementById("delete-library-title")
        ?.scrollIntoView({ block: "center" });
  }, [deleting]);
  const save = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const item = await api(
        `/api/knowledge/collections/${encodeURIComponent(form.name.trim())}`,
        "PUT",
        { ...form, expectedRevision: form.revision || 0 },
      );
      await load();
      setForm(null);
      if (selected) setSelected(item);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const prepareDelete = async (name) => {
    setError("");
    setNotice("");
    try {
      const data = await api("/api/knowledge/collections");
      setLibraries(data.collections);
      const item = data.collections.find((item) => item.name === name);
      if (!item) throw new Error("知识库已不存在，请刷新列表");
      setDeleting(item);
    } catch (e) {
      setError(e.message);
    }
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api(
        `/api/knowledge/collections/${encodeURIComponent(deleting.name)}`,
        "DELETE",
        { deletionToken: deleting.deletionToken },
      );
      if (selected?.name === deleting.name) setSelected(null);
      if (form?.name === deleting.name) setForm(null);
      setDeleting(null);
      setNotice(result.warning || "知识库已删除");
      await load();
    } catch (e) {
      setError(e.message);
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  };
  const startCreate = () => {
    setError("");
    setForm({
      name: "",
      description: "",
      whenToUse: "",
      limitations: "",
      revision: 0,
      isNew: true,
    });
  };
  return (
    <div className="module-view library-hub">
      {!selected && (
        <div className="om-page-head kl-head">
          <div>
            <h1>知识库</h1>
            <span className="om-page-meta">
              {loading
                ? "正在读取…"
                : `${libraries.length} 个知识库 · ${libraries.reduce((n, c) => n + c.documentCount, 0)} 份资料 · AI 回答时只引用库中原文`}
            </span>
          </div>
          <div className="om-page-actions">
            <label className="kl-search">
              <span className="sr-only">查找知识库</span>
              <input
                aria-label="查找知识库"
                type="search"
                placeholder="查找知识库：名称或收录内容"
                value={libraryQuery}
                onChange={(e) => setLibraryQuery(e.target.value)}
              />
            </label>
            <button className="primary" onClick={startCreate}>
              新建知识库
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}{" "}
          <button
            className="text-button"
            onClick={() => {
              setLoading(true);
              load()
                .then(() => setError(""))
                .catch((e) => setError(e.message))
                .finally(() => setLoading(false));
            }}
          >
            重新加载知识库
          </button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {deleting && (
        <section
          className="module-card library-delete-confirm"
          role="alertdialog"
          aria-labelledby="delete-library-title"
          aria-describedby="delete-library-description"
        >
          <h2 id="delete-library-title">删除“{deleting.name}”？</h2>
          <p id="delete-library-description">
            将删除此知识库及其中的 {deleting.documentCount}{" "}
            份资料和检索索引，无法撤销。
            患者档案、历史任务和电脑上的原始文件会保留。历史回答中的知识库出处可能无法再打开。
          </p>
          <div className="toolbar-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              取消
            </button>
            <button
              className="library-delete-button"
              disabled={busy}
              onClick={remove}
            >
              {busy ? "正在删除…" : "确认删除知识库"}
            </button>
          </div>
        </section>
      )}
      {form && (
        <form className="module-card library-form" onSubmit={save}>
          <h2>{form.isNew ? "新建知识库" : "编辑知识库说明"}</h2>
          <fieldset disabled={busy}>
            <label>
              知识库名称
              <input
                required
                maxLength={60}
                disabled={!form.isNew}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如：肝癌诊疗参考"
              />
            </label>
            <label>
              收录什么
              <textarea
                required
                maxLength={1000}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="说明资料内容与来源范围"
              />
            </label>
            <label>
              什么时候用
              <textarea
                required
                maxLength={1000}
                value={form.whenToUse}
                onChange={(e) =>
                  setForm({ ...form, whenToUse: e.target.value })
                }
                placeholder="例如：复核肝癌分期依据、查阅治疗与随访指南时"
              />
            </label>
            <label>
              不适用范围或注意事项
              <textarea
                maxLength={1000}
                value={form.limitations}
                onChange={(e) =>
                  setForm({ ...form, limitations: e.target.value })
                }
                placeholder="例如：仅供成人参考；需核对指南版本"
              />
            </label>
            <div className="toolbar-actions">
              <button
                className="secondary"
                type="button"
                onClick={() => setForm(null)}
              >
                取消
              </button>
              <button className="primary" type="submit">
                {busy ? "保存中…" : "保存知识库"}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {selected ? (
        <>
          <div className="library-topbar">
            <button
              className="text-button kl-back"
              onClick={() => {
                selectLibrary(null);
                load().catch((e) => setError(e.message));
              }}
            >
              ← 全部知识库
            </button>
          </div>
          <section className="library-description om-page-head" aria-label="知识库说明">
            <div className="kl-title">
              <h2>{selected.name}</h2>
              <p className="kl-desc">{selected.description || "尚未填写收录说明"}</p>
              <dl className="kl-scope">
                <div>
                  <dt>什么时候用</dt>
                  <dd className={selected.whenToUse ? "" : "om-meta"}>
                    {selected.whenToUse || "未填写，可在“编辑说明”中补充"}
                  </dd>
                </div>
                {selected.limitations && (
                  <div className="kl-caution">
                    <dt>注意事项</dt>
                    <dd>{selected.limitations}</dd>
                  </div>
                )}
              </dl>
            </div>
            <details className="kl-menu kw-library-manage">
              <summary>管理知识库</summary>
              <div>
                <button
                  className="text-button"
                  onClick={(e) => {
                    closeMenu(e);
                    setForm({ ...selected, isNew: false });
                  }}
                >
                  编辑说明
                </button>
                <button
                  className="text-button"
                  onClick={(e) => {
                    closeMenu(e);
                    startCreate();
                  }}
                >
                  新建其他知识库
                </button>
                <button
                  className="text-button library-delete-button"
                  disabled={busy}
                  onClick={(e) => {
                    closeMenu(e);
                    prepareDelete(selected.name);
                  }}
                >
                  删除知识库
                </button>
              </div>
            </details>
          </section>
          <KnowledgeView
            key={`${selected.name}-${materialsVersion}`}
            collection={selected.name}
            onOpenTask={onOpenTask}
            initialCitation={
              (initialCitation?.doc.collection || "默认知识库") ===
              selected.name
                ? initialCitation
                : null
            }
          />
          <details className="kw-library-tools">
            <summary>患教材料工具</summary>
            <EducationTools
              onCreated={(message) => {
                setNotice(message);
                setMaterialsVersion((v) => v + 1);
              }}
              onProposed={(message) => {
                setNotice(message);
              }}
              onError={(message) => setError(message)}
            />
          </details>
        </>
      ) : (
        <>
          <div className="library-grid kl-list">
            {libraries
              .filter(
                (item) =>
                  !libraryQuery ||
                  `${item.name} ${item.description || ""} ${item.whenToUse || ""}`
                    .toLowerCase()
                    .includes(libraryQuery.toLowerCase()),
              )
              .map((item) => (
                <article className="module-card library-card kl-card" key={item.name}>
                  <button
                    className="kl-open"
                    aria-label={`打开知识库 ${item.name}`}
                    onClick={() => selectLibrary(item)}
                  >
                    <span className="kl-card-title">
                      <h2>{item.name}</h2>
                      <span className={`om-chip ${item.documentCount ? "" : "is-caution"}`}>
                        {item.documentCount ? `${item.documentCount} 份资料` : "暂无资料"}
                      </span>
                    </span>
                    <p>{item.description || "待补充：这个知识库收录什么资料？"}</p>
                    {item.whenToUse && <small>什么时候用：{item.whenToUse}</small>}
                  </button>
                  <div className="kl-card-actions">
                    <button className="secondary" onClick={() => selectLibrary(item)}>
                      打开
                    </button>
                    <details className="kl-menu">
                      <summary aria-label={`更多操作：${item.name}`}>更多</summary>
                      <div>
                        <button
                          className="text-button"
                          onClick={(e) => {
                            closeMenu(e);
                            setForm({ ...item, isNew: false });
                          }}
                        >
                          编辑说明
                        </button>
                        <button
                          className="text-button library-delete-button"
                          disabled={busy}
                          onClick={(e) => {
                            closeMenu(e);
                            prepareDelete(item.name);
                          }}
                        >
                          删除知识库
                        </button>
                      </div>
                    </details>
                  </div>
                </article>
              ))}
          </div>
          {!loading && libraryQuery && libraries.length > 0 &&
            !libraries.some((item) =>
              `${item.name} ${item.description || ""} ${item.whenToUse || ""}`
                .toLowerCase()
                .includes(libraryQuery.toLowerCase()),
            ) && <p className="om-empty">没有匹配“{libraryQuery}”的知识库。</p>}
          {loading && <p role="status">正在读取知识库…</p>}
          {!loading && !error && !libraries.length && (
            <p className="module-card om-empty">
              还没有知识库。先创建一个，例如“科室随访规范”，然后上传资料。
            </p>
          )}
        </>
      )}
    </div>
  );
}
