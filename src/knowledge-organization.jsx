import { useEffect, useRef, useState } from "react";
import { api } from "./agent-runtime";
export const timeLabel = (value) =>
  [
    Math.floor(value / 3600),
    Math.floor(value / 60) % 60,
    Math.floor(value) % 60,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
export function KnowledgeServices({ data }) {
  return <details className="kw-section"><summary>音视频转写</summary><p>{data.transcriptionReady ? '转写服务已连接，上传音视频后即可使用。' : '尚无可用转写连接。此服务暂未提供快捷授权，可以先导入音视频对应的文字稿。'}</p></details>;
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
  }, [doc.id]);
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
      {detail?.job?.mediaInfo?.hasVideo && (
        <p className="muted">视频画面每 30 秒抽样，未覆盖全部画面。</p>
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
                : "可按下方时间标记查找对应内容"}
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
