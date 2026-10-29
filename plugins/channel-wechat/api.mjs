import { AppError } from "../../server/errors.mjs";
import { wechatExpApi } from "./server/wechat-exp.mjs";

const REPLY = (send, status, value) => {
  send(status, value);
  return true;
};

const RETIRED_REASON = "请使用随访 → 聊天随访中的会话核验与读取";
const RETIRED_SEND = "旧微信桥接已停用。请在随访 → 聊天随访中核验并关联会话；发送请在微信中完成。";

// Legacy /api/wechat-exp/* and /api/wechat/* routes. Paths, status codes and
// bodies stay identical to the pre-plugin fixed shell.
export function createWechatApi(service) {
  return async function wechatApi(ctx, req, url, io) {
    const send = io.send;
    const body = io.body;
    const path = url.pathname;
    if (path.startsWith("/api/wechat-exp/"))
      return wechatExpApi(service.wechatExp, req, url, { body, send });
    if (path === "/api/wechat/status" && req.method === "GET")
      return REPLY(send, 200, {
        enabled: false,
        available: false,
        retired: true,
        reason: RETIRED_REASON,
      });
    if (
      ["/api/wechat/read", "/api/wechat/send"].includes(path) &&
      req.method === "POST"
    )
      throw new AppError("WECHAT_LEGACY_RETIRED", RETIRED_SEND, 410);
    return false;
  };
}

export const WECHAT_LEGACY_API_PATHS = [
  { method: "*", path: "/api/wechat-exp/*" },
  { method: "GET", path: "/api/wechat/status" },
  { method: "POST", path: "/api/wechat/read" },
  { method: "POST", path: "/api/wechat/send" },
];
