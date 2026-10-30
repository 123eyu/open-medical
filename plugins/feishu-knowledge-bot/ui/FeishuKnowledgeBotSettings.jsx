import { useEffect, useState } from 'react';
import { api } from '../../../src/agent-runtime';
import { FeishuBinding } from '../../../src/feishu-binding';

export function FeishuKnowledgeBotSettings() {
  const [config, setConfig] = useState(null), [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const accept = value => { setConfig(value); setForm({ ...value }); };
  useEffect(() => { let alive = true; api('/api/knowledge-bot').then(v => { if (alive) accept(v); }).catch(e => { if (alive) setError(e.message); }); return () => { alive = false; }; }, []);
  useEffect(() => {
    if (!config?.enabled && config?.feishuBinding?.status !== 'pending') return;
    let alive = true;
    const timer = setInterval(() => { api('/api/knowledge-bot').then(v => { if (alive) { if (!config.appId && v.appId) accept(v); else setConfig(v); } }).catch(() => {}); }, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [config?.enabled, config?.appId, config?.feishuBinding?.status]);
  async function action(fn) { setBusy(true); setError(''); setNotice(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  function toggle(key, value) { setForm(f => ({ ...f, [key]: f[key].includes(value) ? f[key].filter(v => v !== value) : [...f[key], value] })); }
  const states = { disabled: '未启用', connecting: '正在连接', connected: '已连接', reconnecting: '正在重连', failed: '连接失败' };
  return <section className="doctor-notifications" aria-label="飞书知识库机器人">
    <h2>飞书知识库机器人</h2>
    <p>在授权群里 @ 机器人，或在授权单聊里直接提问。从你开放的允许对外引用的资料中查找依据，支持连续追问，并附上资料出处。</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!form ? <button className="secondary" disabled={busy} onClick={() => action(async () => accept(await api('/api/knowledge-bot')))}>重新加载</button> : <>
      <div className="notification-channel">
      <h3>飞书连接 <span role="status" className={`om-chip ${config.state === 'connected' ? 'is-ok' : config.state === 'failed' ? 'is-danger' : config.state === 'disabled' ? '' : 'is-caution'}`}>{states[config.state] || config.state}</span></h3>
      {config.message && <p className="muted">{config.message}</p>}
      {!config.hasSecret ? <FeishuBinding endpoint="/api/knowledge-bot/feishu-binding" binding={config.feishuBinding} modelConsent={false} onUpdated={async () => accept(await api('/api/knowledge-bot'))} /> : <>
      <a className="chat-next-link" href={`https://applink.feishu.cn/client/bot/open?appId=${encodeURIComponent(config.appId)}`} target="_blank" rel="noreferrer">打开知识库机器人 ↗</a>
      </>}
      </div>
      {config.hasSecret && <>
      <p>选择允许分享的知识库并开启后，就可以在飞书提问。扫码账号会自动识别；群聊和其他账号需要你在下面授权。</p>
      <form onSubmit={e => { e.preventDefault(); action(async () => { accept(await api('/api/knowledge-bot', 'PUT', { ...form, expectedRevision: form.revision })); setNotice('设置已保存，可以打开飞书提问。'); }); }}>
        <fieldset disabled={busy} className="notification-fields">
          <h3>允许分享的知识库</h3><p>选中库中允许对外引用的资料的摘录会发送到授权群或单聊，之后加入该库并允许对外引用的资料也会参与检索。请选用适合在所选会话分享的内容；患者档案和病例库不参与检索。</p>
          {!config.availableCollections.length && <p>请先到「知识库」建立资料库、导入资料并设置对外引用范围。</p>}
          {config.availableCollections.map(c => <label className="notification-checkbox" key={c.name}><input type="checkbox" checked={form.collections.includes(c.name)} onChange={() => toggle('collections', c.name)} />{c.name} · {c.sharedCount} 篇允许对外引用 / {c.documentCount} 篇</label>)}
          {form.collections.filter(c => !config.availableCollections.some(v => v.name === c)).map(c => <label key={c}><input type="checkbox" checked onChange={() => toggle('collections', c)} />{c}（已不存在，请取消）</label>)}
          <h3>允许使用的群</h3><p>先把机器人加入飞书群并 @ 它一次，群就会出现在下面；勾选并保存后才开始回答。尚未授权时不会向群内发送消息。</p>
          {form.appId === config.appId && config.discoveredGroups.filter(g => g.chatType !== 'p2p').map((g, i) => <label className="notification-checkbox" key={g.id}><input type="checkbox" checked={form.groups.includes(g.id)} disabled={!g.name && !form.groups.includes(g.id)} onChange={() => toggle('groups', g.id)} /><span>{g.name || `待确认的群 ${i + 1}`}<small style={{ display: 'block' }}>发现于 {new Date(g.firstSeen).toLocaleString('zh-CN')}</small></span></label>)}
          {!config.discoveredGroups.some(g => g.chatType !== 'p2p') && <p className="muted">尚未发现群</p>}
          <h3>允许使用的单聊</h3><p>扫码账号可直接私聊。其他人发来消息后，可以按姓名授权；无法确认身份的会话请勿勾选。</p>
          {form.appId === config.appId && config.discoveredGroups.filter(g => g.chatType === 'p2p').map((g, i) => <label className="notification-checkbox" key={g.id}><input type="checkbox" checked={form.privateChats.includes(g.id)} disabled={!g.name && g.senderId !== config.boundUserId && !form.privateChats.includes(g.id)} onChange={() => toggle('privateChats', g.id)} /><span>{g.senderId === config.boundUserId ? '我的飞书账号' : g.name ? `${g.name} · 单聊` : `待确认的单聊 ${i + 1}`}<small style={{ display: 'block' }}>发现于 {new Date(g.firstSeen).toLocaleString('zh-CN')}</small></span></label>)}
          {!config.discoveredGroups.some(g => g.chatType === 'p2p') && <p className="muted">尚未发现单聊</p>}
          <h3>回答方式</h3>
          <label className="notification-checkbox"><input type="radio" name="answerMode" checked={form.answerMode === 'excerpts'} onChange={() => setForm({ ...form, answerMode: 'excerpts' })} />返回资料原文与出处</label>
          <label className="notification-checkbox"><input type="radio" name="answerMode" checked={form.answerMode === 'assistant'} onChange={() => setForm({ ...form, answerMode: 'assistant' })} />使用当前模型整理回答与连续追问</label>
          <p>{config.model ? `当前模型：${config.model.provider} · ${config.model.name}${config.model.local ? '（本地模型）' : ''}` : '尚未配置模型；资料原文检索仍可使用。'}</p>
          {form.answerMode === 'assistant' && <p>启用并保存后，问题、当前会话最近 4 轮上下文和命中的知识库片段会发送给当前配置的模型。可在「模型与运行」选择本地模型。</p>}
          <details><summary>连续追问与新话题</summary><p>群聊上下文按提问人及话题分开，单聊互不混用。上下文仅在本次运行中保留，30 分钟无新消息后过期；发送 /new 或「新话题」可重新开始。</p></details>
          <label className="notification-checkbox"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />启用飞书知识库机器人</label>
          <button type="submit" className="primary">保存使用范围</button>
        </fieldset>
      </form>
      <div className="settings-bot-actions"><button className="secondary" disabled={busy} onClick={() => action(async () => { accept(await api('/api/knowledge-bot')); setNotice('会话列表与设置已刷新。'); })}>刷新群与连接状态</button>
      <button className="secondary" disabled={busy} onClick={() => action(async () => { const result = await api("/api/knowledge-bot/reset-context", "POST", { expectedRevision: config.revision }); setNotice(result.message); })}>清空所有对话上下文</button>
      <button className="text-button danger" disabled={busy} onClick={() => { if (window.confirm('断开知识库机器人？已导入资料会保留。')) action(async () => accept(await api('/api/knowledge-bot', 'DELETE', { expectedRevision: config.revision }))); }}>断开连接</button>
</div>
    </>}
    </>}
  </section>;
}

export default FeishuKnowledgeBotSettings;
