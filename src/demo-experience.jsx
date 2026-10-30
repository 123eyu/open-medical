import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, Check, Loader2 } from "lucide-react";
import { api } from "./agent-runtime";
import { DEMO_CONTEXT } from "./task-context";
import { taskTemplateContext } from "../shared/task-templates.mjs";
import { usePluginActive, usePluginConnected } from "./plugin-slots";
import {
  DEMO_SCENARIOS,
  demoScenarioCopy,
  demoScenarioVisible,
} from "../shared/demo-experience.mjs";
import "./demo-experience.css";

export function DemoExperience({ flows, onView, onPatient, onOpenTask, onChanged, entryHidden, preferenceBusy, onEntryHiddenChange }) {
  const followupActive = usePluginActive("followup");
  const messaging = usePluginConnected("followup");
  const [state, setState] = useState(null);
  const [group, setGroup] = useState("临床与患者");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [visited, setVisited] = useState(() => { try { const saved = JSON.parse(localStorage.getItem("omw-demo-visited") || "[]"); return Array.isArray(saved) ? saved.filter(id => typeof id === "string") : []; } catch { return []; } });
  useEffect(() => { api("/api/demo-pack").then(setState).catch(e => setError(e.message)); }, []);
  const prepare = async () => {
    const result = await api("/api/demo-pack", "POST", {});
    setState(result);
    await onChanged?.();
    return result;
  };
  const run = async (key, action) => {
    if (busy) return;
    setBusy(key); setError(""); setNotice("");
    try { await action(); } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  };
  const open = (scenario, ask = false) => run(scenario.id, async () => {
    const data = await prepare();
    const patient = data.patients.find(p => p.index === (scenario.patient ?? 0));
    const flow = flows.find(f => f.id === scenario.flow);
    const question = scenario.question || flow?.prompt;
    if ((ask || (!scenario.view && !scenario.tab && !scenario.task)) && question) {
      if (scenario.patient !== undefined && (!patient || patient.archived)) throw new Error("这位示例患者已归档，请先在患者列表恢复，或删除示例后重新准备。");
      // 「虚构示例」说明作为附带上下文，不拼进医生的问题。
      await onOpenTask(scenario.patient !== undefined ? patient.sessionId : data.sessionId, { draft: question, tab: "materials", newQuestion: true, context: [DEMO_CONTEXT, ...(scenario.question ? [] : [flow?.template && taskTemplateContext(flow.template)].filter(Boolean))] });
    } else if (scenario.view) onView(scenario.view);
    else if (scenario.tab) {
      if (!patient || patient.archived) throw new Error("示例患者已归档，请先在患者列表恢复，或删除示例后重新准备。");
      onPatient({ id: patient.id, tab: scenario.tab });
    } else await onOpenTask(data.sessionId, { draft: question, tab: "materials", context: [DEMO_CONTEXT, ...(scenario.question ? [] : [flow?.template && taskTemplateContext(flow.template)].filter(Boolean))] });
    const next = [...new Set([...visited, scenario.id])];
    setVisited(next);
    try { localStorage.setItem("omw-demo-visited", JSON.stringify(next)); } catch { /* optional progress */ }
  });
  const scenarios = group === "任务模板" ? flows
    .filter(flow => flow.id !== "followup" || followupActive)
    .map(flow => ({
      id: `template:${flow.id}`, title: flow.title, detail: flow.desc, flow: flow.id,
      ...(flow.id === "decision-flow" ? { question: DEMO_SCENARIOS.find(s => s.id === "flowchart").question, detail: "从虚构资料核对手册生成流程图，练习节点与出处对应。" } : {}),
      patient: ["discharge-summary", "handoff", "case-report"].includes(flow.id) ? 2 : 0,
      ...(flow.id === "followup" ? { patient: 1, tab: "followups" } : {}),
      next: "会先打开示例材料与任务要求。核对后发送，可继续追问、调整草稿和查看成果。",
    })) : DEMO_SCENARIOS
    .filter((scenario) => scenario.group === group && demoScenarioVisible(scenario, followupActive, messaging))
    .map((scenario) => ({
      ...scenario,
      ...demoScenarioCopy(scenario, followupActive, messaging),
    }));
  const groups = ["临床与患者", "资料与研究", "工作台能力", "任务模板"];
  const actionLabel = s => s.tab === "library" ? "查看示例材料" : s.view || s.tab ? "打开功能" : "准备示例任务";
  return <main id="main" className="demo-experience work-directory">
    <header className="om-page-head demo-head"><div><h1>示例体验</h1><span className="om-page-meta">选一个场景，材料会自动准备好。看看数据，试着问一句，再继续操作。</span></div>
      <div className="om-page-actions"><button className="text-button" disabled={preferenceBusy} onClick={() => onEntryHiddenChange(!entryHidden)}>{entryHidden ? "显示入口" : "隐藏入口"}</button></div></header>
    {entryHidden && <p role="status" className="demo-note">侧栏和首页入口已隐藏，可在设置中恢复。示例资料仍然保留。</p>}
    <section className={`demo-welcome${state?.installed ? " is-ready" : ""}`} aria-label="示例数据管理">
      <BookOpen size={22} aria-hidden="true"/>
      <div><p className="demo-welcome-title"><span className={`om-chip ${state?.installed ? "is-ok" : "is-caution"}`}>{state?.installed ? "已就位" : "未准备"}</span><b>{state?.installed ? "示例资料已就位，可以随时接着体验" : "不用上传资料，也能开始第一项任务"}</b></p>
        <p>3 位虚构患者 · 原始病历与检验{messaging ? " · 随访问卷 · 消息草稿" : followupActive ? " · 随访提醒" : ""} · 知识库 · 病例与试验方案 · 研究 CSV</p>
        <small>浏览与本地计算无需模型；AI 问答使用你配置的模型，发送前仍可核对材料和外发许可。</small></div>
      <button className={state?.installed ? "secondary" : "primary"} disabled={Boolean(busy)} onClick={() => run("prepare", async () => { await prepare(); setNotice("示例已准备好。请选择下方场景；重复准备不会覆盖已编辑的数据。"); })}>{busy === "prepare" ? <Loader2 size={16} className="spin"/> : null}{state?.installed ? "补齐示例资料" : "准备全部示例"}</button>
    </section>
    {error && <p role="alert" className="error-text">{error}</p>}
    {notice && <p role="status" className="demo-note">{notice}</p>}
    {busy && <p role="status" className="demo-note">正在准备示例资料，请稍候…</p>}
    <nav className="demo-tabs" aria-label="示例分类">{groups.map(label => <button key={label} type="button" className={`demo-tab${group === label ? " active" : ""}`} aria-pressed={group === label} onClick={() => setGroup(label)}>{label}</button>)}</nav>
    <ol className="demo-scenarios">{scenarios.map((s, index) => {
      const done = visited.includes(s.id);
      return <li key={s.id} className={`demo-scenario${done ? " is-visited" : ""}`}>
        <span className="demo-step" aria-hidden="true">{done ? <Check size={15}/> : index + 1}</span>
        <div className="demo-scenario-body">
          <div className="demo-scenario-title"><h2>{s.title}</h2>{done && <span className="om-chip is-ok">已打开</span>}</div>
          <p>{s.detail}</p>
          {s.next && <p className="demo-next"><span>接着试：</span>{s.next}</p>}
        </div>
        <div className="demo-actions"><button className="primary" disabled={Boolean(busy)} onClick={() => open(s)}>{actionLabel(s)}<ArrowRight size={14}/></button>{(s.question || s.flow && s.flow !== "followup") && (s.view || s.tab) && <button className="secondary" disabled={Boolean(busy)} onClick={() => open(s, true)}>试着问 AI</button>}</div>
      </li>;
    })}</ol>
    <footer className="demo-footer">
      <aside className="demo-boundaries"><b>继续探索连接与扩展</b><p>浏览器、终端、插件、远程执行与消息渠道需要相应运行环境或账号。示例任务可用于文件和对话练习；真实微信收发、外部文献检索和远程执行仍需连接服务。</p><div><button className="om-link" onClick={() => onView("settings")}>查看设置与连接</button><button className="om-link" onClick={() => onView("projects")}>打开项目文件</button></div></aside>
      {state?.installed && <div className="demo-cleanup"><button className="text-button danger" disabled={Boolean(busy)} onClick={() => setConfirmClear(!confirmClear)}>删除示例数据</button>{confirmClear && <div className="demo-confirm" role="group" aria-label="确认删除示例"><p>将删除示例患者、其材料和练习记录，以及本示例包创建的知识文档、病例、方案和数据任务。你对这些示例的修改也会删除。</p><div><button className="secondary" disabled={Boolean(busy)} onClick={() => setConfirmClear(false)}>保留</button><button className="danger" disabled={Boolean(busy)} onClick={() => run("clear", async () => { setState(await api("/api/demo-pack", "DELETE", {})); await onChanged?.(); setConfirmClear(false); setVisited([]); try { localStorage.removeItem("omw-demo-visited"); } catch { /* optional progress */ } setNotice("示例已删除，其他资料保留。可以重新准备开始练习。"); })}>确认删除示例</button></div></div>}</div>}
    </footer>
  </main>;
}
