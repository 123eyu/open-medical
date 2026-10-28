const providers = { deepseek: 'DeepSeek', openai: 'OpenAI', anthropic: 'Anthropic', ollama: '本机模型' };

export function ModelConsent({ config, patient = false, checked, onChange, disabled = false }) {
  const local = config?.provider === 'local';
  const destination = providers[config?.provider] || config?.model || '已配置的模型服务';
  return <label className="tb-check model-consent" title={local
    ? '使用本机模型分析；已启用的联网工具会向对应服务发送查询内容。'
    : `问题、所选资料${patient ? '和关联患者档案' : ''}会发送给设置中配置的模型服务进行分析。`}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)}/>
    <span>{local ? '同意使用本机模型及联网工具' : `同意将问题、资料${patient ? '和患者档案' : ''}发送给 ${destination}`}</span>
  </label>;
}
