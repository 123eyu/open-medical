import { useState } from "react";
import {
  Archive,
  BookOpen,
  FileText,
  FolderOpen,
  Inbox,
  MessageSquare,
  Pin,
  Plus,
  Search,
  Stethoscope,
  Sigma,
} from "lucide-react";
import { api, medicalEnabled } from "./agent-runtime";

const date = (value) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "尚未开始";
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
        </div>
        <button className="primary" onClick={() => onOpen({ create: true })}>
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
              onClick={() => onOpen({ id: item.id })}
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
  [
    "documents",
    "文档与表格",
    "整理文字、表格与资料，生成可复核的文档。",
    "内容处理",
    FileText,
    "任务内使用",
  ],
  [
    "literature",
    "文献检索",
    "查找 PubMed 文献并保留引用来源。",
    "信息查找",
    Search,
    "联网检索",
  ],
  ["care", "患者消息", "查看患者消息，处理回复草稿与客户联系。", "医疗工具", Inbox, "患者沟通"],
  ["followups", "随访", "管理随访计划、待办和患者反馈。", "医疗工具", MessageSquare, "随访管理"],
  ["research", "临床试验", "管理试验方案，按入排标准开展患者初筛。", "科研工具", BookOpen, "试验初筛"],
  [
    "clinical-ref",
    "临床速查",
    "量表、检验、编码与 ADR 查询。",
    "医疗工具",
    Stethoscope,
    "本地工具",
  ],
  [
    "cases",
    "病例库",
    "整理已保存的病例，查找相似病例。",
    "医疗工具",
    BookOpen,
    "本地病例",
  ],
  ["data-analysis", "科研统计", "上传 CSV，进行描述统计、组间比较、样本量估算与脱敏导出。", "科研工具", Sigma, "本地计算"],
];
export function ToolDirectory({ config, onNavigate, onProjects, onModelSettings }) {
  const [filter, setFilter] = useState("全部"),
    [query, setQuery] = useState("");
  const availability = id => id === "documents"
    ? config?.modelConfigured ? { action: "打开" } : { label: "需要配置模型", action: "配置模型", model: true }
    : { action: "打开" };
  const medical = medicalEnabled(config),
    categories = [
      "全部",
      "内容处理",
      "信息查找",
      ...(medical ? ["医疗工具", "科研工具"] : []),
    ];
  const rows = catalog.filter(
    (x) =>
      (medical ||
        !["literature", "care", "followups", "research", "clinical-ref", "cases", "drg", "data-analysis"].includes(
          x[0],
        )) &&
      (filter === "全部" || x[3] === filter) &&
      `${x[1]} ${x[2]} ${{"clinical-ref":"评分 计算器 不良反应 药物", "care":"消息 回复 客户 企业微信", "followups":"随访 计划 反馈", "research":"试验 入组 入排", "data-analysis":"数据分析 统计学 CSV", "documents":"Word Excel 报告"}[x[0]] || ""}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <main id="main" className="work-directory" aria-label="工具目录">
      <header className="directory-heading">
        <div>
          <h1>资料与工具</h1>
          {medical && <p>还没有资料？<button className="text-button" onClick={() => onNavigate("examples")}>用默认示例体验这些功能</button></p>}

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
        {rows.map(([id, name, desc, _category, Icon, status]) => {
          const state = availability(id);
          return (
          <article key={id}>
            <a className="tool-card-link" href={`?view=${id === "documents" ? "projects" : id}`} onClick={event => {
              event.preventDefault();
                      if (state.model) onModelSettings();
              else if (id === "documents") onProjects(id);
              else onNavigate(id);
            }}>
            <Icon size={24} />
            <h2>{name}</h2>
            <p>{desc}</p>
            <footer>
              <small>
                {state.label || status}
              </small>
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
        `${x.title} ${patients.find((p) => p.id === x.patientId)?.name || ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
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
            placeholder="搜索任务或患者"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="directory-rows">
        {rows.map((x) => (
          <button
            className="task-directory-row"
            key={x.ref}
            onClick={() =>
              x.backend === "session" ? onTask(x.id) : onProject({ id: x.id })
            }
          >
            <MessageSquare size={21} />
            <span>
              <strong>{x.title}</strong>
              <small>
                {x.type}
                {x.patientId
                  ? ` · ${patients.find((p) => p.id === x.patientId)?.name || "关联患者"}`
                  : ""}{" "}
                · {date(x.updatedAt)}
              </small>
            </span>
            <em>
              {x.running
                ? "执行中"
                : x.pending
                    ? `${x.pending} 项待审批`
                    : x.status === "failed"
                      ? "执行失败"
                      : ""}
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
