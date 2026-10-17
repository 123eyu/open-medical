import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  layoutKnowledgeDiagram,
  wrapDiagramText,
} from "./knowledge-diagram-model.mjs";

const names = {
  start: "起点",
  action: "步骤",
  decision: "判断",
  end: "结束",
  root: "中心主题",
  topic: "子主题",
};
function Label({ text, x, y, size = 18 }) {
  const lines = wrapDiagramText(text, size);
  return (
    <text className="kd-text" x={x} y={y} aria-hidden="true">
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i ? 18 : -(lines.length - 1) * 9 + 5}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function DiagramCanvas({ diagram, onRead }) {
  const [selected, setSelected] = useState(null),
    [scale, setScale] = useState(1);
  const layout = useMemo(() => layoutKnowledgeDiagram(diagram), [diagram]);
  const canvas = useRef(null);
  useEffect(() => {
    const element = canvas.current;
    const center = () => {
      element.scrollLeft = Math.max(
        0,
        layout.root.x * scale - element.clientWidth / 2,
      );
      element.scrollTop =
        diagram.type === "mindmap"
          ? Math.max(0, layout.root.y * scale - element.clientHeight / 2)
          : 0;
    };
    const observer = new ResizeObserver(center);
    observer.observe(element);
    center();
    return () => observer.disconnect();
  }, [layout, scale, diagram.type]);
  const marker = useId().replace(/:/g, "");
  const choose = (item) => ({
    role: "button",
    tabIndex: 0,
    onClick: () => setSelected(item),
    onKeyDown: (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setSelected(item);
      }
    },
  });
  const read = (evidence) =>
    onRead(diagram.docId, {
      startLine: evidence.startLine,
      endLine: evidence.endLine,
      sourceHash: diagram.sourceHash,
    });
  return (
    <>
      <div className="kd-caption">
        <div>
          <h4>{diagram.title}</h4>
          <p>
            {diagram.docTitle} · {diagram.sourceKind} · 原文提取，待核对
          </p>
        </div>
        <div className="kd-zoom">
          <button
            aria-label="缩小结构图"
            onClick={() => setScale((s) => Math.max(0.5, s - 0.15))}
          >
            −
          </button>
          <button onClick={() => setScale(1)}>
            {Math.round(scale * 100)}%
          </button>
          <button
            aria-label="放大结构图"
            onClick={() => setScale((s) => Math.min(2, s + 0.15))}
          >
            ＋
          </button>
        </div>
      </div>
      <div className="kd-workspace">
        <div
          ref={canvas}
          className="kd-scroll"
          tabIndex={0}
          role="region"
          aria-label="结构图画布，可滚动查看"
        >
          <svg
            className="kd-svg"
            style={{
              width: layout.width * scale,
              height: layout.height * scale,
            }}
            width={layout.width * scale}
            height={layout.height * scale}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            aria-label={
              diagram.type === "flowchart" ? "诊疗流程图" : "知识思维导图"
            }
          >
            <defs>
              <marker
                id={marker}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#65837b" />
              </marker>
            </defs>
            {layout.edges.map((e) => {
              const lines = wrapDiagramText(e.label, 18),
                height = lines.length * 18 + 16;
              return (
                <g
                  key={e.key}
                  {...choose(e)}
                  aria-label={`查看连线出处：${e.label || `${diagram.nodes.find((n) => n.id === e.from)?.label} → ${diagram.nodes.find((n) => n.id === e.to)?.label}`}`}
                  className={`kd-edge ${selected === e ? "selected" : ""}`}
                >
                  <path className="kd-edge-hit" d={e.path} />
                  <path
                    className="kd-edge-line"
                    d={e.path}
                    markerEnd={
                      diagram.type === "flowchart"
                        ? `url(#${marker})`
                        : undefined
                    }
                  />
                  {e.label && (
                    <>
                      <rect
                        x={e.x - e.labelWidth / 2}
                        y={e.y - height / 2}
                        width={e.labelWidth}
                        height={height}
                        rx="6"
                      />
                      <Label text={e.label} x={e.x} y={e.y} />
                    </>
                  )}
                </g>
              );
            })}
            {layout.nodes.map((n) => (
              <g
                key={n.id}
                {...choose(n)}
                aria-label={`查看${names[n.role]}出处：${n.label}`}
                className={`kd-node kd-${n.role} ${selected === n ? "selected" : ""}`}
              >
                {n.role === "decision" ? (
                  <polygon
                    points={`${n.x},${n.y - n.height / 2} ${n.x + n.width / 2},${n.y} ${n.x},${n.y + n.height / 2} ${n.x - n.width / 2},${n.y}`}
                  />
                ) : (
                  <rect
                    x={n.x - n.width / 2}
                    y={n.y - n.height / 2}
                    width={n.width}
                    height={n.height}
                    rx={["start", "end", "root"].includes(n.role) ? 28 : 10}
                  />
                )}
                <Label text={n.label} x={n.x} y={n.y} size={18} />
              </g>
            ))}
          </svg>
        </div>
        <aside className="kd-evidence" aria-label="结构图原文依据">
          <h4>{selected ? selected.label || "连线依据" : "查看原文依据"}</h4>
          {selected ? (
            <>
              <blockquote>{selected.quote}</blockquote>
              <p>
                {diagram.docTitle} · L{selected.startLine}–L{selected.endLine}
              </p>
              <button className="primary" onClick={() => read(selected)}>
                查看原文
              </button>
            </>
          ) : (
            <p>
              点击步骤、主题或连线，核对原文条件与适用范围。滚动画布可查看完整结构。
            </p>
          )}
          <p className="kd-note">
            {diagram.type === "flowchart"
              ? "仅连接本资料分段中明确给出的步骤；未出现的条件分支不补全。"
              : "按本资料分段的主题与层级整理；层级连线不表示治疗推荐或因果关系。"}
          </p>
        </aside>
      </div>
    </>
  );
}

export function KnowledgeDiagrams({ diagrams, type, onRead }) {
  const [id, setId] = useState("");
  const items = diagrams.filter((d) => d.type === type);
  const diagram = items.find((d) => d.id === id) || items[0];
  if (!diagram)
    return (
      <div className="knowledge-map-empty">
        <h4>尚无{type === "flowchart" ? "流程图" : "思维导图"}</h4>
        <p>
          只在原文具有明确{type === "flowchart" ? "步骤或条件分支" : "主题层级"}
          时生成。旧资料可点击「更新知识图谱」重新提取，也可以切换到关系图。
        </p>
      </div>
    );
  return (
    <div className="kd-container">
      <label className="kd-picker">
        选择资料结构图
        <select
          aria-label="选择资料结构图"
          value={diagram.id}
          onChange={(e) => setId(e.target.value)}
        >
          {items.map((d) => (
            <option key={d.id} value={d.id}>
              {d.docTitle} · {d.title} · L
              {Math.min(...d.nodes.map((n) => n.startLine))}
            </option>
          ))}
        </select>
      </label>
      <DiagramCanvas key={diagram.id} diagram={diagram} onRead={onRead} />
    </div>
  );
}
