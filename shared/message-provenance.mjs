// Keep sender identity and uncertainty alongside the original message text in
// every projection. Message direction alone does not identify the speaker.
export function messageProvenance(data = {}, direction) {
  return {
    speaker: data.speaker || (direction === "out" ? "doctor" : "unknown"),
    rawSpeaker: data.rawSpeaker || "",
    timeUnknown: data.timeUnknown === true,
    rawTime: data.rawTime || "",
    collectedAt: data.collectedAt || null,
  };
}
export function messageSpeakerLabel(message) {
  const speaker = messageProvenance(message, message.direction).speaker;
  return { patient: "患者本人", doctor: "医生侧", family: "家属代述", unknown: "身份待核对" }[speaker] || "身份待核对";
}
export function messageTimeLabel(message) {
  return message.timeUnknown
    ? `时间待核对（原文：${message.rawTime || "未提供"}；采集时间：${message.collectedAt || "未记录"}）`
    : message.time || "时间未记录";
}
export function messageChannelLabel(channel) {
  const labels = { manual: "手动录入", wechat: "微信", feishu: "飞书", "wecom-kf": "微信客服", "wecom-contact": "企业微信客户联系" };
  return Object.hasOwn(labels, channel) ? labels[channel] : channel || "渠道未记录";
}
