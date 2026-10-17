import { useEffect, useState } from "react";
import { FileText, Search } from "lucide-react";
import { groupMaterials } from "../shared/material-folder.mjs";
import { MATERIAL_CATEGORIES, suggestDocumentDate, documentDateCandidates } from "../shared/material-classify.mjs";
import { MaterialDetails } from "./material-details";
import { api } from "./agent-runtime";

// 旧材料导入时可能没算过日期建议（当时还不支持微信/相机紧凑文件名），
// 这里按同一算法现算兜底；仍是「建议」——点采纳才会写入 documentDate。
const dateSuggestionOf = (file) =>
  file.documentDate ||
  suggestDocumentDate(file) ||
  "";

export function PatientMaterialLibrary({
  files,
  sessionId,
  focusFile,
  visionSupported,
  onChanged,
  onError,
  onOpenWorkspace,
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [selectedId, setSelectedId] = useState(focusFile || files[0]?.id);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [pendingMeta, setPendingMeta] = useState(null);
  const [latestMeta, setLatestMeta] = useState(null);
  const [metaError, setMetaError] = useState("");
  const groups = groupMaterials(files);
  const shown = groups
    .map((group) => ({
      ...group,
      files: group.files.filter((file) =>
        file.name
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
      ),
    }))
    .filter(
      (group) =>
        group.files.length && (!category || group.category === category),
    );
  const visible = shown.flatMap((group) => group.files);
  const selected = visible.find((file) => file.id === selectedId) || visible[0];
  const locked = editing || saving || !!pendingMeta;
  useEffect(() => {
    if (focusFile) {
      setQuery("");
      setCategory("");
      setSelectedId(focusFile);
    }
  }, [focusFile]);
  const saveMeta = async (file, patch) => {
    setSaving(true);
    setNotice(""); setMetaError("");
    setPendingMeta({file, patch});
    try {
      await api(
        `/api/sessions/${sessionId}/files/${file.id}/meta`,
        "PATCH",
        {...patch, expectedRevision: file.revision || 0},
      );
      setPendingMeta(null); setLatestMeta(null);
      setNotice("资料信息已保存");
      await onChanged?.();
    } catch (error) {
      setMetaError(error.message);
      if (error.code === 'REVISION_CONFLICT') {
        try {
          const session = await api(`/api/sessions/${sessionId}`);
          const latest = session.files.find(f=>f.id === file.id);
          if (!latest) throw new Error('资料已移除');
          setLatestMeta(latest);
        } catch (loadError) { setMetaError(`${error.message}；读取失败：${loadError.message}。修改已保留，可重试。`); }
      }
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="material-library" aria-label="资料库">
      <div className="material-library-toolbar">
        <label className="material-search">
          <Search size={16} />
          <input
            aria-label="查找文件"
            placeholder="搜索文件名"
            value={query}
            disabled={locked}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select
          aria-label="资料类型筛选"
          value={category}
          disabled={locked}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="">全部类型 · {files.length} 份</option>
          {groups.map((group) => (
            <option key={group.category} value={group.category}>
              {group.category} · {group.count} 份
            </option>
          ))}
        </select>
        <button
          className="text-button"
          disabled={locked}
          onClick={() => onOpenWorkspace(sessionId, { tab: "materials" })}
        >
          添加与整理资料 ↗
        </button>
      </div>
      {notice && (
        <p className="form-notice" role="status">
          {notice}
        </p>
      )}
      {metaError && <p className="error" role="alert">{metaError}</p>}
      {pendingMeta && !saving && <section aria-label="资料信息版本核对">
        <h4>{pendingMeta.file.name} · 待保存修改</h4>
        <p>本地：{Object.entries(pendingMeta.patch).map(([k,v])=>`${k === 'documentDate' ? '日期' : '类型'}：${v || '清空'}`).join('；')}</p>
        {latestMeta && <p>最新：{latestMeta.category || '未分类'} · {latestMeta.documentDate || '日期未记录'}</p>}
        <button onClick={()=>saveMeta(latestMeta || pendingMeta.file,pendingMeta.patch)}>{latestMeta ? '核对后保存本地修改' : '重试保存资料信息'}</button>
        <button onClick={async()=>{try {await onChanged?.();setPendingMeta(null);setLatestMeta(null);setMetaError('');}catch(e){setMetaError(e.message);}}}>放弃本次修改并载入最新资料</button>
      </section>}
      {(editing || saving) && (
        <p className="muted" role="status">
          {editing ? "请保存或取消文字修正后再切换资料。" : "正在保存资料信息…"}
        </p>
      )}
      {!files.length ? (
        <div className="care-empty">
          <p>尚未关联资料文件。</p>
          <button
            className="secondary"
            onClick={() => onOpenWorkspace(sessionId, { tab: "materials" })}
          >
            添加第一份资料
          </button>
        </div>
      ) : !visible.length ? (
        <div className="care-empty">
          <p>没有匹配的文件。</p>
          <button
            className="text-button"
            onClick={() => {
              setQuery("");
              setCategory("");
            }}
          >
            清除筛选
          </button>
        </div>
      ) : (
        <div className="material-library-layout">
          <nav className="material-file-list" aria-label="资料文件列表">
            {shown.map((group) => (
              <section key={group.category}>
                <h3>
                  {group.category} <small>{group.files.length}</small>
                </h3>
                {group.files.map((file) => (
                  <button
                    key={file.id}
                    disabled={locked}
                    aria-current={file.id === selected?.id ? "true" : undefined}
                    className={file.id === selected?.id ? "selected" : ""}
                    onClick={() => {
                      setSelectedId(file.id);
                      setNotice("");
                    }}
                  >
                    <FileText size={17} />
                    <span>
                      <b>{file.name}</b>
                      <small>
                        {file.documentDate ||
                          (dateSuggestionOf(file)
                            ? `${dateSuggestionOf(file)}（建议，可采纳）`
                            : "资料日期未记录")}
                      </small>
                    </span>
                  </button>
                ))}
              </section>
            ))}
          </nav>
          {selected && (
            <article
              className="material-reading-pane"
              aria-label="资料阅读区"
              key={selected.id}
            >
              <header>
                <h3>{selected.name}</h3>
                <span className="muted">
                  {selected.category || "未分类"}
                  {selected.categorySource === "auto" ? " · 自动归类" : ""}
                </span>
              </header>
              {!selected.documentDate && new Set(documentDateCandidates(selected).map((item) => item.date)).size > 1 && (
                <p className="form-notice" role="status">资料日期待核对：{documentDateCandidates(selected).map((item) => `${item.source} ${item.date}`).join("；")}。请在「类型与资料日期」中确认。</p>
              )}
              <details className="material-metadata">
                <summary>类型与资料日期</summary>
                <div className="library-meta-editor">
                  <label>
                    类型
                    <select
                      aria-label="资料类型"
                      disabled={locked}
                      value={selected.category || ""}
                      onChange={(event) =>
                        saveMeta(selected, { category: event.target.value })
                      }
                    >
                      <option value="">未分类</option>
                      {MATERIAL_CATEGORIES.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    资料日期
                    <input
                      aria-label="资料日期"
                      disabled={locked}
                      type="date"
                      value={selected.documentDate || ""}
                      onChange={(event) =>
                        saveMeta(selected, { documentDate: event.target.value })
                      }
                    />
                  </label>
                  {selected.categorySuggestion?.category &&
                    selected.categorySuggestion.category !==
                      selected.category && (
                      <button
                        className="text-button"
                        disabled={locked}
                        onClick={() =>
                          saveMeta(selected, {
                            category: selected.categorySuggestion.category,
                          })
                        }
                      >
                        采纳推测「{selected.categorySuggestion.category}」
                        {selected.categorySuggestion.reason
                          ? `（${selected.categorySuggestion.reason}）`
                          : ""}
                      </button>
                    )}
                  {dateSuggestionOf(selected) &&
                    dateSuggestionOf(selected) !== selected.documentDate && (
                      <button
                        className="text-button"
                        disabled={locked}
                        onClick={() =>
                          saveMeta(selected, {
                            documentDate: dateSuggestionOf(selected),
                          })
                        }
                      >
                        采纳推测 {dateSuggestionOf(selected)}
                      </button>
                    )}
                </div>
              </details>
              <MaterialDetails
                file={selected}
                sessionId={sessionId}
                initiallyOpen
                visionSupported={visionSupported}
                onChanged={onChanged}
                onError={onError}
                onEditingChange={setEditing}
              />
              {selected.extraction &&
                !(
                  selected.extraction.artifactId ||
                  selected.extraction.pageImages?.length
                ) && <pre>{selected.text || "暂无可读取文字"}</pre>}
            </article>
          )}
        </div>
      )}
    </section>
  );
}
