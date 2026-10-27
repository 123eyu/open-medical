import { BackupPanel } from "./backup-panel";
import { LearningSettings } from "./learning-loop";
import { ChatConnectionSettings } from "./chat-followups";
import { useEffect, useRef, useState } from "react";
import { api, medicalEnabled } from "./agent-runtime";
import { dueNotifyEnabled, setDueNotifyEnabled } from "./due-notify";
import { WorkspaceExtensionsPanel } from "./workspace-extensions";
import { ExtensionCenter, takeSettingsTab } from "./extension-center";
import { FeishuKnowledgeBotSettings } from "./feishu-knowledge-bot";
import { DoctorNotificationSettings } from "./doctor-notifications";
import { MessageChannelSettings } from "./message-channels";
import { KnowledgeTranscriptionSettings } from "./knowledge-transcription-settings";

const CHANNEL_SECTIONS = [
  ["channels", "私聊助手"],
  ["knowledge-bot", "飞书知识库机器人"],
  ["notifications", "医生提醒"],
  ["followup", "患者随访"],
];
const PERSONAL_SECTIONS = [
  ["skills", "技能"],
  ["workbench", "自动化规则"],
  ["learning", "学习与记忆"],
];

function settingsGroup(section) {
  if (section === "transcription") return "connections";
  if (section === "plugins" || CHANNEL_SECTIONS.some(([id]) => id === section)) return "channels";
  if (PERSONAL_SECTIONS.some(([id]) => id === section)) return "personal";
  return section;
}

function SettingsSubnav({ label, items, section, onSelect }) {
  return <nav className="settings-subnav" aria-label={label}>
    {items.map(([id, title]) => <button key={id} aria-pressed={section === id} onClick={() => onSelect(id)}>{title}</button>)}
  </nav>;
}

// Native controls stay unavailable in the developer browser preview.
function DesktopAppPanel({ desktop }) {
  const [autoLogin, setAutoLogin] = useState(null);
  const [dueNotify, setDueNotify] = useState(() => dueNotifyEnabled());
  const [note, setNote] = useState("");
  useEffect(() => {
    desktop.loginItemAtLogin?.().then(setAutoLogin).catch(() => setAutoLogin(false));
  }, [desktop]);
  async function toggleAutoLogin(event) {
    const requested = event.target.checked;
    setAutoLogin(requested);
    try {
      setAutoLogin(await desktop.setLoginItemAtLogin(requested));
      setNote(requested ? "已开启登录时自动启动。" : "已关闭登录时自动启动。");
    } catch (error) {
      setAutoLogin(!requested);
      setNote(`设置失败：${error.message}`);
    }
  }
  function toggleDueNotify(event) {
    const on = event.target.checked;
    setDueNotifyEnabled(on);
    setDueNotify(on);
    setNote(on ? "已开启到期提醒：随访、复诊、新结果等新待办出现且窗口不在前台时，系统会通知你。" : "已关闭到期提醒，到期的事项仍会列在「今日待办」页里。");
  }
  return <section className="desktop-preferences" aria-label="桌面应用">
    <h2>桌面应用</h2>
    <p>关闭或隐藏窗口后，后台任务与提醒继续运行；退出应用会停止任务。</p>

    {note && <p className="settings-desktop-note" role="status">{note}</p>}
    <div className="toolbar-actions">
      {desktop.loginItemAtLogin && <label className="settings-login-item"><input type="checkbox" checked={autoLogin === true} disabled={autoLogin === null} onChange={toggleAutoLogin} />登录时自动启动</label>}
      {desktop.showNotification && <label className="settings-login-item"><input type="checkbox" checked={dueNotify} onChange={toggleDueNotify} />到期事项系统提醒</label>}
    </div>
    <details><summary>应用维护</summary>
    <div className="toolbar-actions">
      {desktop.openDataDirectory && <button onClick={() => desktop.openDataDirectory().catch(error => setNote(`打开失败：${error.message}`))}>打开数据目录</button>}
      {desktop.openConfigDirectory && <button onClick={() => desktop.openConfigDirectory().catch(error => setNote(`打开失败：${error.message}`))}>打开配置目录</button>}
      {desktop.relaunchApp && <button onClick={() => desktop.relaunchApp().catch(error => setNote(`重启失败：${error.message}`))}>重启应用</button>}
    </div>
    </details>
  </section>;
}

