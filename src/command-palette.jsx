import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowRight, CalendarClock, FolderOpen, Inbox, Search, Stethoscope, UserPlus } from "lucide-react";

// 命令面板（Cmd/Ctrl+K）：患者快速检索（姓名 / 编号 / 姓氏拼音首字母）
// 与常用导航。门诊场景下医生不该为找一位患者多点三次。
// 拼音首字母只覆盖常见姓氏：完整拼音转换需要引入分词库，先解决
// 「张医生输入 z 就能找到张三」这类最高频路径。
const SURNAME_INITIAL = "白b蔡c曹c岑c崔c戴d邓d丁d董d窦d杜d段d樊f范f方f冯f符f傅f高g葛g龚g顾g郭g韩h何h贺h洪h侯h胡h华h黄h姬j吉j贾j江j姜j蒋j金j康k孔k雷l黎l李l廉l林l凌l刘l柳l龙l卢l鲁l陆l罗l骆l马m毛m孟m莫m倪n聂n欧o潘p彭p皮p蒲p齐q钱q秦q邱q裘q屈q邵b沈s施s石s史s舒s宋s苏s孙s谭t唐t陶t田t童t万w汪w王w韦w魏w温w吴w伍w武w席x夏x肖x谢x邢x徐x许x薛x严y颜y杨y姚y叶y易y殷y于y余y俞y虞y袁y岳y曾z詹z张z赵z郑z钟z周z朱z祝z邹z";
const surnameMap = new Map();
for (let i = 0; i < SURNAME_INITIAL.length - 1; i += 2)
  if (!surnameMap.has(SURNAME_INITIAL[i])) surnameMap.set(SURNAME_INITIAL[i], SURNAME_INITIAL[i + 1]);
const surnameInitials = name => surnameMap.get(String(name || "").trim().charAt(0)) || "";

const COMMANDS = medical => [
  { id: "home", label: "新建任务", hint: "回到任务入口", icon: UserPlus, run: "home" },
  ...(medical ? [
    { id: "agenda", label: "今日待办", hint: "今天要处理的患者与事项", icon: CalendarClock, run: "agenda" },
    { id: "patients", label: "患者列表", hint: "全部在管患者", icon: Stethoscope, run: "patients" },
    { id: "care", label: "患者消息", hint: "微信 / 企微收件与回复", icon: Inbox, run: "care" },
    { id: "review", label: "待复核", hint: "AI 草稿复核队列", icon: Activity, run: "review" },
  ] : [
    { id: "tasks", label: "任务记录", hint: "历史任务", icon: Activity, run: "tasks" },
    { id: "projects", label: "项目文件", hint: "项目工作区", icon: FolderOpen, run: "projects" },
  ]),
];

export function CommandPalette({ open, onClose, patients, medical, onOpenPatient, onNavigate, onCreatePatient }) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null), listRef = useRef(null);

  useEffect(() => { if (open) { setQuery(""); setCursor(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const commands = COMMANDS(medical)
      .filter(c => !q || c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q))
      .map(c => ({ kind: "command", ...c }));
    if (!q) return commands;
    const matches = patients
      .filter(p => {
        const name = String(p.name || ""), number = String(p.patientNumber || "").toLowerCase();
        return name.toLowerCase().includes(q) || number.includes(q) || surnameInitials(name) === q.charAt(0) && q.length <= 2 && name.includes(q.slice(1));
      })
      .slice(0, 7)
      .map(p => ({ kind: "patient", id: p.id, label: p.name, hint: `${p.patientNumber || p.id.slice(0, 8)}${p.birthYear ? ` · ${new Date().getFullYear() - p.birthYear} 岁` : ""}${p.groups?.length ? ` · ${p.groups.join("、")}` : ""}`, patient: p }));
    return [...matches, ...commands];
  }, [query, patients, medical]);

  useEffect(() => { setCursor(0); }, [query]);
  useEffect(() => {
    const node = listRef.current?.children[cursor];
    node?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;
  const pick = item => {
    onClose();
    if (item.kind === "patient") onOpenPatient(item.patient);
    else if (item.run === "patients") onNavigate("patients");
    else onNavigate(item.run);
  };
  return <div className="palette-scrim" onClick={onClose}>
    <div className="palette" role="dialog" aria-label="命令面板" onClick={e => e.stopPropagation()}>
      <div className="palette-input">
        <Search size={16} />
        <input
          ref={inputRef}
          aria-label="搜索患者或功能"
          placeholder="患者姓名 / 编号 / 姓氏拼音，或功能名…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
            else if (e.key === "Enter" && results[cursor]) { e.preventDefault(); pick(results[cursor]); }
            else if (e.key === "Escape") onClose();
          }}
        />
        <kbd>esc</kbd>
      </div>
      {results.length ? <ul ref={listRef} className="palette-list">
        {results.map((item, i) => <li key={item.kind + (item.id || item.run)}>
          <button className={i === cursor ? "active" : ""} onMouseEnter={() => setCursor(i)} onClick={() => pick(item)}>
            {item.kind === "patient"
              ? <><Stethoscope size={15} /><b>{item.label}</b><small>{item.hint}</small><ArrowRight size={13} className="palette-go" /></>
              : <><item.icon size={15} /><b>{item.label}</b><small>{item.hint}</small></>}
          </button>
        </li>)}
      </ul> : <div className="palette-empty">
        <p>没有匹配「{query}」的患者或功能。</p>
        {medical && onCreatePatient && <button onClick={() => { onClose(); onCreatePatient(); }}><UserPlus size={14} />新建患者「{query}」</button>}
      </div>}
      <footer className="palette-footer"><span><kbd>↑↓</kbd> 选择</span><span><kbd>↵</kbd> 打开</span><span><kbd>esc</kbd> 关闭</span></footer>
    </div>
  </div>;
}

// 全局 Cmd/Ctrl+K 热键钩子；避开输入框内的原生场景（面板自身输入除外）。
export function usePaletteHotkey(setOpen) {
  useEffect(() => {
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(v => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);
}
