import { useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { DIAGNOSIS_STATUS_LABELS, DIAGNOSIS_STATUS_SHORT, diagnosisSources, groupDiagnoses } from '../shared/diagnoses.mjs';
import { api } from './agent-runtime';
import { useClinicalDraft } from './clinical-drafts';
import { SUMMARY_FIELDS, SUMMARY_LIMIT, parseClinicalSummary, formatClinicalSummary } from '../shared/clinical-summary.mjs';
import './patient-history.css';

// Only format existing text; uncertainty and original wording stay intact.
function paragraphs(text) {
  return String(text || '').split(/\n+/).filter(p => p.trim());
}
function RecordSource({ sources, onSource }) {
  if (!sources.length) return <p className="history-muted">来源未记录</p>;
  return <ul className="history-source-list">{sources.map(source => <li key={source}><span>{source}</span>{onSource(source) > 0 && <button className="text-button" onClick={()=>onSource(source, true)}>{onSource(source) === 1 ? '查看原文' : '到资料库选择同名文件'}</button>}</li>)}</ul>;
}
function DiagnosisRecord({ diagnosis, status, onSource, showStatus = true }) {
  return <li className="history-diagnosis-record">
    <details>
      <summary><span className="history-diagnosis-name">{diagnosis.name}</span>{showStatus && <span className={`history-diagnosis-badge ${status}`}>{DIAGNOSIS_STATUS_SHORT[status]}</span>}<time aria-label={`记录日期：${diagnosis.date || '未记录'}`}>{diagnosis.date || '日期未记录'}</time><span className="history-detail-label">详情</span></summary>
      <div className="history-diagnosis-detail">{diagnosis.code && <p>ICD · {diagnosis.code}</p>}<RecordSource sources={diagnosisSources(diagnosis)} onSource={onSource}/></div>
    </details>
    {diagnosis.note && <p className="history-diagnosis-note">{diagnosis.note}</p>}
  </li>;
}

export function PatientHistory({ patient, files, onEdit, onNavigate, onChanged, citedFileName, onSummarize }) {
  const groups = groupDiagnoses(patient.diagnoses || []);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [editor, setEditor] = useClinicalDraft(patient.id, "clinicalSummary", null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(null);
  const [choices, setChoices] = useState({});
  const inFlight = useRef(false);
  const summary = patient.clinicalSummary;
  const concise = parseClinicalSummary(summary?.text);
  const clinicalGroups = groups.filter(g => ['confirmed', 'suspected'].includes(g.status));
  const uncertain = groups.find(g => g.status === "needs_review")?.items || [];
  const findings = groups.find(g => g.status === 'finding')?.items || [];
  const total = clinicalGroups.reduce((sum,g)=>sum+g.items.length,0);
  const hasRecords = Boolean(summary?.text || patient.note || files.length || ['diagnoses','medications','labs','visits'].some(key => patient[key]?.length));
  const otherDiagnosisSummary = [
    uncertain.length && `待核对 ${uncertain.length} 项`,
    findings.length && `影像与检验发现 ${findings.length} 项`,
  ].filter(Boolean).join('、');
  const diagnosisEmptyText = otherDiagnosisSummary
    ? `暂无确诊或疑似诊断；另有${otherDiagnosisSummary}，见本页相应分类。`
    : '尚未登记诊断';
  const matches = clinicalGroups.filter(g => filter === 'all' || filter === g.status).map(g=>({...g,items:g.items.filter(d=>[d.name,d.code,d.note,...diagnosisSources(d)].filter(Boolean).join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))})).filter(g=>g.items.length);
  const sourceLink = (source, navigate = false) => {
    const name = citedFileName(source);
    const matches = name ? files.filter(f=>f.name.toLowerCase() === name.toLowerCase()) : [];
    const file = matches.length === 1 ? matches[0] : null;
    if (file && navigate) onNavigate('library', { focusFile: file.id });
    if (matches.length > 1 && navigate) onNavigate('library');
    return matches.length;
  };
  const editSummary = () => { setEditor(editor || { _revision:patient.revision, current:concise?.current || '', problems:concise?.problems || '', course:concise?.course || '', source:summary?.source || '' }); setError(''); };
  const saveSummary = async event => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      await api(`/api/patients/${patient.id}`, 'PATCH', { expectedRevision:editor._revision, clinicalSummary:{text:formatClinicalSummary(editor),source:editor.source.trim()} });
      await onChanged?.(); setEditor(null);
    } catch (err) {
      setError(err.message);
      if (err.code === 'REVISION_CONFLICT') {
        try { setConflict(await api(`/api/patients/${patient.id}`)); setChoices({}); }
        catch (loadError) { setError(`${err.message}；读取最新档案失败：${loadError.message}。草稿已保留，可再次保存以重试核对。`); }
      }
    }
    finally { inFlight.current = false; setBusy(false); }
  };
  const longSummary = !concise && (String(summary?.text || '').length > 360 || paragraphs(summary?.text).length > 6);
  return <div className="patient-history-workspace">
    <section className="history-section history-summary" aria-label="病史摘要">
      <header><h3>病史摘要</h3>{!editor && <div className="history-summary-actions">
        <button className="text-button" disabled={patient.archived || busy} onClick={editSummary}>{summary?.text ? '编辑摘要' : '补充摘要'}</button>
        {hasRecords && <details className="history-summary-menu"><summary>更多</summary><div>
          {summary?.text && <RecordSource sources={summary.source?[summary.source]:[]} onSource={sourceLink}/>}
          <button className="text-button" disabled={patient.archived || !onSummarize} onClick={onSummarize}>整理摘要草稿</button>
        </div></details>}
      </div>}</header>
      {editor ? <form onSubmit={saveSummary} aria-label="编辑病史摘要"><fieldset disabled={busy}>
            {SUMMARY_FIELDS.map(([key,label])=><label key={key}>{label}<textarea rows={2} maxLength={SUMMARY_LIMIT} required value={editor[key]} onChange={e=>setEditor({...editor,[key]:e.target.value})} placeholder={key==='current'?'截至哪次就诊，患者目前状态如何？':key==='problems'?'当前需要处理的症状、功能影响或临床问题；保留疑似表述。':'起病 → 关键治疗 → 近期变化。'}/><small>{editor[key].length} / {SUMMARY_LIMIT}</small></label>)}
            {summary?.text && !concise && <details><summary>参考既有病史记录</summary><p className="clinical-summary-text">{summary.text}</p></details>}
            <label>病史摘要来源<textarea rows={2} maxLength={2000} required value={editor.source} onChange={e=>setEditor({...editor,source:e.target.value})} placeholder="填写原始病历、报告或本次问诊记录的出处"/></label>
            {error && <p className="error" role="alert">{error}</p>}
            {conflict && <section aria-label="摘要版本核对">
              <h4>最新摘要与本地草稿</h4><p>核对后继续编辑，仍需再次保存。其他档案内容不会被本次摘要修改。</p>
              {[...SUMMARY_FIELDS, ['source','病史摘要来源']].map(([key,label])=>{
                const latest = key === 'source' ? conflict.clinicalSummary?.source : parseClinicalSummary(conflict.clinicalSummary?.text)?.[key];
                return <div key={key}><b>{label}</b><p>最新：{latest || '未记录'}</p><p>草稿：{editor[key]}</p><label>{label}保留版本<select value={choices[key] || 'local'} onChange={e=>setChoices({...choices,[key]:e.target.value})}><option value="local">保留本地草稿</option><option value="latest">采用最新记录</option></select></label></div>;
              })}
              {conflict.clinicalSummary?.text && !parseClinicalSummary(conflict.clinicalSummary.text) && <p className="clinical-summary-text">最新原记录：{conflict.clinicalSummary.text}</p>}
              <button type="button" onClick={()=>{
                const latest = {...parseClinicalSummary(conflict.clinicalSummary?.text),source:conflict.clinicalSummary?.source};
                const next = {...editor,_revision:conflict.revision};
                for (const [key] of [...SUMMARY_FIELDS,['source']]) if (choices[key] === 'latest') next[key] = latest[key] || '';
                setEditor(next);setConflict(null);setError('');
              }}>确认摘要选择并继续编辑</button>
            </section>}
            <footer><button type="button" className="secondary" onClick={()=>{setEditor(null);setConflict(null);}}>取消</button><button type="submit" disabled={!!conflict || SUMMARY_FIELDS.some(([key])=>!editor[key].trim()) || !editor.source.trim()}>{busy ? '正在保存…' : '保存摘要'}</button></footer>
          </fieldset></form> : <>
        {concise ? <dl className="history-snapshot">{SUMMARY_FIELDS.map(([key,label])=><div key={key}><dt>{label}</dt><dd className="clinical-summary-text">{concise[key]}</dd></div>)}</dl>
          : summary?.text ? <><div className={`history-summary-copy${longSummary && !summaryExpanded ? ' is-collapsed' : ''}`}>{paragraphs(summary.text).map((paragraph,i)=><p key={i}>{paragraph}</p>)}</div>{longSummary && <button className="text-button history-expand" aria-expanded={summaryExpanded} onClick={()=>setSummaryExpanded(!summaryExpanded)}>{summaryExpanded ? '收起完整病史' : '展开完整病史'}</button>}</>
          : <p className="history-muted">尚无病史摘要</p>}
      </>}
    </section>
    <section className="history-section history-problems" aria-label="诊断列表">
      <header><h3>诊断{total > 0 && <small> · {total} 项</small>}</h3><button className="text-button" disabled={patient.archived} onClick={onEdit}>{total ? '编辑诊断' : '添加诊断记录'}</button></header>
      {(total > 5 || clinicalGroups.length > 1) && <div className="history-filters">
        {total > 5 && <label className="history-search"><Search size={16}/><input type="search" aria-label="搜索诊断与病史记录" placeholder="搜索诊断、编码或备注" value={query} onChange={e=>setQuery(e.target.value)}/></label>}
        {clinicalGroups.length > 1 && <select aria-label="诊断分类" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">全部诊断</option>{clinicalGroups.map(group=><option key={group.status} value={group.status}>{DIAGNOSIS_STATUS_LABELS[group.status]}</option>)}</select>}
        {(filter !== 'all' || query) && <button className="text-button" onClick={()=>{setFilter('all');setQuery('');}}>清除筛选</button>}
      </div>}
      {matches.length ? <ul className="history-diagnosis-list">{matches.flatMap(group=>group.items.map((diagnosis,i)=><DiagnosisRecord key={`${group.status}-${diagnosis.name}-${i}`} diagnosis={diagnosis} status={group.status} onSource={sourceLink}/>))}</ul>
        : <p className="history-muted">{total ? '没有符合条件的诊断记录' : diagnosisEmptyText}</p>}
    </section>
    {!!uncertain.length && <section className="history-section" aria-label="资料中的不确定记录"><header><h3>待核对记录 <small> · {uncertain.length} 项</small></h3></header><ul className="history-diagnosis-list">{uncertain.map((diagnosis,i)=><DiagnosisRecord key={i} diagnosis={diagnosis} status="needs_review" onSource={sourceLink} showStatus={false}/>)}</ul></section>}
    {!!findings.length && <section className="history-section" aria-label="检查发现"><header><h3>检查发现 <small> · {findings.length} 项</small></h3></header><ul className="history-diagnosis-list">{findings.map((diagnosis,i)=><DiagnosisRecord key={i} diagnosis={diagnosis} status="finding" onSource={sourceLink} showStatus={false}/>)}</ul></section>}
    {patient.note && <details className="history-record-notes"><summary>资料备注</summary><section aria-label="资料备注"><p className="clinical-summary-text">{patient.note}</p></section></details>}
  </div>;
}
