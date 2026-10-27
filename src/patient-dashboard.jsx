import { HabitSuggestion, SimilarCaseCard } from "./learning-loop";
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { dashboardLabGroups, dashboardLabLayout } from '../shared/patient-dashboard.mjs';
import { PatientOverview } from './patient-overview';
import { PatientMaterialLibrary } from './patient-material-library';
import { api } from './agent-runtime';
import './patient-dashboard.css';
import { labAxis } from '../shared/lab-axis.mjs';
import { ClinicalPanel } from './patient-clinical';
import { hasClinicalDraft } from './clinical-drafts';
import { TreatmentPanel } from './patient-treatment';
import { PatientHistory } from './patient-history';
import { diagnosisSources } from '../shared/diagnoses.mjs';
import { CLINICAL_SUMMARY_INSTRUCTION } from '../shared/clinical-summary.mjs';

// 从病程/诊断备注里提取引用的原文文件名（与「查看原文」跳转共用）。
export function citedFileName(text) {
  const m = String(text || '').match(/([^\s,，、;；:：()（）[\]【】「」《》"'']+\.(?:jpe?g|png|webp|pdf|txt|md|docx|xlsx))/i);
  return m ? m[1] : '';
}
function LabPlot({ group, compact = false }) {
  const points = group.points, values = points.map(p=>p.value);
  const dates = [...new Set(points.map(p=>p.date))].sort();
  const axis = labAxis(values);
  let start=Date.parse(dates[0]), end=Date.parse(dates.at(-1));
  if (start===end) { start-=43200000; end+=43200000; } // 单日记录左右各留半天，散点才落得进坐标系
  const width = compact ? 420 : 700, right = width - 40, left = Math.max(60, Math.min(200, Math.max(...axis.ticks.map(t=>t.label.length))*7+16));
  const x = p => left + (Date.parse(p.date)-start)/(end-start)*(right-left);
  const y = p => 150-axis.position(p.value)*115;
  const unique = [...new Map(points.map(p=>[`${p.date}|${p.value}`,p])).values()];
  // 同日多值时不连线：并列数值之间没有先后，连了就是假趋势。
  const line = dates.length > 1 && !group.conflict;
  return <div className="lab-plot-scroll" tabIndex={0} aria-label="检验图，可横向滚动"><svg viewBox={`0 0 ${width} 194`} role="img" aria-label={`${group.item} ${group.unit || '单位未记录'} 检验趋势，${points.length} 次记录${line ? '' : '，散点展示'}`}>
    {axis.ticks.map(({value,label},i)=><g key={i}><line x1={left} x2={right} y1={y({value})} y2={y({value})} stroke="var(--border)"/><text x={left-11} y={y({value})+4} textAnchor="end">{label}</text></g>)}
    {line && <polyline fill="none" stroke="var(--accent)" strokeWidth="2.5" points={unique.map(p=>`${x(p)},${y(p)}`).join(' ')} />}
    {unique.map((p,i)=><circle key={i} cx={x(p)} cy={y(p)} r="4" fill="var(--accent)"><title>{p.date}：{p.value} {group.unit || '单位未记录'}；{diagnosisSources(p).join('；') || '来源未记录'}{p.note ? `；备注：${p.note}` : ''}</title></circle>)}
    {dates.length > 1 ? <><text x={left} y="182">{dates[0]}</text><text x={right} y="182" textAnchor="end">{dates.at(-1)}</text></> : <text x={width/2} y="182" textAnchor="middle">{dates[0]}</text>}
  </svg></div>;
}
export function PatientDashboard({ patient, session, onClinical, onOpenWorkspace, onView, view = "overview", followups = [], focusFile = null, editRequest, onEditRequestHandled, onChanged, onError }) {
  const [editing, setEditing] = useState(() => hasClinicalDraft(patient.id, view));
  useEffect(() => {
    if (editRequest?.patientId !== patient.id || editRequest?.tab !== view) return;
    setEditing(true);
    onEditRequestHandled?.();
  }, [editRequest, patient.id, view, onEditRequestHandled]);
  const titles = {overview:'患者概览',diagnoses:'诊断与病史',medications:'治疗方案与预后',labs:'检验趋势',visits:'就诊经过',library:'资料库'};
  const [display, setDisplay] = useState(patient.labDisplay || { revision: 0 });
  const [displayBusy, setDisplayBusy] = useState(false);
  const [visionSupported, setVisionSupported] = useState(false);
  const [ocrNotice, setOcrNotice] = useState('');
  const [monitors, setMonitors] = useState([]);
  const [monitorAlerts, setMonitorAlerts] = useState({});
  const [monitorForm, setMonitorForm] = useState(null);
  const [monitorBusy, setMonitorBusy] = useState(false);
  const monitorThreshold = useRef(null);
  useEffect(() => { if (monitorForm) { monitorThreshold.current?.focus(); monitorThreshold.current?.scrollIntoView({block:'center'}); } }, [monitorForm?.item, monitorForm?.unit]);
  const groups = useMemo(()=>dashboardLabGroups(patient.labs || []),[patient.labs]);
  const layout = dashboardLabLayout(patient.labs || [], display, monitors);
  const comparisonDates = [...new Set(layout.comparison.flatMap(g => g.records.map(r => r.date || '日期未记录')))].sort().reverse();
  const visits=patient.visits || [];
  const files=session.files || [];
  const visitsSorted=[...visits].sort((a,b)=>String(b.date || '').localeCompare(String(a.date || '')));
  useEffect(() => { api('/api/ocr-settings').then(s => setVisionSupported(s.imageCapable === true)).catch(() => {}); }, []);
  const loadMonitors = () => {
    api(`/api/patients/${patient.id}/lab-monitors`).then(s => setMonitors(s.monitors || [])).catch(() => {});
    api(`/api/risk-alerts?patientId=${patient.id}`).then(s => {
      const map = {};
      for (const alert of s.alerts || []) if (typeof alert.ruleKey === 'string' && alert.ruleKey.startsWith('lab_monitor_')) map[alert.ruleKey.slice('lab_monitor_'.length)] = alert;
      setMonitorAlerts(map);
    }).catch(() => {});
  };
  useEffect(() => { loadMonitors(); }, [patient.id]);
  useEffect(() => { setDisplay(patient.labDisplay || { revision: 0 }); }, [patient.id, patient.labDisplay]);
  const saveDisplay = async patch => {
    setDisplayBusy(true);
    try {
      const result = await api(`/api/patients/${patient.id}/lab-display`, 'PATCH', { expectedRevision: display.revision, ...patch });
      setDisplay(result.preferences);
      onChanged?.();
    } catch (error) {
      onError?.(error.message);
      try { const result = await api(`/api/patients/${patient.id}/lab-display`); setDisplay(result.preferences); } catch {}
    } finally { setDisplayBusy(false); }
  };
  const toggleDisplay = (field, key) => {
    const current = display[field] || (field === 'compare' ? groups.map(g => g.key) : []);
    saveDisplay({ [field]: current.includes(key) ? current.filter(k => k !== key) : [...current, key] });
  };
  const startMonitor = group => setMonitorForm({item: group.item, unit: group.unit || '', op: 'gt', threshold: '', recheckDays: '', severity: 'warning', note: ''});
  const submitMonitor = async (event) => {
    event.preventDefault();
    const threshold = Number(monitorForm.threshold);
    if (monitorForm.threshold === '' || !Number.isFinite(threshold)) { onError?.('监测阈值须为数值'); return; }
    const recheck = monitorForm.recheckDays === '' || monitorForm.recheckDays === null ? null : Number(monitorForm.recheckDays);
    setMonitorBusy(true);
    try {
      await api(`/api/patients/${patient.id}/lab-monitors`, 'POST', { item: monitorForm.item, unit: monitorForm.unit, op: monitorForm.op, threshold, recheckDays: recheck, severity: monitorForm.severity, note: monitorForm.note });
      setMonitorForm(null);
      loadMonitors();
    } catch (error) { onError?.(error.message); } finally { setMonitorBusy(false); }
  };
  const toggleMonitor = async (monitor) => {
    try {
      await api(`/api/patients/${patient.id}/lab-monitors/${monitor.id}`, 'PATCH', { revision: monitor.revision, status: monitor.status === 'paused' ? 'active' : 'paused' });
      loadMonitors();
    } catch (error) { onError?.(error.message); }
  };
  const removeMonitor = async (monitor) => {
    try {
      await api(`/api/patients/${patient.id}/lab-monitors/${monitor.id}`, 'DELETE', { revision: monitor.revision });
      loadMonitors();
    } catch (error) { onError?.(error.message); }
  };
  const handleMaterialsChanged = (message) => { setOcrNotice(typeof message === 'string' ? message : ''); return onChanged?.(); };
  return <section className="patient-dashboard" aria-label="患者资料面板">
    <header className="chart-heading"><div><h2>{titles[view]}</h2><p>更新于 {patient.updatedAt ? new Date(patient.updatedAt).toLocaleDateString('zh-CN') : '日期未记录'}</p></div>{view === 'labs' && <div className="toolbar-actions">{!editing && <button className="secondary" disabled={patient.archived} onClick={()=>setEditing(true)}>添加检验</button>}<button className="secondary" disabled={patient.archived} onClick={()=>onOpenWorkspace(session.id, {tab:'materials'})}>添加报告资料</button></div>}{!['overview','library'].includes(view) && <button className="secondary" onClick={()=>setEditing(!editing)}>{editing ? '返回记录' : view === 'medications' ? '编辑用药与过敏' : '编辑记录'} <ArrowUpRight size={15}/></button>}</header>
    {editing ? <ClinicalPanel detail={patient} section={view} onChanged={onChanged} onError={onError}/> : <>
    {view === 'overview' && <><PatientOverview patient={patient} session={session} groups={groups} onNavigate={onClinical} onOpenWorkspace={onOpenWorkspace} onView={onView}/><HabitSuggestion key={patient.id} patientId={patient.id}/><SimilarCaseCard key={`similar-${patient.id}`} patientId={patient.id}/></>}
    {view === 'diagnoses' && <PatientHistory patient={patient} files={files} onEdit={()=>setEditing(true)} onNavigate={onClinical} onChanged={onChanged} citedFileName={citedFileName} onSummarize={()=>onOpenWorkspace(session.id, {draft: `请根据当前患者（ID：${patient.id}）已有档案及原始资料，重新整理并保存精简病史摘要，保留其他临床记录。${CLINICAL_SUMMARY_INSTRUCTION}`})}/>}
    <div>
      {view === 'medications' && <TreatmentPanel patient={patient} followups={followups} files={files} citedFileName={citedFileName} groups={groups} Plot={LabPlot} onEditMedications={()=>setEditing(true)} onNavigate={onClinical} onChanged={onChanged}/>}
    </div>
    {view === 'labs' && <section className="chart-section chart-labs" aria-label="检验资料与趋势"><div className="lab-reading-toolbar">
        <span className="muted">{groups.length} 项指标 · {patient.labs?.length || 0} 条记录</span>
        <details className="lab-display-options"><summary>展示与对照设置</summary>
          <p>同项目、同单位分别展示。监测项目、同日数值冲突和多次检验优先；趋势仅呈现记录，不自动判断正常或异常。</p>
          <button className="secondary" onClick={()=>onOpenWorkspace(session.id, {draft: `请帮我调整当前患者的检验趋势展示习惯（患者 ID：${patient.id}）。先读取当前展示偏好和指标，我想调整：`})}>和 AI 调整展示</button>
          <button className="text-button" disabled={displayBusy} onClick={()=>saveDisplay({reset:true})}>恢复默认展示</button>
        </details>
      </div>
      {!!layout.comparison.length && <div className="chart-table-wrap chart-lab-comparison"><table>
        <caption>检验结果对照 · {layout.comparison.length} 项</caption>
        <thead><tr><th>检验项目 / 单位</th>{comparisonDates.map(date=><th key={date}>{date}</th>)}</tr></thead>
        <tbody>{layout.comparison.map(g=><tr key={g.key}><th>{g.item}<small>{g.unit || '单位未记录'}</small></th>{comparisonDates.map(date=>{
          const records = g.records.filter(r=>(r.date || '日期未记录') === date);
          return <td key={date} title={records.map(r=>diagnosisSources(r).join('；') || '来源未记录').join('；')}>{records.length ? records.map(r=>r.value).join(' / ') : '—'}</td>;
        })}</tr>)}</tbody>
      </table></div>}
      <h3 className="lab-section-title">逐项趋势与来源</h3><div className="chart-lab-grid">{layout.visible.map(group=>{
        const collapsed = layout.collapsed.has(group.key);
        const latest = group.records.at(-1);
        return <article className="chart-lab-card" key={group.key} aria-label={`${group.item} ${group.unit || '单位未记录'}`}>
          <header><div><h4>{group.item}</h4><small>{group.unit || '单位未记录'} · {group.records.length} 次记录</small></div>
            <div className="chart-lab-latest"><b>{group.latestConflict ? '同日有不同数值' : latest?.value}</b><small>{latest?.date || '日期未记录'}</small></div>
          </header>
          <button className="text-button" disabled={patient.archived} onClick={()=>startMonitor(group)}>设置监测</button>
          <details className="chart-lab-actions"><summary>对照与展示</summary>
            <button className="text-button" disabled={displayBusy} onClick={()=>saveDisplay({order:[group.key, ...layout.groups.map(g=>g.key).filter(k=>k!==group.key)]})}>排在最前</button>
            <button className="text-button" disabled={displayBusy} aria-pressed={layout.comparison.some(g=>g.key===group.key)} onClick={()=>toggleDisplay('compare',group.key)}>{layout.comparison.some(g=>g.key===group.key) ? '移出对照' : '加入对照'}</button>
            <button className="text-button" disabled={displayBusy} aria-expanded={!collapsed} onClick={()=>toggleDisplay('collapsed',group.key)}>{collapsed ? '展开趋势' : '折叠趋势'}</button>
            <button className="text-button" disabled={displayBusy} onClick={()=>toggleDisplay('hidden',group.key)}>隐藏</button>
          </details>
          {!collapsed && <>
            {group.canPlot ? <LabPlot group={group}/> : <p className="chart-empty">缺少有效日期或数值，请核对明细。</p>}
            {group.conflict && <p className="chart-lab-hint">{group.conflictDates.join('、')} 存在同日不同数值，已保留全部记录与来源。</p>}
            {group.distinctDates === 1 && <p className="chart-lab-hint">目前只有一天的记录，还连不成趋势线。</p>}
            {!group.unit && <p className="chart-lab-hint">单位未记录，纵轴只表示数值相对高低。</p>}
            <details className="chart-lab-records"><summary>全部记录与来源 · {group.records.length} 条</summary><div className="chart-table-wrap"><table><caption>{group.item} · 全部记录</caption><thead><tr><th>日期</th><th>结果</th><th>单位</th><th>报告参考范围</th><th>来源</th><th>备注</th></tr></thead><tbody>{group.records.toReversed().map((r,i)=>{ const cited = citedFileName(diagnosisSources(r).join("；")); const matches = cited ? files.filter(f=>f.name.toLowerCase()===cited.toLowerCase()) : []; return <tr key={i}><td>{r.date || '日期未记录'}</td><td><b>{r.value}</b></td><td>{r.unit || '未记录'}</td><td>{r.referenceRange || '未记录，查看原报告'}</td><td>{diagnosisSources(r).join('；') || '来源未记录'}{matches.length === 1 && <button className="text-button" onClick={()=>onClinical('library',{focusFile:matches[0].id})}>查看原文 {matches[0].name}</button>}{matches.length > 1 && <button className="text-button" onClick={()=>onClinical('library')}>同名资料有多份，到资料库核对</button>}</td><td>{r.note || '—'}</td></tr>;})}</tbody></table></div></details>
          </>}
        </article>;
      })}</div>
      {!!layout.hidden.length && <details className="chart-hidden-labs"><summary>已隐藏 {layout.hidden.length} 项检验 · 展开后可恢复</summary>{layout.hidden.map(g=><div key={g.key}><span>{g.item} · {g.unit || '单位未记录'}</span><button className="text-button" disabled={displayBusy} onClick={()=>toggleDisplay('hidden',g.key)}>恢复展示</button></div>)}</details>}
      {!groups.length && <p className="chart-empty">资料中尚无结构化检验记录。</p>}
      {(!!groups.length || !!monitors.length) && <div className="chart-monitors" aria-label="个性化检验监测">
        <header><div><h4>个性化监测</h4><p>在指标上点“设置监测”可设阈值或复查间隔；越界或到期进入今日待办的风险提示。隐藏指标不影响监测。</p></div></header>
        {monitorForm && <form className="chart-monitor-form" onSubmit={submitMonitor}>
          <div className="chart-monitor-row"><b>{monitorForm.item}</b><label>条件<select value={monitorForm.op} onChange={e=>setMonitorForm({...monitorForm, op: e.target.value})}><option value="gt">高于</option><option value="lt">低于</option></select></label>
          <label>阈值<input ref={monitorThreshold} type="number" step="any" required value={monitorForm.threshold} onChange={e=>setMonitorForm({...monitorForm, threshold: e.target.value})}/><span>{monitorForm.unit || '单位未记录'}</span></label>
          <label>复查间隔（天，可选）<input type="number" min="1" max="3650" value={monitorForm.recheckDays} onChange={e=>setMonitorForm({...monitorForm, recheckDays: e.target.value})}/></label>
          <label>严重度<select value={monitorForm.severity} onChange={e=>setMonitorForm({...monitorForm, severity: e.target.value})}><option value="warning">提醒</option><option value="critical">重要</option></select></label>
          <label>备注<input value={monitorForm.note} maxLength={200} onChange={e=>setMonitorForm({...monitorForm, note: e.target.value})}/></label></div>
          <div className="chart-monitor-actions"><button className="primary" type="submit" disabled={monitorBusy}>保存并开始监测</button><button className="text-button" type="button" onClick={()=>setMonitorForm(null)}>取消</button></div>
        </form>}
        {!!monitors.length && <ul className="chart-monitor-list">{monitors.map(m => {
          const alert = monitorAlerts[m.id];
          return <li key={m.id}>
            <b>{m.item}</b><span>{m.op === 'gt' ? '高于' : '低于'} {m.threshold}{m.unitHint || ''}</span>
            {!!m.recheckDays && <span>每 {m.recheckDays} 天复查</span>}
            <span className={`chart-monitor-sev ${m.severity}`}>{m.severity === 'critical' ? '重要' : '提醒'}</span>
            {m.status === 'paused' ? <span className="chart-monitor-state paused">已暂停</span> : alert && alert.status !== 'resolved' ? <span className="chart-monitor-state fired">已触发 · 见今日待办</span> : <span className="chart-monitor-state">监测中</span>}
            {m.note && <small className="muted">{m.note}</small>}
            <span className="chart-monitor-actions"><button className="text-button" onClick={()=>toggleMonitor(m)}>{m.status === 'paused' ? '恢复' : '暂停'}</button><button className="text-button danger" onClick={()=>removeMonitor(m)}>删除</button></span>
          </li>;
        })}</ul>}
        {!monitors.length && !monitorForm && <p className="muted">尚未设置个性化监测。内置的通用风险规则不受影响，始终生效。</p>}
      </div>}
    </section>}
    <div>
      {view === 'visits' && <section id="chart-visits" className="chart-section" aria-label="就诊时间轴"><header><h3>就诊时间轴</h3><small>按资料中的日期排列</small></header>{visits.length ? <ol className="chart-timeline">{visitsSorted.map((v,i)=>{
        const cited = citedFileName(v.source) || citedFileName(v.note) || citedFileName(v.reason) || v.source;
        const matches = cited ? files.filter(f => f.name.toLowerCase() === cited.toLowerCase()) : [];
        const target = matches.length === 1 ? matches[0] : null;
        return <li key={i}><time>{v.date || '日期未记录'}</time><h4>{v.reason}</h4>{v.note && <p>{v.note}</p>}{v.source && <p className="muted">来源：{v.source}</p>}{target && <button className="text-button" onClick={()=>onClinical('library', { focusFile: target.id })}>查看原文 {target.name}</button>}{matches.length > 1 && <button className="text-button" onClick={()=>onClinical('library')}>同名资料有多份，到资料库核对</button>}</li>;
      })}</ol> : <p className="chart-empty">暂无就诊记录。</p>}</section>}
      {view === 'library' && <>{ocrNotice && <p role="status">{ocrNotice}</p>}{!!session.intakeIssues?.length && <div role="status"><b>以下资料未能导入</b>{session.intakeIssues.map((issue, i) => <p key={i}>{issue.name}：{issue.error || '读取失败'}</p>)}</div>}<PatientMaterialLibrary files={files} sessionId={session.id} focusFile={focusFile} visionSupported={visionSupported} onChanged={handleMaterialsChanged} onError={onError} onOpenWorkspace={onOpenWorkspace}/></>}
    </div>
    </>}
  </section>;
}
