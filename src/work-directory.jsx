import { useState } from "react";
import {
  Archive,
  BookOpen,
  FileText,
  FolderOpen,
  Pin,
  Plus,
  Search,
  Globe,
  MessageSquare,
  Terminal,
} from "lucide-react";
import { api, medicalEnabled } from "./agent-runtime";
import { SlotItem, useActiveSlot } from "./plugin-slots";
import { taskPatientContext, taskUpdatedLabel } from "../shared/task-display.mjs";
import "./task-context.css";

const date = taskUpdatedLabel;
export function ProjectDirectory({ purpose, items, onOpen, onChanged }) {
  const [query, setQuery] = useState(""),
    [archived, setArchived] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const rows = items
    .filter(
      (x) =>
        Boolean(x.archived) === archived &&
        `${x.title} ${x.root}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        String(b.updatedAt).localeCompare(String(a.updatedAt)),
    );
  async function organize(item, changes) {
    setBusy(item.id);
    setError("");
    try {
      await api(`/api/workspaces/${item.id}/organization`, "PATCH", {
        ...changes,
        revision: item.revision,
      });
      await onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  return (
    <main id="main" className="work-directory" aria-label="项目目录">
      <header className="directory-heading">
        <div>
          <h1>项目</h1>
          {purpose && <p>选择项目，{{ documents: "在任务中处理文档与表格", browser: "预览网页", terminal: "配置隔离终端", extensions: "管理技能与连接" }[purpose]}。</p>}
          <p>项目用于授权本地文件夹，以及浏览器、终端等工具任务。患者记录与问诊可直接使用。</p>
        </div>
        <button className="primary" onClick={() => onOpen({ create: true, purpose, returnTo: "projects" })}>
          <Plus size={17} />
          连接项目
        </button>
      </header>
      <div className="directory-toolbar">
        <div className="directory-filters">
          <button aria-pressed={!archived} onClick={() => setArchived(false)}>
            使用中
          </button>
          <button aria-pressed={archived} onClick={() => setArchived(true)}>
            已归档
          </button>
        </div>
        <label className="directory-search">
          <Search size={17} />
          <input
            aria-label="搜索项目"
            placeholder="搜索名称或目录"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="workspace-error">
          {error}
        </p>
      )}
      <div className="directory-rows">
        {rows.map((item) => (
          <article className="project-directory-row" key={item.id}>
            <FolderOpen size={25} />
            <button
              className="directory-open"
              onClick={() => onOpen({ id: item.id, purpose })}
            >
              <strong>{item.title}</strong>
              <small>{item.root}</small>
            </button>
            <span className="directory-status">
              {item.running
                ? "执行中"
                : item.pending
                  ? `${item.pending} 项待审批`
                  : archived
                    ? "已归档"
                    : ""}
              <small>{date(item.updatedAt)}</small>
            </span>
            <button
              aria-label={`${item.pinned ? "取消固定" : "固定"}${item.title}`}
              aria-pressed={item.pinned}
              disabled={Boolean(busy)}
              onClick={() => organize(item, { pinned: !item.pinned })}
            >
              <Pin size={17} />
            </button>
            <button
              aria-label={`${archived ? "恢复" : "归档"}${item.title}`}
              disabled={Boolean(busy) || item.running}
              onClick={() => organize(item, { archived: !archived })}
            >
              <Archive size={17} />
            </button>
          </article>
        ))}
      </div>
      {!rows.length && (
        <div className="directory-empty">
          <FolderOpen size={32} />
          <h2>
            {query
              ? "没有匹配的项目"
              : archived
                ? "暂无归档项目"
                : "连接一个项目，开始持续工作"}
          </h2>
          <p>
            {query
              ? "试试其他名称或目录关键词。"
              : "项目使用你授权的本地文件夹，已有文件和权限会保留。"}
          </p>
        </div>
      )}
    </main>
  );
}

const catalog = [
  ["browser", "项目浏览器", "在已授权项目中预览网页，保留项目工具上下文。", "项目工具", Globe, "选择项目后使用"],
  ["terminal", "项目终端", "进入项目终端，按该项目授权范围运行命令。", "项目工具", Terminal, "选择项目后使用"],
  [
    "documents",
    "文档与表格",
    "整理文字、表格与资料，生成可复核的文档。",
    "内容处理",
    FileText,
    "任务内使用",
  ],
  [
    "cases",
    "病例库",
    "整理已保存的病例，查找相似病例。",
    "医疗工具",
    BookOpen,
    "本地病例",
  ],
];
// The fixed catalog keeps its order while plugin cards slot in at the same
// positions the old hard-coded rows used.
const CATALOG_ORDER = {
  browser: 10,
  terminal: 20,
  documents: 30,
  literature: 40,
  care: 50,
  followups: 55,
  "clinical-ref": 70,
  cases: 80,
  "data-analysis": 90,
};

export function ToolDirectory({ config, onNavigate, onProjects, onModelSettings }) {
  const [filter, setFilter] = useState("全部"),
    [query, setQuery] = useState("");
  const pluginTools = useActiveSlot("tools.directory");
  const availability = id => id === "documents"
    ? config?.modelConfigured ? { action: "打开" } : { label: "需要配置模型", action: "配置模型", model: true }
    : { action: "打开" };
  const medical = medicalEnabled(config),
    categories = [
      "全部",
      "内容处理",
      "信息查找",
      "项目工具",
      ...(medical ? ["医疗工具", "科研工具"] : []),
    ];
  const matches = (id, name, desc, category, keywords = "") =>
    (filter === "全部" || category === filter) &&
    `${name} ${desc} ${keywords}`.toLowerCase().includes(query.trim().toLowerCase());
  const rows = [
    ...catalog
      .filter(
        (x) =>
          (medical ||
            x[0] !== "cases") &&
          matches(
            x[0],
            x[1],
            x[2],
            x[3],
            {"documents":"Word Excel 报告"}[x[0]] || "",
          ),
      )
      .map((row) => ({ kind: "fixed", id: row[0], order: CATALOG_ORDER[row[0]] ?? 100, row })),
    ...pluginTools
      .filter((tool) => {
        const meta = tool.meta || {};
        if (!medical && meta.medical) return false;
        return matches(tool.id, meta.name || tool.label, meta.description || "", meta.category, meta.keywords);
      })
      .map((tool) => ({ kind: "plugin", id: `plugin:${tool.pluginId}:${tool.id}`, order: tool.order ?? 100, tool })),
  ].sort((left, right) => left.order - right.order);
  return (
    <main id="main" className="work-directory" aria-label="工具目录">
      <header className="directory-heading">
        <div>
          <h1>资料与工具</h1>
          {medical && <p><button className="text-button" onClick={() => onNavigate("examples")}>查看示例资料与任务</button></p>}

        </div>
      </header>
      <div className="directory-toolbar">
        <div className="directory-filters">
          {categories.map((c) => (
            <button
              key={c}
              aria-pressed={filter === c}
              onClick={() => setFilter(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <label className="directory-search">
          <Search size={17} />
          <input
            aria-label="搜索工具"
            placeholder="搜索功能，如文献、量表、统计"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="directory-tools">
        {rows.map((entry) => {
          if (entry.kind === "plugin")
            return <SlotItem key={entry.id} contribution={entry.tool} onNavigate={onNavigate} config={config} />;
          const [id, name, desc, _category, Icon, status] = entry.row;
          const state = availability(id);
          return (
          <article key={id}>
            <a className="tool-card-link" href={`?view=${["documents", "browser", "terminal"].includes(id) ? "projects" : id}`} onClick={event => {
              event.preventDefault();
                      if (state.model) onModelSettings();
              else if (["documents", "browser", "terminal"].includes(id)) onProjects(id);
              else onNavigate(id);
            }}>
            <Icon size={24} />
            <h2>{name}</h2>
            <p>{desc}</p>
            <footer>
              {(state.label || status) && <small>{state.label || status}</small>}
              <span className="tool-card-action">
                {state.action}{" "}
                →
              </span>
            </footer>
            </a>
          </article>
        );})}
      </div>
      {!rows.length && <p className="directory-empty">没有找到匹配工具。</p>}

    </main>
  );
}
export function TaskDirectory({
  sessions,
  workspaces,
  patients,
  onTask,
  onProject,
}) {
  const [filter, setFilter] = useState("全部"),
    [query, setQuery] = useState("");
  const rows = [
    ...sessions.map((x) => ({
      ...x,
      ref: `session:${x.id}`,
      backend: "session",
      type: x.patientId ? "患者关联" : "一般",
    })),
    ...workspaces
      .filter((x) => !x.archived)
      .map((x) => ({
        ...x,
        ref: `workspace:${x.id}`,
        backend: "workspace",
        type: "项目",
      })),
  ]
    .filter(
      (x) =>
        (filter === "全部" || x.type === filter) &&
        `${x.title} ${patients.find((p) => p.id === x.patientId)?.name || ""} ${patients.find((p) => p.id === x.patientId)?.patientNumber || ""}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  return (
    <main id="main" className="work-directory" aria-label="任务记录">
      <header className="directory-heading">
        <div>
          <h1>任务记录</h1>

        </div>
      </header>
      <div className="directory-toolbar">
        <div className="directory-filters">
          {["全部", "一般", ...(patients.length || sessions.some(x => x.patientId) ? ["患者关联"] : []), "项目"].map((c) => (
            <button
              key={c}
              aria-pressed={filter === c}
              onClick={() => setFilter(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <label className="directory-search">
          <Search size={17} />
          <input
            aria-label="搜索任务记录"
            placeholder="搜索完整标题、患者或病历号"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && <button type="button" className="text-button" aria-label="清空任务搜索" onClick={() => setQuery("")}>清空</button>}
        </label>
      </div>
      <div className="directory-rows">
        {rows.map((x) => (
          <button
            className="task-directory-row"
            key={x.ref}
            title={[x.title, taskPatientContext(x, patients), date(x.updatedAt)].filter(Boolean).join(" · ")}
            onClick={() =>
              x.backend === "session" ? onTask(x.id) : onProject({ id: x.id })
            }
          >
            <MessageSquare size={21} />
            <span>
              <strong>{x.title}</strong>
              <small>
                {x.type}
                {x.patientId ? ` · ${taskPatientContext(x, patients)}` : ""}{" "}
                · {date(x.updatedAt)}
              </small>
            </span>
            <em>
              {x.running
                ? "执行中"
                : x.pending
                    ? `${x.pending} 项待审批`
                    : ({ failed: "执行失败", cancelled: "已停止", interrupted: "已中断", completed: "已完成" }[x.lastRunStatus || x.status] || "")}
            </em>
          </button>
        ))}
      </div>
      {!rows.length && (
        <div className="directory-empty">
          <h2>暂无匹配任务</h2>
          <p>修改筛选条件，或新建任务开始。</p>
        </div>
      )}
    </main>
  );
}