export function AppSettingsView({ config, onModel, onDoctor, onProjects, onAsk, demoPreferenceBusy, onDemoEntryHiddenChange }) {
  useEffect(() => { if (new URLSearchParams(window.location.search).get('doctor') === '1') onDoctor(); }, []);
  const param = new URLSearchParams(window.location.search).get("settingsTab");
  const [section, updateSection] = useState(() => {
    const initial = takeSettingsTab() || param || "general";
    const requested = initial === "personal" ? "skills" : initial;
    const group = settingsGroup(requested);
    if (["channels", "personal"].includes(group) && !medicalEnabled(config)) return "general";
    if (requested === "desktop" && !window.omwDesktop) return "general";
    return ["general", "desktop", "connections", "channels", "personal", "backup"].includes(group) ? requested : "general";
  });
  const group = settingsGroup(section);
  function setSection(next) {
    updateSection(next);
    const url = new URL(window.location.href);
    url.searchParams.set("settingsTab", next);
    window.history.replaceState(window.history.state, "", url);
  }
  const [projects, setProjects] = useState([]), [selected, setSelected] = useState("");
  const [workspace, setWorkspace] = useState(null), [error, setError] = useState(""), [loading, setLoading] = useState(false), [reload, setReload] = useState(0);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    if (section !== "connections") return;
    let alive = true;
    setLoading(true); setError("");
    api("/api/workspaces").then(value => { if (alive) setProjects(value.workspaces.filter(w => !w.archived && w.kind !== "session")); }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [section, reload]);
  useEffect(() => {
    let alive = true;
    setWorkspace(null);
    if (!selected) return;
    setError("");
    api(`/api/workspaces/${selected}`).then(value => { if (alive) setWorkspace(value); }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [selected, reload]);
  async function refresh(id) {
    const value = await api(`/api/workspaces/${id}`);
    if (selectedRef.current === id) setWorkspace(value);
  }
  return <section className="app-settings-page" aria-label="应用设置">
    <header className="directory-heading"><div><h1>设置</h1></div></header>
    <div className="app-settings-layout">
      <nav aria-label="设置分类">
        <button aria-pressed={group === "general"} onClick={() => setSection("general")}>模型与运行</button>
        {medicalEnabled(config) && <button aria-pressed={group === "channels"} onClick={() => setSection("channels")}>消息渠道</button>}
        {medicalEnabled(config) && <button aria-pressed={group === "personal"} onClick={() => setSection("skills")}>技能与规则</button>}
        <button aria-pressed={group === "backup"} onClick={() => setSection("backup")}>备份与恢复</button>
        <button aria-pressed={group === "connections"} onClick={() => setSection("connections")}>工具与服务</button>
        {window.omwDesktop && <button aria-pressed={group === "desktop"} onClick={() => setSection("desktop")}>桌面应用</button>}
      </nav>
      <div className="app-settings-content">
        {section === "backup" && <BackupPanel />}
        {group === "channels" && <>
          <SettingsSubnav label="消息渠道用途" items={CHANNEL_SECTIONS} section={section === "plugins" ? "followup" : section} onSelect={setSection} />
          {section === "channels" ? <MessageChannelSettings /> : section === "knowledge-bot" ? <FeishuKnowledgeBotSettings /> : section === "notifications" ? <DoctorNotificationSettings /> : <>
            <ChatConnectionSettings />
          </>}
        </>}
        {group === "personal" && <>
          <SettingsSubnav label="技能与规则分类" items={PERSONAL_SECTIONS} section={section} onSelect={setSection} />
          {section === "learning" ? <section><h2>学习与记忆</h2><p>管理医生档案、使用习惯和资料使用授权。</p><button onClick={onDoctor}>医生档案与记忆</button><LearningSettings /></section> : <ExtensionCenter key={section} view={section === "skills" ? "skills" : "workbench"} onAsk={onAsk} />}
        </>}
        {window.omwDesktop && section === "desktop" && <DesktopAppPanel desktop={window.omwDesktop} />}
        {section === "general" && <section><h2>模型与运行</h2><p>{config?.modelConfigured ? `当前模型：${config.provider} · ${config.model}` : "尚未配置模型"}</p><div className="toolbar-actions"><button onClick={onModel}>选择模型</button></div></section>}
        {section === "general" && medicalEnabled(config) && <section><h2>工作台显示</h2><label><input type="checkbox" checked={!config.demoEntryHidden} disabled={demoPreferenceBusy} onChange={event => onDemoEntryHiddenChange(!event.target.checked)} /> 显示示例体验入口</label><p>在侧栏首位和首页显示示例入口。隐藏入口会保留已有示例资料。</p></section>}
        {group === "connections" && medicalEnabled(config) && <SettingsSubnav label="工具与服务分类" items={[["connections","项目工具"],["transcription","音视频转写"]]} section={section} onSelect={setSection}/>}
        {section === "transcription" && medicalEnabled(config) && <KnowledgeTranscriptionSettings/>}
        {section === "connections" && <section>
          <h2>工具与服务</h2><p>选择项目可使用的工具与服务。访问范围和授权按项目保存。</p>
          {error && <div role="alert"><p>{error}</p><button onClick={() => setReload(v => v + 1)}>重新加载设置</button></div>}
          {loading && <p role="status">正在读取项目…</p>}
          <label className="settings-project-picker">配置所属项目<select aria-label="配置所属项目" value={selected} onChange={e => setSelected(e.target.value)}><option value="">请选择项目</option>{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
          {!loading && !error && !projects.length && <p>先连接项目，为工具确定可访问的资料范围。<button onClick={onProjects}>连接项目</button></p>}
          {selected && !workspace && !error && <p role="status">正在读取项目配置…</p>}
          {workspace && <><p className="muted">当前项目：{workspace.title}</p><WorkspaceExtensionsPanel key={workspace.id} workspace={workspace} refresh={refresh} disabled={workspace.runs?.some(r => r.status === "running")} focus="configuration" /></>}
        </section>}
      </div>
    </div>
  </section>;
}
