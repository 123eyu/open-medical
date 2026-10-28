import { useEffect, useMemo, useRef, useState } from 'react';
import { dashboardLabGroups, dashboardLabLayout, dashboardLabComparison } from '../shared/patient-dashboard.mjs';
import { diagnosisSources } from '../shared/diagnoses.mjs';
import { api } from './agent-runtime';
import './patient-labs.css';

export function PatientLabs({ patient, session, focusLab, onChanged, onError, onClinical, onOpenWorkspace, onEdit, Plot, citedFileName }) {
  const [display, setDisplay] = useState(patient.labDisplay || { revision: 0 });
  const [displayBusy, setDisplayBusy] = useState(false);
  const [monitors, setMonitors] = useState([]);
  const [monitorAlerts, setMonitorAlerts] = useState({});
  const [monitorForm, setMonitorForm] = useState(null);
  const [monitorBusy, setMonitorBusy] = useState(false);
  const monitorThreshold = useRef(null);
  const focusedLab = useRef(null);
  const [releasedFocus, setReleasedFocus] = useState(null);
  useEffect(() => { if (monitorForm) { monitorThreshold.current?.focus(); monitorThreshold.current?.scrollIntoView({block:'center'}); } }, [monitorForm?.item, monitorForm?.unit]);
  const [expandedKey, setExpandedKey] = useState(null);
  const [query, setQuery] = useState('');
  const [monitorOpen, setMonitorOpen] = useState(false);
  const groups = useMemo(()=>dashboardLabGroups(patient.labs || []),[patient.labs]);
  const layout = dashboardLabLayout(patient.labs || [], display, monitors);
  const focusKey = focusLab?.patientId === patient.id && releasedFocus !== focusLab ? focusLab.key : null;
  const visibleLabs = layout.groups.filter(group => !layout.hidden.some(hidden => hidden.key === group.key) || group.key === focusKey);
  const hiddenLabs = layout.hidden.filter(group => group.key !== focusKey);
  const selectedKey = expandedKey ?? focusKey;
  useEffect(() => {
    if (!focusKey || !focusedLab.current) return;
    const records = focusedLab.current.querySelector('.chart-lab-records');
    if (records) records.open = true;
    focusedLab.current.scrollIntoView({ block: 'start' });
    focusedLab.current.focus({ preventScroll: true });
  }, [focusKey]);
  const comparisonDates = [...new Set(layout.comparison.flatMap(g => g.records.map(r => r.date || '日期未记录')))].sort().reverse();
  const files = session.files || [];
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
      if (patch.reset || patch.hidden?.includes(focusKey) || patch.collapsed?.includes(focusKey)) setReleasedFocus(focusLab);
      onChanged?.();
    } catch (error) {
      onError?.(error.message);
      try { const result = await api(`/api/patients/${patient.id}/lab-display`); setDisplay(result.preferences); } catch {}
    } finally { setDisplayBusy(false); }
  };
  const toggleDisplay = (field, key) => {
    const current = display[field] || (field === 'compare' ? groups.map(g => g.key) : []);
    const selected = current.includes(key) && !(field === 'collapsed' && key === focusKey);
    saveDisplay({ [field]: selected ? current.filter(k => k !== key) : [...new Set([...current, key])] });
  };
  const hideLab = key => {
    setExpandedKey(null);
    if (display.hidden?.includes(key)) setReleasedFocus(focusLab);
    else saveDisplay({ hidden: [...(display.hidden || []), key] });
  };
  const startMonitor = group => {
    setMonitorOpen(true);
    setMonitorForm({item: group.item, unit: group.unit || '', op: 'gt', threshold: '', recheckDays: '', severity: 'warning', note: ''});
  };
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

  const matchingLabs = visibleLabs.filter(group => group.key === focusKey || `${group.item} ${group.unit}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section className="patient-labs" aria-label="检验结果">
    <header className="labs-heading">
      <div><h2>检验结果</h2><span className="muted">{groups.length} 项指标 · {patient.labs?.length || 0} 条记录</span></div>
      <div className="labs-header-actions">
        <button className="secondary" disabled={patient.archived} onClick={onEdit}>添加检验</button>
        <details className="labs-menu"><summary>更多</summary><div className="labs-menu-content">
          <button className="text-button" disabled={patient.archived} onClick={()=>onOpenWorkspace(session.id, {tab:'materials'})}>添加报告资料</button>
          <button className="text-button" onClick={onEdit}>编辑记录</button>
          <button className="text-button" onClick={()=>onOpenWorkspace(session.id, {draft: `请帮我调整当前患者的检验趋势展示习惯（患者 ID：${patient.id}）。先读取当前展示偏好和指标，我想调整：`})}>和 AI 调整展示</button>
          <button className="text-button" disabled={displayBusy} onClick={()=>saveDisplay({reset:true})}>恢复默认展示</button>
        </div></details>
      </div>
    </header>
    {groups.length > 5 && <input className="labs-search" type="search" aria-label="查找检验项目" placeholder="查找检验项目" value={query} onChange={event=>setQuery(event.target.value)}/>}
    {!!visibleLabs.length && <div className="labs-column-head" aria-hidden="true"><span>检验项目 / 单位</span><span>最新结果</span><span>上次结果</span><span>较上次</span><span/></div>}
    <div className="labs-list">{matchingLabs.map(group=>{
      const summary = dashboardLabComparison(group);
      const focused = group.key === focusKey;
      const expanded = selectedKey === group.key;
      const collapsed = layout.collapsed.has(group.key) && !focused;
      const ranges = [...new Set(summary.latestRecords.map(record=>record.referenceRange).filter(Boolean))];
      return <article className={`lab-result${focused ? ' is-focused' : ''}`} key={group.key} ref={focused ? focusedLab : undefined} tabIndex={-1} aria-label={`${group.item} ${group.unit || '单位未记录'}`}>
        <div className="lab-result-row">
          <div className="lab-result-name"><h3>{group.item}</h3><small>{group.unit || '单位未记录'}</small>{summary.undatedCount > 0 && <small className="lab-data-note">{summary.date ? '另有 ' : ''}{summary.undatedCount} 条日期未明确</small>}</div>
          <div className="lab-result-value" role="group" aria-label="最新结果"><span className="lab-mobile-label">最新结果</span><strong>{summary.values.join(' / ')}</strong><time>{summary.date || '日期未明确'}</time>{summary.values.length > 1 && <small className="lab-data-note">{summary.date ? '同日不同结果' : '多条结果，无法排序'}</small>}{!!ranges.length && <small>参考：{ranges.join(' / ')}</small>}</div>
          <div className="lab-result-previous" role="group" aria-label="上次结果"><span className="lab-mobile-label">上次结果</span><b>{summary.previousValues.length ? summary.previousValues.join(' / ') : '—'}</b><time>{summary.previousDate || '暂无更早记录'}</time>{summary.previousValues.length > 1 && <small className="lab-data-note">同日不同结果</small>}</div>
          <div className="lab-result-change" role="group" aria-label="较上次变化"><span className="lab-mobile-label">较上次</span><b>{summary.delta === null ? '—' : summary.delta === 0 ? '持平' : `${summary.delta > 0 ? '↑' : '↓'} ${Math.abs(summary.delta)}`}</b>{summary.deltaReason && <small>{summary.deltaReason}</small>}</div>
          <button className="text-button lab-result-toggle" aria-expanded={expanded} onClick={()=>{setExpandedKey(expanded ? '' : group.key);}}>{expanded ? '收起详情' : '查看详情'}</button>
        </div>
        {expanded && <div className="lab-result-detail">
          {focused && layout.hidden.some(hidden => hidden.key === group.key) && <p className="chart-lab-hint">已临时展开这项记录；离开后仍按原展示设置显示。</p>}
          <div className="lab-detail-toolbar"><b>趋势与来源 · {group.records.length} 条记录</b><div>
            <button className="text-button" disabled={patient.archived} onClick={()=>startMonitor(group)}>设置监测</button>
            <details className="labs-menu"><summary>对照与展示</summary><div className="labs-menu-content">
              <button className="text-button" disabled={displayBusy} onClick={()=>saveDisplay({order:[group.key, ...layout.groups.map(g=>g.key).filter(k=>k!==group.key)]})}>排在最前</button>
              <button className="text-button" disabled={displayBusy} aria-pressed={layout.comparison.some(g=>g.key===group.key)} onClick={()=>toggleDisplay('compare',group.key)}>{layout.comparison.some(g=>g.key===group.key) ? '移出对照' : '加入对照'}</button>
              <button className="text-button" disabled={displayBusy} aria-expanded={!collapsed} onClick={()=>toggleDisplay('collapsed',group.key)}>{collapsed ? '展开趋势' : '折叠趋势'}</button>
              <button className="text-button" disabled={displayBusy} onClick={()=>hideLab(group.key)}>隐藏</button>
            </div></details>
          </div></div>
          {!collapsed && (group.canPlot ? <Plot group={group}/> : <p className="chart-empty">暂无可绘图的日期与数值，原始记录见下方。</p>)}
          {group.conflict && <p className="chart-lab-hint">{group.conflictDates.join('、')} 存在同日不同数值，已保留全部记录与来源。</p>}
            <details className="chart-lab-records" open><summary>全部记录与来源 · {group.records.length} 条</summary><div className="chart-table-wrap"><table><caption>{group.item} · 全部记录</caption><thead><tr><th>日期</th><th>结果</th><th>单位</th><th>报告参考范围</th><th>来源</th><th>备注</th></tr></thead><tbody>{group.records.toReversed().map((r,i)=>{ const cited = citedFileName(diagnosisSources(r).join("；")); const matches = cited ? files.filter(f=>f.name.toLowerCase()===cited.toLowerCase()) : []; return <tr key={i}><td>{r.date || '日期未记录'}</td><td><b>{r.value ?? '结果未记录'}</b></td><td>{r.unit || '未记录'}</td><td>{r.referenceRange || '未记录，查看原报告'}</td><td>{diagnosisSources(r).join('；') || '来源未记录'}{matches.length === 1 && <button className="text-button" onClick={()=>onClinical('library',{focusFile:matches[0].id})}>查看原文 {matches[0].name}</button>}{matches.length > 1 && <button className="text-button" onClick={()=>onClinical('library')}>同名资料有多份，到资料库核对</button>}</td><td>{r.note || '—'}</td></tr>;})}</tbody></table></div></details>
        </div>}
      </article>;
    })}</div>
    {!groups.length && <div className="labs-empty"><p>暂无检验结果</p><button className="text-button" disabled={patient.archived} onClick={()=>onOpenWorkspace(session.id, {tab:'materials'})}>添加报告资料</button></div>}
    {!!groups.length && !matchingLabs.length && <p className="muted">{query ? '没有匹配的检验项目。' : '检验项目已隐藏，可在下方恢复。'}</p>}
    {!!hiddenLabs.length && <details className="chart-hidden-labs"><summary>已隐藏 {hiddenLabs.length} 项检验 · 展开后可恢复</summary>{hiddenLabs.map(g=><div key={g.key}><span>{g.item} · {g.unit || '单位未记录'}</span><button className="text-button" disabled={displayBusy} onClick={()=>toggleDisplay('hidden',g.key)}>恢复展示</button></div>)}</details>}
    {!!groups.length && <div className="labs-secondary">
      <details className="labs-history"><summary>历次对照</summary>
        {layout.comparison.length ? <div className="chart-table-wrap chart-lab-comparison"><table>
          <caption>检验结果对照 · {layout.comparison.length} 项</caption>
          <thead><tr><th>检验项目 / 单位</th>{comparisonDates.map(date=><th key={date}>{date}</th>)}</tr></thead>
          <tbody>{layout.comparison.map(g=><tr key={g.key}><th>{g.item}<small>{g.unit || '单位未记录'}</small></th>{comparisonDates.map(date=>{
            const records = g.records.filter(r=>(r.date || '日期未记录') === date);
            return <td key={date} title={records.map(r=>diagnosisSources(r).join('；') || '来源未记录').join('；')}>{records.length ? records.map(r=>r.value ?? '结果未记录').join(' / ') : '—'}</td>;
          })}</tr>)}</tbody>
        </table></div> : <p className="muted">暂无参与对照的项目，可在检验详情中加入。</p>}
      </details>
    </div>}
    {(!!groups.length || !!monitors.length) && <details className="labs-monitor-settings" open={monitorOpen} onToggle={event=>setMonitorOpen(event.currentTarget.open)}><summary>监测设置{monitors.length ? ` · ${monitors.length} 项` : ''}</summary>
      <div className="chart-monitors" aria-label="个性化检验监测">
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
        {!monitors.length && !monitorForm && <p className="muted">展开一项检验的详情，即可设置监测阈值或复查间隔。</p>}

      </div>
    </details>}
  </section>;
}
