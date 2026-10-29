import { useState } from 'react';
import { api } from '../../../src/agent-runtime';
import { PluginSetup } from '../../../src/plugin-center';
const when = value => value ? new Date(value).toLocaleString() : '尚未同步';
export function SavedConnection({ initial, onSaved, wizard = false }) {
  const [saved, setSaved] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const accept = value => { setSaved(value); onSaved(value); };
  async function run(fn) { setBusy(true); setError(''); try { await fn(); } catch(e) { setError(e.message); } finally { setBusy(false); } }
  return <section className="chat-setup"><h3>{saved.plugin?.name || '企业微信连接'}</h3>
    {wizard && <PluginSetup entry={{ manifest: { ...saved.plugin } }} onDone={accept} />}
    {!wizard && !saved.hasToken && !saved.accountId && <p>此服务暂未提供快捷授权。你可以使用微信历史导入向导，或直接导入聊天文件整理随访。</p>}
    {(saved.hasToken || saved.accountId) && <>
      <p role="status">{saved.status?.message || (saved.enabled ? '已启用' : '已停用')}</p>
      <button disabled={busy} onClick={() => run(async () => { const status = await api(`/api/chat-followups/connections/${saved.channel}/test`, 'POST', {}); setSaved(v => ({ ...v, status })); })}>检查已有连接</button>
      <button disabled={busy} onClick={() => run(async () => accept(await api(`/api/chat-followups/connections/${saved.channel}${saved.enabled ? '' : '/connect'}`, 'POST', { ...saved, enabled: !saved.enabled, autoUntil: '', autoSummarize: false })))}>{saved.enabled ? '停用连接' : '启用已有连接'}</button>
      {saved.enabled && <><a href="/?view=followups&followupTab=chat">选择患者会话 →</a><AutomaticSettings key={saved.revision} initial={saved} onSaved={accept} /></>}
    </>}
    {error && <p role="alert">{error}</p>}<p className="muted">最近同步：{when(saved.lastSyncAt)}</p>
  </section>;
}
// 企微智能机器人:连接管理之外还有两层授权与群管理。
// 自动起草(单聊)只进审核队列;群聊自动回复是更进一步的独立授权,逐群开启,
// 可自动发送(红旗安全话术直发,普通回复须过出站筛查,限频,全程留痕)。
export function ServiceConnectionForm(props) { return <SavedConnection {...props} wizard={props.initial.plugin?.id === 'wechat-exp'} />; }
export function AutomaticSettings({initial,onSaved}) {
 const [form,setForm]=useState({...initial}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[automatic,setAutomatic]=useState(Boolean(initial.autoUntil&&Date.parse(initial.autoUntil)>Date.now())),[consent,setConsent]=useState(false);
 const update=(key,value)=>{setForm(v=>({...v,[key]:value}));setNotice('');};
 const action=async fn=>{setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}};
 return <form className="chat-connection-form" onSubmit={e=>{e.preventDefault();action(async()=>{const value=await api(`/api/chat-followups/connections/${form.channel}`,'POST',{...form,autoBindingId:form.autoWatch==='all'?'__all__':form.autoBindingId,autoUntil:automatic?form.autoUntil:'',automaticConsent:consent,modelConsent:form.modelConsent===true});onSaved(value);});}}>
  <details><summary>自动同步</summary><p>{form.channel==='wechat'?(form.autoWatch==='all'?'每到间隔自动监听会话列表：发现已关联会话有新消息（列表行内容变化）才定位进入读取，单轮最多读取 8 个会话；期间微信窗口会被周期性操作，请保持微信登录且窗口可见。':'定时读取一个已校准会话：应用按备注名自动定位并核验头像后读取，期间微信需保持登录且窗口可见；定位或核验失败时自动停止，不会自动搜索联系人。'):'同步已关联会话，保存原文并生成待复核草稿。'}默认只采集原文；可单独授权模型自动整理。工作台退出后停止运行。</p>
   <label className="chat-check"><input type="checkbox" checked={automatic} onChange={e=>{setAutomatic(e.target.checked);setConsent(false);}}/>在有限时段内自动同步</label>
   {automatic&&<>{form.channel==='wechat'&&<label>定时读取的会话<select required value={form.autoWatch==='all'?'__all__':(form.autoBindingId||'')} onChange={e=>{const all=e.target.value==='__all__';update('autoBindingId',all?'__all__':e.target.value);update('autoWatch',all?'all':'');setConsent(false);}}><option value="">请选择</option><option value="__all__">全部已关联会话（监听会话列表）</option>{(initial.availableBindings||[]).map(b=><option key={b.id} value={b.id}>{b.patientName} · {b.title}</option>)}</select></label>}<label className="chat-check"><input type="checkbox" checked={Boolean(form.autoSummarize)} onChange={e=>{update('autoSummarize',e.target.checked);update('modelConsent',false);}}/>自动调用当前模型整理新增草稿</label>{form.autoSummarize&&<label className="chat-check"><input type="checkbox" required checked={Boolean(form.modelConsent)} onChange={e=>update('modelConsent',e.target.checked)}/>允许在此时段内将新增草稿原文发送给当前模型服务；更换模型后重新授权</label>}<label>间隔（分钟）<input type="number" min="5" max="1440" value={form.intervalMinutes} onChange={e=>update('intervalMinutes',Number(e.target.value))}/></label><label>截止时间（最长 24 小时）<input type="datetime-local" required value={form.autoUntil?(()=>{const d=new Date(form.autoUntil);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16);})():''} onChange={e=>update('autoUntil',e.target.value?new Date(e.target.value).toISOString():'')}/></label><label className="chat-check"><input required type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>我确认在此时段内读取此账号已关联的会话{form.channel==='wechat'?(form.autoWatch==='all'?'中的全部会话，并允许显示与操作微信窗口':'中的上述会话，并允许显示微信窗口'):''}</label></>}
  </details>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <button disabled={busy} type="submit">保存自动同步设置</button>
  {initial.autoUntil&&Date.parse(initial.autoUntil)>Date.now()&&<button disabled={busy} type="button" onClick={()=>action(async()=>onSaved(await api(`/api/chat-followups/connections/${form.channel}`,'POST',{...initial,autoUntil:'',autoSummarize:false})))}>停止自动同步</button>}
 </form>;
}
