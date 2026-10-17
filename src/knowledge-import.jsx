import { useRef, useState } from "react";
import { api } from "./agent-runtime";
import { KnowledgeServices } from "./knowledge-organization";
import { Modal } from "./components";
import { KNOWLEDGE_SOURCE_KINDS } from "../shared/knowledge-profiles.mjs";
const accept =
  ".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.txt,.md,.markdown,.csv,.tsv,.json,.mp3,.m4a,.wav,.mp4,.mov,.srt,.vtt";
export function KnowledgeImport({
  collection,
  capabilities,
  onClose,
  onSubmitted,
}) {
  const [files, setFiles] = useState([]),
    [sourceKind, setKind] = useState("资料"),
    [mode, setMode] = useState("index"),
    [error, setError] = useState(""),
    [progress, setProgress] = useState("");
  const [meta, setMeta] = useState({
    org: "",
    year: "",
    edition: "",
    sourceUrl: "",
  });
  const inFlight = useRef(false),
    fileRef = useRef();
  const choose = (items) => {
    if (inFlight.current) return;
    const next = [...items];
    if (next.length > (capabilities.maxFilesPerBatch || 200)) {
      setError("选择的文件过多，请每次最多导入 200 份。");
      return;
    }
    setFiles(next);
    setError("");
  };
  const submit = async (e) => {
    e.preventDefault();
    if (inFlight.current || !files.length) return;
    inFlight.current = true;
    setError("");
    const failed = [];
    let count = 0,
      duplicates = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgress(`正在上传 ${i + 1}/${files.length}：${file.name}`);
      try {
        const params = new URLSearchParams({
          collection,
          name: file.name,
          sourceKind,
          indexOnly: String(mode === "index"),
          ...meta,
        });
        const result = await api("/api/knowledge/organization?" + params, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Knowledge-Consent": "true",
          },
          body: file,
        });
        count++;
        if (result.duplicate) duplicates++;
      } catch (e) {
        failed.push({ file, message: e.message });
      }
    }
    setProgress("");
    inFlight.current = false;
    if (failed.length) {
      setFiles(failed.map((x) => x.file));
      setError(
        `已提交 ${count} 份；以下文件未提交，可重试：${failed.map((x) => `${x.file.name}：${x.message}`).join("；")}`,
      );
    }
    try {
      await onSubmitted({ count, duplicates, close: !failed.length });
    } catch (e) {
      setFiles(failed.map((x) => x.file));
      setError(
        `已提交 ${count} 份资料，但刷新状态失败：${e.message}。请关闭后重新打开知识库查看。`,
      );
    }
  };
  return (
    <Modal title="导入资料" onClose={progress ? () => {} : onClose}>
      <form className="kw-import" onSubmit={submit}>
        <fieldset disabled={Boolean(progress)}>
          <div
            className="kw-dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              choose(e.dataTransfer.files);
            }}
          >
            <b>把文件拖到这里，或从电脑选择</b>
            <p>PDF、Word、Excel、CSV、图片、音视频与字幕</p>
            <button
              className="secondary"
              type="button"
              onClick={() => fileRef.current.click()}
            >
              选择文件
            </button>
            <input
              ref={fileRef}
              aria-label="导入资料文件"
              hidden
              type="file"
              multiple
              accept={accept}
              onChange={(e) => {
                choose(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          {!!files.length && (
            <ul className="kw-import-files">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`}>
                  <span>{f.name}</span>
                  <small>{(f.size / 1024 / 1024).toFixed(2)} MB</small>
                  <button
                    type="button"
                    className="text-button"
                    aria-label={`移除 ${f.name}`}
                    onClick={() => setFiles(files.filter((_, j) => i !== j))}
                  >
                    移除
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="form-grid">
            <label>
              存入知识库
              <input value={collection} readOnly />
            </label>
            <label>
              资料性质
              <select
                aria-label="上传资料性质"
                value={sourceKind}
                onChange={(e) => setKind(e.target.value)}
              >
                {KNOWLEDGE_SOURCE_KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="kw-import-mode">
            <legend>导入后如何处理</legend>
            <label>
              <input
                type="radio"
                name="import-mode"
                checked={mode === "index"}
                onChange={() => setMode("index")}
              />
              <span>
                <b>建立检索索引</b>
                <small>保留原件、处理全文，完成后可检索与引用。</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="import-mode"
                checked={mode === "graph"}
                onChange={() => setMode("graph")}
              />
              <span>
                <b>同时生成知识图谱</b>
                <small>
                  额外使用聊天模型提取知识点、关系和依据，耗时更长。
                </small>
              </span>
            </label>
          </fieldset>
          {mode === "graph" && !capabilities.modelReady && (
            <p className="form-error">
              整理模型尚未配置；资料仍可保存，配置后可继续处理。
            </p>
          )}
          <details>
            <summary>来源与版本（可选）</summary>
            <p className="muted">
              批量导入时应用到本批文件；不同来源建议分批提交。
            </p>
            <div className="form-grid">
              {[
                ["org", "机构或作者"],
                ["year", "出版年份"],
                ["edition", "版本说明"],
                ["sourceUrl", "来源链接"],
              ].map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    type={
                      key === "year"
                        ? "number"
                        : key === "sourceUrl"
                          ? "url"
                          : "text"
                    }
                    min={key === "year" ? 1950 : undefined}
                    max={key === "year" ? new Date().getFullYear() : undefined}
                    value={meta[key]}
                    onChange={(e) =>
                      setMeta({ ...meta, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
            </div>
          </details>
          <p className="muted">
            原件保存在本机。索引文本发送给已配置的嵌入服务；生成图谱会发送给聊天模型。音视频使用已配置的转写或识别服务。Excel
            保留工作表与单元格出处，公式不重新计算；旧版 XLS 请先转换为 XLSX。
          </p>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {progress && <p role="status">{progress}</p>}
          <div className="toolbar-actions">
            <button type="button" className="secondary" onClick={onClose}>
              取消
            </button>
            <button className="primary" disabled={!files.length}>
              {progress
                ? "正在提交…"
                : `导入${files.length ? ` ${files.length} 份资料` : ""}`}
            </button>
          </div>
        </fieldset>
      </form>
      {files.some((file) => /\.(mp3|m4a|wav|mp4|mov)$/i.test(file.name)) &&
        !progress && <KnowledgeServices data={capabilities} />}
    </Modal>
  );
}
