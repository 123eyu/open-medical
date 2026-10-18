import { setTimeout as delay } from "node:timers/promises";
import { AppError } from "../errors.mjs";

// timeoutMs 约束的是“连续无数据”的时长（首字节前、流式片段之间），
// 不是整段输出：长推理和长工具参数只要还在持续输出就不会被掐断。
export function idleSignal(signal, ms) {
  const controller = new AbortController();
  let timer;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(new DOMException("模型连续无响应超时", "TimeoutError")),
      ms,
    );
    timer.unref?.();
  };
  touch();
  return {
    signal: AbortSignal.any([...(signal ? [signal] : []), controller.signal]),
    touch,
    clear: () => clearTimeout(timer),
  };
}

// Load the public dispatcher only after a native fetch has failed. Its lifetime
// belongs to this request, not the process-wide pool used by unrelated clients.
async function createRecoveryDispatcher() {
  // A direct Agent must not bypass a deployment's configured proxy. Explicit
  // dispatchers stay with the caller. Proxy environment hints conservatively
  // keep the original route until a routing-aware recovery factory is supplied.
  if (["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "NODE_USE_ENV_PROXY"]
    .some((name) => process.env[name])) return null;
  const { Agent } = await import("undici");
  return new Agent({ allowH2: true, connect: { rejectUnauthorized: true } });
}

function closeRecoveryDispatcher(dispatcher, signal) {
  const destroy = () => {
    try { void Promise.resolve(dispatcher.destroy()).catch(() => {}); } catch { /* disposal is best effort */ }
  };
  if (signal?.aborted) { destroy(); return; }
  signal?.addEventListener("abort", destroy, { once: true });
  // close drains the active response. Awaiting it here would deadlock a large
  // stream whose caller has not received the Response yet.
  void Promise.resolve().then(() => dispatcher.close()).catch(destroy)
    .finally(() => signal?.removeEventListener("abort", destroy));
}

// Retry only before a response stream is handed to the caller. Never replay a
// partially consumed model stream or a tool side effect.
export async function requestProvider(fetchImpl, url, init, onStatus = () => {}, sleep = delay, recoveryFactory = createRecoveryDispatcher) {
  let recoveryDispatcher, recoveryAttempted = false;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      init.signal?.throwIfAborted();
      let response;
      try { response = await fetchImpl(url, recoveryDispatcher ? { ...init, dispatcher: recoveryDispatcher } : init); }
      catch (error) {
        init.signal?.throwIfAborted();
        if (!(error instanceof TypeError) && !["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN"].includes(error.code)) throw error;
        if (attempt === 2 || error.name === "AbortError")
          throw new AppError("PROVIDER_NETWORK", "模型连接失败，有限重试后仍不可用；检查点已保留", 502);
        // A poisoned HTTP/2 connection can fail every retry immediately. Recover
        // once using a request-owned connection; never override an explicitly
        // supplied dispatcher (which may carry a caller's proxy/TLS policy).
        if (!recoveryAttempted && !init.dispatcher &&
            (error.cause?.code ?? error.code) === "ERR_SSL_SSL/TLS_ALERT_BAD_RECORD_MAC") {
          recoveryAttempted = true;
          recoveryDispatcher = await recoveryFactory();
          init.signal?.throwIfAborted();
        }
        onStatus({ status: "retrying", attempt: attempt + 1, reason: "network" });
        await sleep(300 * 2 ** attempt, undefined, { signal: init.signal });
        continue;
      }
      if (![429, 500, 502, 503, 504, 529].includes(response.status) || attempt === 2) return response;
      const header = response.headers.get("retry-after");
      const requested = header === null ? NaN : /^\d+(\.\d+)?$/.test(header)
        ? Number(header) * 1000 : Date.parse(header) - Date.now();
      const waitMs = Math.min(5000, Math.max(250, Number.isFinite(requested) ? requested : 300 * 2 ** attempt));
      // An errored error-response body may reject cancellation after a socket
      // failure; disposing it must not prevent the bounded pre-stream retry.
      try { await response.body?.cancel(); } catch { /* best-effort disposal */ }
      init.signal?.throwIfAborted();
      onStatus({ status: "retrying", attempt: attempt + 1, reason: "http", httpStatus: response.status });
      await sleep(waitMs, undefined, { signal: init.signal });
    }
  } finally {
    if (recoveryDispatcher) closeRecoveryDispatcher(recoveryDispatcher, init.signal);
  }
}
