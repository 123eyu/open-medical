// 咨询问答在本地规则模式下的降级回答：内置指标速查 + 模式引导，而不是工作流草稿。
export const consultationNotice = (result) => {
  const entries = (result?.entries || []).slice(0, 4);
  return [
    "这是一条咨询提问。当前为本地规则模式（不调用模型），只能给出内置检验指标速查，无法针对具体情况解答：",
    ...entries.map(
      (e) =>
        `· ${e.name}（参考范围 ${e.ref} ${e.unit}）升高：${e.high}；降低：${e.low}`,
    ),
    ...(entries.length ? [] : ["内置速查未覆盖这个问题。"]),
    "配置模型密钥并把运行方式切换为「智能模式」后重新发送，即可获得针对具体情况的解答。出现胸痛、呼吸困难、意识改变等急症表现时，请立即就医。",
    result?.note || "",
  ]
    .filter(Boolean)
    .join("\n");
};
