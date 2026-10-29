export function ModelConsent({ config, patient = false, checked, onChange, disabled = false }) {
  const local = config?.provider === 'local';
  return <label className="tb-check model-consent" title={local
    ? '使用本机模型分析；已启用的联网工具会向对应服务发送查询内容。'
    : `问题、所选资料${patient ? '和关联患者档案' : ''}会发送给设置中配置的模型服务进行分析${config?.model ? `（当前模型：${config.model}）` : ''}。`}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)}/>
    <span>{local ? '同意使用本机模型及联网工具' : `同意将问题、资料${patient ? '和患者档案' : ''}发送给已配置的 AI 服务`}</span>
  </label>;
}
