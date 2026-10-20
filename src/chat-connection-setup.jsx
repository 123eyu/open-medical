import { MacPermissionHelp } from './mac-permission-help';
import { PluginSetup } from './plugin-center';
import { useEffect, useState } from 'react';
import { api } from './agent-runtime';
const when = value => value ? new Date(value).toLocaleString() : '尚未同步';
export function ConnectionForm(props) {
  return props.initial.channel === 'wechat' ? <WechatConnection {...props} /> : <SavedConnection {...props} />;
}
function WechatConnection({ initial, onSaved }) {
  const [saved, setSaved] = useState(initial), [account, setAccount] = useState(initial.accountId || ''), [confirmed, setConfirmed] = useState(false), [status, setStatus] = useState(initial.status), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const accept = value => { setSaved(value); setStatus(value.status); onSaved(value); };
  async function run(fn) { setBusy(true); setError(''); try { await fn(); } catch(e) { setError(e.message); } finally { setBusy(false); } }
  const check = () => run(async () => setStatus(await api('/api/chat-followups/connections/wechat/test', 'POST', {})));
  useEffect(() => { check(); }, []);
  return <section className="chat-setup"><h3>本机微信</h3><p>在微信桌面版扫码登录后，工作台可以读取你授权的患者会话。</p>
    <p role="status">{status?.message || '正在检查微信…'}</p>
    <button disabled={busy} onClick={check}>检查微信与权限</button>
    {status && !status.ready && (saved.platform === 'darwin' || !saved.platform) && <MacPermissionHelp onRecheck={check} busy={busy} />}
    {status && !status.ready && saved.platform === 'win32' && <section aria-label="恢复 Windows 微信读取"><p>请打开并登录微信，允许本机读取窗口。</p><button disabled={busy} onClick={check}>重新检测</button></section>}
    {!saved.enabled && status?.ready && <form onSubmit={e => { e.preventDefault(); run(async () => accept(await api('/api/chat-followups/connections/wechat/connect', 'POST', { ...saved, accountId: account, revision: saved.revision, accountConfirmed: confirmed }))); }}>
      <p>微信不提供登录身份读取。请核对本次登录账号，避免将不同账号的患者会话混在一起。</p>
      <label>当前登录的微信号<input required value={account} maxLength={200} onChange={e => { setAccount(e.target.value); setConfirmed(false); }} /></label>
      <label><input required type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />已核对是我当前登录的账号</label>
      <button disabled={busy || !confirmed}>连接此账号</button>
    </form>}
    {saved.enabled && <><p>已连接账号：{saved.accountId}</p><a href="/?view=followups&followupTab=chat">选择患者会话 →</a><button disabled={busy} onClick={() => run(async () => { accept(await api('/api/chat-followups/connections/wechat', 'POST', { ...saved, enabled: false, autoUntil: '', autoSummarize: false })); setConfirmed(false); })}>断开账号</button><AutomaticSettings key={saved.revision} initial={saved} onSaved={value => { accept(value); setNotice(value.autoUntil ? '自动同步设置已保存' : '自动同步已停止'); }} /></>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}<p className="muted">最近同步：{when(saved.lastSyncAt)}</p>
  </section>;
}
function SavedConnection({ initial, onSaved, wizard = false }) {
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
export function AibotConnectionForm(props) {
  const [saved, setSaved] = useState(props.initial);
  const accept = value => { setSaved(value); props.onSaved?.(value); };
  return <>
    <SavedConnection {...props} onSaved={accept} key={`conn:${saved.revision}`} />
    {saved.enabled && <AibotReplySettings key={`reply:${saved.revision}`} initial={saved} onSaved={accept} />}
    {saved.enabled && <AibotGroups key={`groups:${saved.revision}`} authorized={Boolean(saved.groupAutoReply)} />}
  </>;
}
function AibotReplySettings({ initial, onSaved }) {
  const [autoReply, setAutoReply] = useState(Boolean(initial.autoReply)), [groupAutoReply, setGroupAutoReply] = useState(Boolean(initial.groupAutoReply)), [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const update = (key, value) => { if (key === 'autoReply') setAutoReply(value); else setGroupAutoReply(value); setConsent(false); setError(''); };
  return <form className="chat-setup" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { onSaved(await api('/api/chat-followups/connections/wecom-aibot', 'POST', { ...initial, autoReply, autoReplyConsent: consent, groupAutoReply, groupAutoReplyConsent: consent })); } catch (err) { setError(err.message); } finally { setBusy(false); } }}>
    <h4>自动回复授权</h4>
    <label className="chat-check"><input type="checkbox" checked={autoReply} onChange={e => update('autoReply', e.target.checked)} />自动起草回复（患者单聊）：新消息自动生成回复草稿，只进待审核队列，不会自动发送</label>
    <label className="chat-check"><input type="checkbox" checked={groupAutoReply} onChange={e => update('groupAutoReply', e.target.checked)} />群聊自动回复：在下方为具体群开启后，群里 @ 机器人的消息可自动回复（红旗症状自动回固定安全话术；普通回复先过安全筛查，未过筛或超过每群限频的转人工审核）</label>
    {(autoReply || groupAutoReply) && <label className="chat-check"><input required type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />我知道自动起草/回复会把会话内容发送给当前配置的模型服务</label>}
    {error && <p role="alert">{error}</p>}
    <button disabled={busy} type="submit">{busy ? '保存中…' : '保存授权'}</button>
  </form>;
}
// 群聊自动回复管理:逐群配置开关、是否自动发送、知识库范围、技能与限频;
// 最近活动里对待审核条目可修改后发送或不回复。
function AibotGroups({ authorized }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [editing, setEditing] = useState(null);
  const load = () => { api('/api/chat-aibot/groups').then(v => { setData(v); setError(''); }).catch(e => setError(e.message)); };
  useEffect(() => { load(); }, []);
  const act = async fn => { try { await fn(); load(); } catch (e) { setError(e.message); load(); } };
  return <section className="chat-setup" aria-label="群聊自动回复管理">
    <h4>群聊自动回复</h4>
    {!authorized && <p className="muted">先在上方的「群聊自动回复」授权中勾选同意,再在这里逐群开启。</p>}
    {authorized && <>
      <p className="muted">群里 @ 机器人后,该群开启自动回复即生效:红旗症状立即自动回安全话术;其余按本群选择的知识库与技能起草回复。关闭「自动发送」时回复只进下方待审核列表;发送时自动附 AI 助手说明。</p>
      {error && <p role="alert">{error}</p>}
      {!data && <p role="status">正在读取群配置…</p>}
      {data && <>
        {!!data.groups.length && <div className="chat-bindings">{data.groups.map(g => <GroupCard key={g.conversationId} group={g} live={data.live} act={act} onEdit={() => setEditing(g)} />)}</div>}
        <details open={!data.groups.length}><summary>添加群（机器人收到过消息的群会出现在这里）</summary>
          {!data.available.length && <p className="muted">还没有可见的群。在群里 @ 一次机器人后回来刷新即可。</p>}
          <div className="chat-name-suggestions">{data.available.map(c => <button key={c.conversationId} type="button" onClick={() => setEditing({ conversationId: c.conversationId, title: c.title || '' })}>{c.title || c.conversationId}</button>)}</div>
          <AddByRoomId onAdd={setEditing} />
        </details>
        {editing && <GroupForm draft={editing} skills={data.skills} collections={data.collections} onClose={() => setEditing(null)} act={act} />}
        <h4>最近活动与待审核</h4>
        {!data.recent.length && <p className="muted">暂无记录。群里的提问与机器人回复都会留痕在这里。</p>}
        {data.recent.map(r => <GroupReplyRow key={`${r.id}:${r.revision}`} row={r} act={act} />)}
      </>}
    </>}
  </section>;
}
function AddByRoomId({ onAdd }) {
  const [value, setValue] = useState('');
  return <form className="toolbar-actions" onSubmit={e => { e.preventDefault(); if (value.trim().startsWith('room:')) { onAdd({ conversationId: value.trim(), title: '' }); setValue(''); } }}>群 ID 不在列表时手动填入：<input value={value} onChange={e => setValue(e.target.value)} placeholder="room:开头的群会话 ID" maxLength={300} /><button disabled={!value.trim().startsWith('room:')}>填入配置</button></form>;
}
function GroupForm({ draft, skills, collections, onClose, act }) {
  const [form, setForm] = useState({ title: draft.title || '', enabled: draft.enabled === true, autoSend: draft.autoSend === true, kbCollection: draft.kbCollection || '', skillIds: Array.isArray(draft.skillIds) ? draft.skillIds : [], maxPerHour: draft.maxPerHour || 6, confirmed: false });
  const toggleSkill = id => setForm(v => ({ ...v, skillIds: v.skillIds.includes(id) ? v.skillIds.filter(s => s !== id) : v.skillIds.length >= 3 ? v.skillIds : [...v.skillIds, id], confirmed: false }));
  const update = (key, value) => setForm(v => ({ ...v, [key]: value, confirmed: false }));
  return <form className="chat-binding-form" onSubmit={e => { e.preventDefault(); act(async () => { await api('/api/chat-aibot/groups', 'POST', { ...form, conversationId: draft.conversationId, maxPerHour: Number(form.maxPerHour), confirmed: true }); onClose(); }); }}>
    <h3>配置群：{draft.conversationId}</h3>
    <div className="chat-form-grid">
      <label>群名称<input value={form.title} maxLength={150} onChange={e => update('title', e.target.value)} placeholder="方便辨认的名字,如「3 床家属群」" /></label>
      <label>每群每小时最多回复<input type="number" min="1" max="60" value={form.maxPerHour} onChange={e => update('maxPerHour', e.target.value)} /></label>
      <label>知识库范围<select aria-label="知识库范围" value={form.kbCollection} onChange={e => update('kbCollection', e.target.value)}><option value="">全部知识库（默认）</option>{(collections || []).map(name => <option key={name} value={name}>{name}</option>)}</select></label>
    </div>
    <label className="chat-check"><input type="checkbox" checked={form.enabled} onChange={e => update('enabled', e.target.checked)} />开启此群的自动回复</label>
    <label className="chat-check"><input type="checkbox" checked={form.autoSend} onChange={e => update('autoSend', e.target.checked)} />自动发送（不勾选则只生成回复草稿,由你逐条审核发送）</label>
    {form.autoSend && <p className="muted">自动发送仍有两道保险:红旗症状固定回安全话术;普通回复须通过出站安全筛查(剂量/用药调整/诊断结论/处方/超长),未通过自动转人工审核。</p>}
    {!!skills.length && <fieldset><legend>回答参考技能（最多 3 个,只作为回答思路,不改变安全规则）</legend><div className="chat-name-suggestions">{skills.map(s => <button key={s.id} type="button" aria-pressed={form.skillIds.includes(s.id)} onClick={() => toggleSkill(s.id)}>{s.title || s.name}</button>)}</div></fieldset>}
    <label className="chat-check"><input required type="checkbox" checked={form.confirmed} onChange={e => setForm(v => ({ ...v, confirmed: e.target.checked }))} />我已核对该群配置,同意按上述设置自动回复</label>
    <div className="toolbar-actions">
      <button type="submit" disabled={!form.confirmed}>保存群配置</button>
      {draft.enabled !== undefined && <button type="button" onClick={() => { if (window.confirm(`删除「${form.title || draft.conversationId}」的自动回复配置?留痕记录保留。`)) act(async () => { await api(`/api/chat-aibot/groups/${encodeURIComponent(draft.conversationId)}`, 'DELETE'); onClose(); }); }}>删除配置</button>}
      <button type="button" onClick={onClose}>取消</button>
    </div>
  </form>;
}
function GroupCard({ group, live, act, onEdit }) {
  return <article><div><strong>{group.title}</strong><p>{group.enabled ? `自动回复已开启${group.autoSend ? ' · 自动发送' : ' · 仅草稿待审核'}` : '已关闭'} · 每小时≤{group.maxPerHour}条{group.kbCollection ? ` · 知识库:${group.kbCollection}` : ''}{group.skillIds?.length ? ` · 技能 ${group.skillIds.length} 个` : ''}{live ? '' : ' · 长连接离线,发送会转待审核'}</p></div><div className="toolbar-actions"><button onClick={onEdit}>修改</button><button onClick={() => { if (window.confirm(`删除「${group.title}」的自动回复配置?`)) act(() => api(`/api/chat-aibot/groups/${encodeURIComponent(group.conversationId)}`, 'DELETE')); }}>删除</button></div></article>;
}
function GroupReplyRow({ row, act }) {
  const [text, setText] = useState(row.text), [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = row.status === 'draft';
  const label = { auto_sent: '已自动发送', sent: '已发送', dismissed: '不回复', draft: row.sendError ? `发送失败,待人工重发(${row.sendError})` : '待审核' }[row.status] || row.status;
  if (!pending) return <p className="muted">[{row.title || row.conversation}] {label} · {when(row.sentAt || row.createdAt)} · {row.mode === 'safety' ? '⚠ 红旗安全话术' : `问:${row.question}`} · 答:{row.text}</p>;
  return <div className="chat-draft" style={{ borderLeft: row.urgent ? '3px solid #b91c1c' : undefined }}>
    <p><strong>[{row.title || row.conversation}]</strong> {row.urgent ? '⚠ 红旗症状' : `问:${row.question}`}{row.screen?.reasons?.length ? ` · 送审提示:${row.screen.reasons.join('、')}` : ''}</p>
    <label>回复内容<textarea rows={3} maxLength={2000} aria-label="回复内容" value={text} onChange={e => { setText(e.target.value); setConsent(false); }} /></label>
    <p className="muted">发送到群里,自动附 AI 助手说明;优先原路回复,失败自动回退主动推送。</p>
    {error && <p role="alert">{error}</p>}
    <div className="toolbar-actions">
      <label className="chat-check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />我已核对本条回复内容</label>
      <button disabled={busy || !consent || !text.trim()} onClick={() => { setBusy(true); setError(''); act(async () => { await api(`/api/chat-aibot/group-replies/${row.id}/send`, 'POST', { text, consent: true }); }).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>{busy ? '正在发送…' : '通过并发送'}</button>
      <button disabled={busy} onClick={() => { if (window.confirm('确认不回复这条消息?')) { setBusy(true); act(() => api(`/api/chat-aibot/group-replies/${row.id}/dismiss`, 'POST', { confirmed: true })).catch(e => setError(e.message)).finally(() => setBusy(false)); } }}>不回复</button>
    </div>
  </div>;
}
export function ServiceConnectionForm(props) { return <SavedConnection {...props} wizard={props.initial.plugin?.id === 'wechat-exp'} />; }

function AutomaticSettings({initial,onSaved}) {
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
