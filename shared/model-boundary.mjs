export function modelBoundary(provider, configured) {
  if (!configured) return '材料保存在本机，尚未交给模型处理。';
  return provider === 'local'
    ? '选中内容由本机模型处理；已启用的联网工具仍可能请求外部服务。'
    : '选中内容会按本轮授权交给当前模型服务处理；已启用的联网工具也可能请求外部服务。';
}
export function testSummary(record) {
  if (!record?.checkedAt) return '本次启动尚未测试此连接。';
  const label = { passed: '本次测试通过', partial: '文本通过，部分能力受限', failed: '最近测试失败', cancelled: '最近测试已取消' }[record.status] || '尚未测试';
  return `${label} · ${new Date(record.checkedAt).toLocaleString('zh-CN')}`;
}
