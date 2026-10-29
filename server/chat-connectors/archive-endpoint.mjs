import { AppError, check } from "../errors.mjs";

// Shared URL validation for local collector/wx-cli endpoints. The WeCom
// archive client itself lives in the channel-wecom plugin, but the generic
// endpoint rule is also used by the fixed chat-followup shell.
export function collectorUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("CHAT_CONFIG", "请填写采集器地址");
  }
  check(
    !url.username && !url.password && !url.search && !url.hash,
    "CHAT_CONFIG",
    "采集器地址不能包含密码、查询参数或片段",
  );
  check(
    url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)),
    "CHAT_CONFIG",
    "远程采集器必须使用 HTTPS，本机可使用回环 HTTP",
  );
  return url.href.replace(/\/$/, "");
}
