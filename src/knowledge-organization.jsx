import { useEffect, useRef, useState } from "react";
import { api } from "./agent-runtime";
import { transcriptionSettingsUrl } from "./knowledge-transcription-settings";
export const timeLabel = (value) =>
  [
    Math.floor(value / 3600),
    Math.floor(value / 60) % 60,
    Math.floor(value) % 60,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
export function KnowledgeServices({ data, collection }) {
  return (
    <details className="kw-section">
      <summary>音视频转写</summary>
      <p>
        {data.transcriptionReady
          ? "已保存转写连接，实际识别结果以导入任务为准。"
          : "尚未配置转写连接。音视频原件会保留，可配置服务或在未完成任务中补充文字稿后继续。"}
      </p>
      <a href={transcriptionSettingsUrl(collection)}>前往转写设置</a>
    </details>
  );
}
export { KnowledgeMap } from "./knowledge-map";
export function KnowledgeReading({ doc, highlight }) {
  const [detail, setDetail] = useState(null),
    [playback, setPlayback] = useState(null),
    [error, setError] = useState("");
  const media = useRef();
  useEffect(() => {
    let alive = true;
    setDetail(null);
    setPlayback(null);
    setError("");
    api(`/api/knowledge/${doc.id}/organization`)
      .then((v) => {
        if (alive) setDetail(v);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [doc.id, doc.sha256]);
  const locator = detail?.locators.find(
    (l) =>
      l.startLine <= (highlight?.startLine || 1) &&
      l.endLine >= (highlight?.startLine || 1),
  );
  useEffect(() => {
    if (media.current && Number.isFinite(locator?.start))
      media.current.currentTime = locator.start;
  }, [locator?.start]);
  const seek = () => {
    if (media.current && Number.isFinite(locator?.start))
      media.current.currentTime = locator.start;
  };
  return (
    <div className="knowledge-reading-extra">
      {error && <p role="alert">{error}</p>}
      {detail?.textCorrected && (
        <p role="status">正文已修正，旧时间定位已失效。请对照原文件核对。</p>
      )}
      {detail?.job?.mediaInfo?.hasVideo && (
        <p className="muted">
          {detail.job.suppliedTranscript
            ? "本文使用医生补充的文字稿，未逐帧核对视频内容。"
            : "视频画面每 30 秒抽样，未覆盖全部画面。"}
        </p>
      )}
      {(detail?.sourceJob || detail?.job)?.hasOriginal && !playback && (
        <button
          className="secondary"
          onClick={async () => {
            try {
              setPlayback(
                await api(
                  `/api/knowledge/organization/${(detail.sourceJob || detail.job).id}/playback`,
                  "POST",
                  {},
                ),
              );
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          打开原文件
          {Number.isFinite(locator?.start)
            ? " · " + timeLabel(locator.start)
            : ""}
        </button>
      )}
      {playback &&
        (playback.media ? (
          <div className="knowledge-player">
            {playback.video ? (
              <video
                ref={media}
                controls
                src={playback.url}
                onLoadedMetadata={seek}
              />
            ) : (
              <audio
                ref={media}
                controls
                src={playback.url}
                onLoadedMetadata={seek}
              />
            )}
            <p>
              {Number.isFinite(locator?.start)
                ? `原文对应 ${timeLabel(locator.start)}${locator.timing === "chunk" ? " 起的音频分段（非句子精确时间）" : ""}`
                : "本文没有经过核验的时间定位，请对照原音频核对内容。"}
            </p>
          </div>
        ) : (
          <a href={playback.url} target="_blank" rel="noreferrer">
            查看或下载原文件
          </a>
        ))}
    </div>
  );
}
