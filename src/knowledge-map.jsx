import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "./agent-runtime";
import { Modal } from "./components";
import {
  MEDICAL_NODE_TYPES,
  MEDICAL_RELATION_TYPES,
} from "../shared/medical-graph.mjs";
import {
  bundleGraphEdges,
  graphEdgeKey,
  graphSlice,
  layoutGraph,
  nodeColors,
} from "./knowledge-graph-model.mjs";
import { KnowledgeDiagrams } from "./knowledge-diagram";
import { recommendedKnowledgeView } from "./knowledge-diagram-model.mjs";
import "./knowledge-map.css";

const emptyGraph = {
  nodes: [],
  edges: [],
  communities: [],
  diagrams: [],
  jobs: [],
};
export function KnowledgeMap({ collection, onRead, onAsk, refreshKey }) {
  const [graph, setGraph] = useState(emptyGraph),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [notice, setNotice] = useState(""),
    [view, setView] = useState("auto"),
    [query, setQuery] = useState(""),
    [type, setType] = useState(""),
    [community, setCommunity] = useState(""),
    [relation, setRelation] = useState(""),
    [selected, setSelected] = useState(""),
    [edgeId, setEdgeId] = useState(""),
    [limit, setLimit] = useState(90),
    [evidenceLimit, setEvidenceLimit] = useState(20),
    [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const drag = useRef(null),
    svg = useRef(null),
    lock = useRef(false),
    generation = useRef(0);
  const marker = useId().replace(/:/g, "");
  const [compact, setCompact] = useState(
    () => window.matchMedia("(max-width: 600px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 600px)");
    const change = () => setCompact(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const reload = useCallback(async () => {
    const version = ++generation.current;
    try {
      const value = await api(
        "/api/knowledge/map?" + new URLSearchParams({ collection }),
      );
      if (version === generation.current) {
        setGraph((previous) => {
          const next = { ...value };
          for (const key of ["nodes", "edges", "communities", "diagrams"])
            if (JSON.stringify(previous[key]) === JSON.stringify(value[key]))
              next[key] = previous[key];
          return next;
        });
        setError("");
        setLoading(false);
      }
    } catch (e) {
      if (version === generation.current) {
        setError(e.message);
        setLoading(false);
      }
    }
  }, [collection]);
  useEffect(() => {
    setGraph(emptyGraph);
    setView("auto");
    setSelected("");
    setEdgeId("");
    setQuery("");
    setType("");
    setCommunity("");
    setRelation("");
    setConfirm(false);
    setLoading(true);
    setNotice("");
    return () => {
      generation.current++;
    };
  }, [collection]);
  useEffect(() => {
    reload();
    return () => {
      generation.current++;
    };
  }, [reload, refreshKey]);
  useEffect(() => {
    if (!graph.activeDocuments) return;
    const timer = setInterval(reload, 2500);
    return () => clearInterval(timer);
  }, [graph.activeDocuments, reload]);
  const perform = async (fn) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const chosen = graph.nodes.find((n) => n.id === selected);
  const slice = useMemo(
    () =>
      graphSlice(
        { nodes: graph.nodes, edges: graph.edges },
        {
          query,
          type,
          community,
          relation,
          selected: chosen?.id,
          limit,
        },
      ),
    [
      graph.nodes,
      graph.edges,
      query,
      type,
      community,
      relation,
      chosen?.id,
      limit,
    ],
  );
  const visualEdges = useMemo(
    () => bundleGraphEdges(slice.edges),
    [slice.edges],
  );
  const points = useMemo(() => layoutGraph(slice.nodes, slice.edges), [slice]);
  const pointById = useMemo(
    () => new Map(points.map((n) => [n.id, n])),
    [points],
  );
  const nodeById = useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n])),
    [graph.nodes],
  );
  const fitted = useMemo(() => {
    if (!points.length) return "0 0 960 600";
    const minX = Math.min(...points.map((n) => n.x)) - 100;
    const maxX = Math.max(...points.map((n) => n.x)) + 100;
    const minY = Math.min(...points.map((n) => n.y)) - 65;
    const maxY = Math.max(...points.map((n) => n.y)) + 85;
    const width = Math.max(compact ? 340 : 680, maxX - minX),
      height = Math.max(compact ? 300 : 440, maxY - minY);
    return `${(minX + maxX - width) / 2} ${(minY + maxY - height) / 2} ${width} ${height}`;
  }, [points, compact]);
  const selectNode = (id) => {
    setSelected(id);
    setQuery("");
    setEdgeId("");
    setEvidenceLimit(20);
    setTransform({ x: 0, y: 0, scale: 1 });
  };
  const related = graph.edges.filter(
    (e) =>
      (e.from === selected || e.to === selected) &&
      (!relation || e.relationType === relation),
  );
  const chosenEdge = graph.edges.find((e) => e.id === edgeId);
  const detailEdges = chosenEdge
    ? related.filter((e) => graphEdgeKey(e) === graphEdgeKey(chosenEdge))
    : related;
  const reset = () => {
    setSelected("");
    setEdgeId("");
    setQuery("");
    setType("");
    setCommunity("");
    setRelation("");
    setLimit(90);
    setTransform({ x: 0, y: 0, scale: 1 });
  };
  const read = (e, range = e) =>
    onRead(e.docId, {
      startLine: range.startLine,
      endLine: range.endLine,
      sourceHash: e.sourceHash,
    });
  const edgeTitle = (e) =>
    `${nodeById.get(e.from)?.label} → ${e.relation} → ${nodeById.get(e.to)?.label}`;
  const zoom = (factor) =>
    setTransform((t) => ({
      ...t,
      scale: Math.max(0.35, Math.min(4, t.scale * factor)),
    }));
  const svgPoint = (e) => {
    const p = svg.current.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    return p.matrixTransform(svg.current.getScreenCTM().inverse());
  };
  const buttonLabel =
    graph.analyzedDocuments || graph.completedDocuments
      ? "更新知识图谱"
      : "生成知识图谱";
  const diagrams = graph.diagrams || [];
  const actualView =
    view === "auto" ? recommendedKnowledgeView(diagrams) : view;
  return (
    <section className="knowledge-map" aria-label="知识地图">
      <div className="kg-heading">
        <div>
          <h3>知识图谱</h3>
          <p>
            {collection || "全部知识库"} · {graph.nodes.length} 个知识点 ·{" "}
            {graph.edges.length} 条有据关系
          </p>
          <div className="kg-status" role="status">
            <span>
              {graph.completedDocuments || 0}/{graph.documentCount || 0}{" "}
              份资料已完成
            </span>
            {graph.pendingDocuments > 0 ? (
              <span>{graph.pendingDocuments} 份待生成或更新</span>
            ) : (
              graph.documentCount > 0 && <span>已是最新</span>
            )}
            {graph.activeDocuments > 0 && (
              <span>
                处理中 {graph.activeDocuments} 份 · 已保存{" "}
                {graph.progress?.done || 0}/{graph.progress?.total || 0}{" "}
                个分段，可离开后返回
              </span>
            )}
            {graph.updatedAt && (
              <span>
                更新于 {new Date(graph.updatedAt).toLocaleString("zh-CN")}
              </span>
            )}
          </div>
        </div>
        <button
          className="primary"
          disabled={
            busy ||
            loading ||
            !collection ||
            !graph.documentCount ||
            Boolean(graph.activeDocuments)
          }
          onClick={() => setConfirm(true)}
        >
          {graph.activeDocuments ? "图谱生成中…" : buttonLabel}
        </button>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
          <button className="text-button" onClick={reload}>
            重新加载
          </button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!!graph.jobs?.length && (
        <details className="kg-jobs">
          <summary>
            构建进度
            {graph.failedDocuments
              ? ` · ${graph.failedDocuments} 份未完成`
              : ""}
          </summary>
          {graph.jobs.map((j) => (
            <div key={j.id}>
              <span>
                <b>{j.fileName}</b> · {j.stage}
                {j.error && <small>{j.error}</small>}
              </span>
              {["running", "queued"].includes(j.status) && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    perform(() =>
                      api(
                        `/api/knowledge/organization/${j.id}/cancel`,
                        "POST",
                        {},
                      ),
                    )
                  }
                >
                  停止
                </button>
              )}
            </div>
          ))}
        </details>
      )}
      <div className="kd-views" role="group" aria-label="知识视图">
        {[
          ["auto", "自动选择"],
          ["graph", "关系图"],
          ["flowchart", "流程图"],
          ["mindmap", "思维导图"],
        ].map(([key, name]) => (
          <button
            key={key}
            aria-pressed={view === key}
            onClick={() => setView(key)}
          >
            {name}
            {["flowchart", "mindmap"].includes(key)
              ? ` · ${diagrams.filter((d) => d.type === key).length}`
              : ""}
          </button>
        ))}
      </div>
      {view === "auto" && (
        <p className="kd-recommendation">
          {actualView === "flowchart"
            ? "资料中提取到明确步骤，优先展示流程图；可切换查看主题和医学关系。"
            : actualView === "mindmap"
              ? "资料中提取到主题层级，优先展示思维导图。"
              : "以医学实体和有据关联展示关系图；有明确步骤或层级时提供其他视图。"}
        </p>
      )}
      {loading ? (
        <p role="status">正在加载知识图谱…</p>
      ) : actualView !== "graph" ? (
        <KnowledgeDiagrams
          diagrams={diagrams}
          type={actualView}
          onRead={onRead}
        />
      ) : !graph.nodes.length ? (
        <div className="knowledge-map-empty">
          <h4>
            {graph.documentCount
              ? "把资料连接成可追溯的知识"
              : "添加资料，开始构建知识图谱"}
          </h4>
          <p>
            {graph.documentCount
              ? "点击生成知识图谱，提取疾病、诊断、药品及诊疗关系。每条关系都可回到原文核对。"
              : "在「资料」中添加文档后，可在这里生成图谱，也可以在导入时选择同时生成。"}
          </p>
          {graph.completedDocuments > 0 && (
            <p>已完成的资料中没有提取到有原文依据的医学实体或关系。</p>
          )}
        </div>
      ) : (
        <>
          <div className="knowledge-map-filters">
            <input
              aria-label="搜索知识点"
              placeholder="搜索疾病、药品、诊断或别名"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected("");
                setEdgeId("");
              }}
            />
            <select
              aria-label="知识点类型"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setSelected("");
                setEdgeId("");
              }}
            >
              <option value="">全部类型</option>
              {MEDICAL_NODE_TYPES.filter((t) =>
                graph.nodes.some((n) => n.type === t),
              ).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <select
              aria-label="医学关系类型"
              value={relation}
              onChange={(e) => {
                setRelation(e.target.value);
                setEdgeId("");
              }}
            >
              <option value="">全部关系</option>
              {MEDICAL_RELATION_TYPES.filter((t) =>
                graph.edges.some((e) => e.relationType === t),
              ).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <select
              aria-label="关联主题分组"
              value={community}
              onChange={(e) => {
                setCommunity(e.target.value);
                setSelected("");
                setEdgeId("");
              }}
            >
              <option value="">全部主题组</option>
              {graph.communities?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} · {c.count}
                </option>
              ))}
            </select>
            <button className="text-button" onClick={reset}>
              返回全图
            </button>
          </div>
          <div className="kg-legend">
            {[...new Set(slice.nodes.map((n) => n.type))].map((t) => (
              <span key={t}>
                <i style={{ background: nodeColors[t] || "#7e8578" }} />
                {t}
              </span>
            ))}
          </div>
          <div
            className={
              chosen
                ? "knowledge-map-layout has-selection"
                : "knowledge-map-layout"
            }
          >
            <div className="kg-canvas-panel">
              <div className="kg-canvas-tools">
                <span>
                  {chosen
                    ? `${chosen.label}的关联`
                    : `${slice.nodes.length} / ${slice.total} 个知识点`}
                </span>
                <div>
                  <button aria-label="放大图谱" onClick={() => zoom(1.25)}>
                    ＋
                  </button>
                  <button aria-label="缩小图谱" onClick={() => zoom(0.8)}>
                    －
                  </button>
                  <button
                    onClick={() => setTransform({ x: 0, y: 0, scale: 1 })}
                  >
                    适应画布
                  </button>
                </div>
              </div>
              {!slice.nodes.length ? (
                <div className="knowledge-map-empty">
                  没有匹配的知识点，试试其他名称或筛选条件。
                </div>
              ) : (
                <svg
                  ref={svg}
                  viewBox={fitted}
                  role="group"
                  aria-label="知识关系图"
                  onPointerDown={(e) => {
                    if (e.target.closest('[role="button"]')) return;
                    const p = svgPoint(e);
                    drag.current = { x: p.x, y: p.y, start: transform };
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (!drag.current) return;
                    const p = svgPoint(e),
                      d = drag.current;
                    setTransform({
                      ...d.start,
                      x: d.start.x + p.x - d.x,
                      y: d.start.y + p.y - d.y,
                    });
                  }}
                  onPointerUp={() => {
                    drag.current = null;
                  }}
                  onPointerCancel={() => {
                    drag.current = null;
                  }}
                >
                  <defs>
                    <marker
                      id={marker}
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="#81938b" />
                    </marker>
                  </defs>
                  <g
                    transform={`translate(${transform.x} ${transform.y}) translate(480 300) scale(${transform.scale}) translate(-480 -300)`}
                  >
                    {visualEdges.map((e) => {
                      const a = pointById.get(e.from),
                        b = pointById.get(e.to),
                        dx = b.x - a.x,
                        dy = b.y - a.y,
                        d = Math.max(1, Math.hypot(dx, dy)),
                        x1 = a.x + (dx / d) * 26,
                        y1 = a.y + (dy / d) * 26,
                        x2 = b.x - (dx / d) * 29,
                        y2 = b.y - (dy / d) * 29;
                      const cx = (a.x + b.x) / 2 - (dy / d) * e.curve;
                      const cy = (a.y + b.y) / 2 + (dx / d) * e.curve;
                      const path = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
                      return (
                        <g
                          key={e.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`关系：${edgeTitle(e)}`}
                          className={`kg-edge ${e.id === edgeId ? "is-selected" : ""} ${["禁忌", "不推荐", "药物相互作用"].includes(e.relationType) ? "is-caution" : ""}`}
                          onClick={() => {
                            setSelected(e.from);
                            setEdgeId(e.id);
                            setEvidenceLimit(20);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelected(e.from);
                              setEdgeId(e.id);
                            }
                          }}
                        >
                          <title>
                            {edgeTitle(e)} · {e.assertion}
                          </title>
                          <path className="kg-edge-hit" d={path} />
                          <path d={path} markerEnd={`url(#${marker})`} />
                          {(slice.nodes.length <= 16 || e.id === edgeId) && (
                            <text
                              className="kg-edge-label"
                              x={
                                (a.x + b.x) / 2 - (dy / d) * (16 + e.curve / 2)
                              }
                              y={
                                (a.y + b.y) / 2 +
                                (dx / d) * (16 + e.curve / 2) -
                                4
                              }
                            >
                              {e.relation.length > 16
                                ? e.relation.slice(0, 15) + "…"
                                : e.relation}
                              {e.count > 1 ? ` ×${e.count}` : ""}
                            </text>
                          )}
                        </g>
                      );
                    })}
                    {points.map((n) => (
                      <g
                        key={n.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`知识点：${n.label}`}
                        className={`kg-node ${n.id === selected ? "selected" : ""}`}
                        onClick={() => selectNode(n.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            selectNode(n.id);
                          }
                        }}
                      >
                        <title>
                          {n.label} · {n.type} · {n.degree} 个关联
                        </title>
                        <circle
                          cx={n.x}
                          cy={n.y}
                          r={n.id === selected ? 27 : 22}
                          style={{
                            fill: nodeColors[n.type] || "#7e8578",
                            stroke: n.id === selected ? "#203d32" : "#fff",
                          }}
                        />
                        <text x={n.x} y={n.y + 4} className="node-type">
                          {n.type}
                        </text>
                        <text x={n.x} y={n.y + 44} className="kg-node-label">
                          {n.label.length > 16
                            ? n.label.slice(0, 15) + "…"
                            : n.label}
                        </text>
                      </g>
                    ))}
                  </g>
                </svg>
              )}
              <p className="kg-help">
                拖动画布移动，使用 ＋ / －
                缩放。点击节点探索关联，点击连线查看原文与适用条件。
              </p>
              {slice.total > slice.nodes.length && (
                <p className="kg-help">
                  当前按关联数显示 {slice.nodes.length}/{slice.total}{" "}
                  个知识点。可搜索全部节点或筛选主题组。
                  {limit < 250 && (
                    <button
                      className="text-button"
                      onClick={() => setLimit(Math.min(250, limit + 80))}
                    >
                      显示更多节点
                    </button>
                  )}
                </p>
              )}
              <details className="kg-node-list">
                <summary>知识点列表 · {slice.total}</summary>
                {slice.nodes.map((n) => (
                  <button
                    key={n.id}
                    className="text-button"
                    onClick={() => selectNode(n.id)}
                  >
                    {n.label}{" "}
                    <small>
                      {n.type} · {n.degree} 个关联
                    </small>
                  </button>
                ))}
              </details>
            </div>
            {chosen && (
              <aside className="knowledge-map-evidence">
                <div className="kg-evidence-heading">
                  <span>{chosen.type}</span>
                  <button
                    className="text-button"
                    onClick={() => {
                      setSelected("");
                      setEdgeId("");
                    }}
                  >
                    关闭详情
                  </button>
                </div>
                <h3>{chosen.label}</h3>
                {chosen.aliases?.length > 0 && (
                  <p>原文别名：{chosen.aliases.join("、")}</p>
                )}
                <p className="muted">
                  {chosen.evidence.length} 处原文 · {related.length} 条关系 ·
                  提取结果待核对
                </p>
                {onAsk && (
                  <button className="secondary" onClick={() => onAsk(chosen)}>
                    围绕这个主题提问
                  </button>
                )}
                <h4>关系与适用条件</h4>
                {edgeId && (
                  <button className="text-button" onClick={() => setEdgeId("")}>
                    查看此节点全部关系
                  </button>
                )}
                {!detailEdges.length && <p>当前筛选下没有明确关系。</p>}
                {detailEdges.slice(0, evidenceLimit).map((e) => (
                  <article key={e.id}>
                    <strong>{edgeTitle(e)}</strong>
                    <p>
                      <span className="kg-evidence-tag">
                        {e.evidenceKind || "原文提取"}
                      </span>{" "}
                      {e.assertion} · {e.sourceKind} · {e.docTitle}
                      {e.edition && ` · ${e.edition}`}
                    </p>
                    <blockquote>{e.quote}</blockquote>
                    {e.qualifiers?.map((q, i) => (
                      <p key={i}>
                        <b>{q.field}：</b>
                        {q.value}{" "}
                        <button
                          className="text-button"
                          onClick={() => read(e, q)}
                        >
                          核对条件出处
                        </button>
                      </p>
                    ))}
                    <div className="kg-evidence-actions">
                      <button className="text-button" onClick={() => read(e)}>
                        查看依据 · 第 {e.startLine}–{e.endLine} 行
                      </button>
                      <button
                        className="text-button"
                        onClick={() =>
                          selectNode(e.from === chosen.id ? e.to : e.from)
                        }
                      >
                        探索关联知识点
                      </button>
                    </div>
                  </article>
                ))}
                <h4>提到此主题的资料</h4>
                {chosen.evidence.slice(0, evidenceLimit).map((ev, i) => (
                  <article key={i}>
                    <p>
                      {ev.sourceKind} · {ev.docTitle}
                      {ev.edition && ` · ${ev.edition}`}
                    </p>
                    <blockquote>{ev.quote}</blockquote>
                    {ev.attributes?.map((a, j) => (
                      <p key={j}>
                        <b>{a.field}：</b>
                        {a.value}{" "}
                        <button
                          className="text-button"
                          onClick={() => read(ev, a)}
                        >
                          核对字段出处
                        </button>
                      </p>
                    ))}
                    <button className="text-button" onClick={() => read(ev)}>
                      查看原文
                    </button>
                  </article>
                ))}
                {Math.max(detailEdges.length, chosen.evidence.length) >
                  evidenceLimit && (
                  <button
                    className="secondary"
                    onClick={() => setEvidenceLimit(evidenceLimit + 30)}
                  >
                    加载更多依据
                  </button>
                )}
              </aside>
            )}
          </div>
        </>
      )}
      {confirm && (
        <Modal title={buttonLabel} onClose={() => !busy && setConfirm(false)}>
          <p>
            使用当前聊天模型处理「{collection}」中 {graph.pendingDocuments || 0}{" "}
            份待更新资料，相关文字将发送给该模型服务。已完成且未变化的资料会复用，可在后台继续处理。
          </p>
          <p>提取疾病、诊断依据、药品和诊疗路径，保留原文、条件与禁忌。</p>
          {!graph.pendingDocuments && (
            <p>资料与图谱均已是最新，无需再次生成。</p>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="toolbar-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              取消
            </button>
            <button
              className="primary"
              disabled={busy || !graph.pendingDocuments}
              onClick={() =>
                perform(async () => {
                  const result = await api("/api/knowledge/map/build", "POST", {
                    collection,
                    externalConsent: true,
                  });
                  setConfirm(false);
                  setNotice(
                    `已提交 ${result.jobs.length} 份资料，复用 ${result.skipped} 份已完成结果。`,
                  );
                })
              }
            >
              {busy ? "正在提交…" : "开始生成"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
