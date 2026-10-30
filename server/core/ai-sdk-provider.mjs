import { contextBudget, assertContextBudget } from "./context-budget.mjs";
import { idleSignal, requestProvider } from "./provider-request.mjs";
import { providerConfigured } from "./provider-status.mjs";
import { AppError, check } from "../errors.mjs";

export const MAX_STREAM_TOOL_CALLS = 128;
export const MAX_TOOL_ARGUMENT_CHARS = 200_000;

// AI SDK 只负责协议适配：直接调用各厂商 LanguageModel 的 doStream()，
// 不经过 streamText，因此没有 SDK 层的重试、工具参数校验或多步循环；
// 工具执行、审批、截断续写仍由 agent-runtime 负责。
// 配置解析与校验在 providers.mjs 的各厂商子类构造函数里完成。

const THINK_BUDGET = 4096;
const CHAT_KINDS = new Set(["deepseek", "openai", "local"]);

function parseToolInput(raw) {
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch {}
  return { invalid_json_arguments: raw };
}

function parseable(raw) {
  if (!raw?.trim()) return false;
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part) => (typeof part === "string" ? part : part?.text ?? ""))
      .join("");
  return content == null ? "" : JSON.stringify(content);
}

function userParts(content) {
  if (!Array.isArray(content)) return [{ type: "text", text: textOf(content) }];
  return content.map((part) => {
    if (part?.type === "input_text" || part?.type === "text")
      return { type: "text", text: part.text ?? "" };
    if (part?.type === "input_image" || part?.type === "image_url") {
      const url = String(
        typeof part.image_url === "string" ? part.image_url : part.image_url?.url ?? "",
      );
      const match = url.match(/^data:([^;]+);base64,(.*)$/s);
      if (match)
        return { type: "file", mediaType: match[1], data: { type: "data", data: match[2] } };
      if (/^https?:/i.test(url))
        return { type: "file", mediaType: "image", data: { type: "url", url: new URL(url) } };
      return { type: "text", text: "[图片无法解码，已跳过]" };
    }
    return { type: "text", text: textOf([part]) };
  });
}

// 旧检查点与新一轮输出都以原始 Responses 输出项保存在 responseItems，
// 回放时按项转换，加密推理内容随 itemId 原样带回（store:false）。
function responseItemParts(items) {
  const parts = [];
  for (const item of items) {
    if (item?.type === "reasoning") {
      const options = { openai: { itemId: item.id, reasoningEncryptedContent: item.encrypted_content ?? null } };
      const summary = (item.summary || []).filter((s) => s?.text);
      if (!summary.length) parts.push({ type: "reasoning", text: "", providerOptions: options });
      for (const s of summary) parts.push({ type: "reasoning", text: s.text, providerOptions: options });
    } else if (item?.type === "message") {
      const text = (item.content || [])
        .map((c) => (c.type === "output_text" ? c.text : c.type === "refusal" ? c.refusal : ""))
        .join("");
      if (text) parts.push({ type: "text", text });
    } else if (item?.type === "function_call") {
      parts.push({
        type: "tool-call",
        toolCallId: item.call_id,
        toolName: item.name,
        input: parseToolInput(item.arguments),
        ...(item.id ? { providerOptions: { openai: { itemId: item.id } } } : {}),
      });
    }
  }
  return parts;
}

export function toPrompt(messages, { kind, thinking, promptCache = false }) {
  const prompt = [];
  const toolNames = new Map();
  const systemTexts = [];
  for (const message of messages) {
    if (["system", "developer"].includes(message.role)) {
      // Claude 只接受一段前置系统提示，合并后放到最前。
      if (kind === "anthropic") systemTexts.push(textOf(message.content));
      else prompt.push({ role: "system", content: textOf(message.content) });
      continue;
    }
    if (message.role === "tool") {
      const output =
        typeof message.content === "string"
          ? { type: "text", value: message.content }
          : { type: "json", value: message.content ?? null };
      prompt.push({
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: message.tool_call_id,
          toolName: toolNames.get(message.tool_call_id) || "tool",
          output,
        }],
      });
      continue;
    }
    if (message.role !== "assistant") {
      prompt.push({ role: "user", content: userParts(message.content) });
      continue;
    }
    for (const call of message.tool_calls || []) toolNames.set(call.id, call.function?.name);
    if (kind === "openai-responses" && Array.isArray(message.responseItems)) {
      for (const item of message.responseItems)
        if (item?.type === "function_call") toolNames.set(item.call_id, item.name);
      prompt.push({ role: "assistant", content: responseItemParts(message.responseItems) });
      continue;
    }
    const content = [];
    if (kind === "anthropic" && thinking === "enabled" && Array.isArray(message.thinkingBlocks))
      for (const block of message.thinkingBlocks)
        content.push(
          block.type === "redacted_thinking"
            ? { type: "reasoning", text: "", providerOptions: { anthropic: { redactedData: block.data } } }
            : { type: "reasoning", text: block.thinking || "", providerOptions: { anthropic: { signature: block.signature } } },
        );
    if (CHAT_KINDS.has(kind) && message.reasoning_content)
      content.push({ type: "reasoning", text: message.reasoning_content });
    const text = textOf(message.content);
    if (text) content.push({ type: "text", text });
    for (const call of message.tool_calls || [])
      content.push({
        type: "tool-call",
        toolCallId: call.id,
        toolName: call.function.name,
        // 上一轮的坏 JSON 参数原样保留，模型能看到原文并修正。
        input: parseToolInput(call.function.arguments),
      });
    if (!content.length) content.push({ type: "text", text: "" });
    prompt.push({ role: "assistant", content });
  }
  // 缓存前缀顺序为 tools → system → messages；断点只放在工具与系统提示末尾，
  // 对话开头的运行时观测每轮会变，断点放后面只会反复写缓存。
  if (systemTexts.length)
    prompt.unshift({
      role: "system",
      content: systemTexts.join("\n\n"),
      ...(promptCache ? { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } } : {}),
    });
  return prompt;
}

function toolsFor(tools, { kind, promptCache }) {
  if (!tools?.length) return undefined;
  return tools.map(({ function: f }, index) => ({
    type: "function",
    name: f.name,
    description: f.description,
    inputSchema: f.parameters ?? { type: "object", properties: {} },
    ...(kind === "openai-responses" ? { strict: false } : {}),
    ...(kind === "anthropic" && promptCache && index === tools.length - 1
      ? { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }
      : {}),
  }));
}

function mergeSignature(block, metadata) {
  const anthropic = metadata?.anthropic;
  if (anthropic?.signature) block.signature = (block.signature || "") + anthropic.signature;
  if (anthropic?.redactedData) block.redactedData = anthropic.redactedData;
  const openai = metadata?.openai;
  if (openai?.itemId) block.itemId = openai.itemId;
  if (openai?.reasoningEncryptedContent) block.encrypted = openai.reasoningEncryptedContent;
}

class StreamFailure extends Error {
  constructor(cause) {
    super("model stream error");
    this.cause = cause;
  }
}

export class AiSdkProvider {
  // 厂商包按需加载，只加载实际用到的那一家。
  async languageModel(model, fetchImpl, { thinking }) {
    const common = { apiKey: this.apiKey || undefined, fetch: fetchImpl };
    if (this.provider === "anthropic") {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      return createAnthropic({ ...common, apiKey: this.apiKey, baseURL: `${this.baseUrl}/v1` })(model);
    }
    if (this.provider === "openai-responses") {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI({ ...common, baseURL: this.baseUrl }).responses(model);
    }
    if (this.provider === "deepseek") {
      const { createDeepSeek } = await import("@ai-sdk/deepseek");
      return createDeepSeek({ ...common, baseURL: this.baseUrl })(model);
    }
    const local = this.provider === "local";
    const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
    return createOpenAICompatible({
      ...common,
      name: local ? "local" : "openai",
      baseURL: this.baseUrl,
      includeUsage: true,
      // 本地 Ollama 用 reasoning_effort 开关思考，不发送 DeepSeek 专有的 thinking 字段。
      transformRequestBody: local
        ? (body) => ({ ...body, reasoning_effort: thinking === "enabled" ? "high" : "none" })
        : undefined,
    })(model);
  }

  providerOptions(thinking) {
    if (this.provider === "anthropic")
      return {
        anthropic: {
          thinking: thinking === "enabled"
            ? { type: "enabled", budgetTokens: THINK_BUDGET }
            : { type: "disabled" },
        },
      };
    if (this.provider === "deepseek") return { deepseek: { thinking: { type: thinking } } };
    if (this.provider === "openai-responses")
      return {
        openai: {
          store: false,
          include: ["reasoning.encrypted_content"],
          // SDK 按模型名猜测是否为推理模型；网关或自定义模型名猜不中，
          // 用户显式配置了推理强度就照发。
          ...(this.reasoningEffort ? { reasoningEffort: this.reasoningEffort, forceReasoning: true } : {}),
        },
      };
    return undefined;
  }

  async complete(
    messages,
    tools,
    {
      signal,
      onDelta = () => {},
      onStatus = () => {},
      model = this.model,
      maxTokens = this.maxTokens,
      budget,
      thinking = this.thinking,
    } = {},
  ) {
    const kind = this.provider;
    const anthropic = kind === "anthropic";
    check(providerConfigured(this), "MODEL_NOT_CONFIGURED", "服务端尚未配置模型", 503);
    assertContextBudget(contextBudget({ provider: this, model, messages, tools,
      maxChars: budget?.maxChars ?? 100000, calibration: budget?.calibration,
      outputReserve: maxTokens + (anthropic && thinking === "enabled" ? THINK_BUDGET : 0) }));
    const idle = idleSignal(signal, this.timeoutMs);
    idle.signal.throwIfAborted();
    let fetchError;
    // 重试只发生在拿到响应流之前（requestProvider），SDK 自身不重试。
    const fetchImpl = async (url, init) => {
      try {
        const response = await requestProvider(this.fetch, url, { ...init, redirect: "error" }, onStatus);
        if (response.ok && !response.headers.get("content-type")?.includes("text/event-stream")) {
          await response.body?.cancel();
          throw new AppError("PROVIDER_PROTOCOL", "模型没有返回有效 SSE 流", 502);
        }
        return response;
      } catch (error) {
        fetchError = error;
        throw error;
      }
    };
    try {
      const languageModel = await this.languageModel(model, fetchImpl, { thinking });
      const { stream } = await languageModel.doStream({
        prompt: toPrompt(messages, { kind, thinking, promptCache: anthropic && this.promptCache }),
        tools: toolsFor(tools, { kind, promptCache: this.promptCache }),
        maxOutputTokens: maxTokens,
        abortSignal: idle.signal,
        providerOptions: this.providerOptions(thinking),
      });
      return await this.collect(stream, { kind, idle, onDelta });
    } catch (error) {
      throw this.mapError(error, { idle, fetchError });
    } finally {
      idle.clear();
    }
  }

  async collect(stream, { kind, idle, onDelta }) {
    const responses = kind === "openai-responses";
    // Batches above the runtime's per-round budget are rejected by the runtime
    // as tool results, so the model can split them. Only absurd counts fail here.
    const maxCalls = MAX_STREAM_TOOL_CALLS;
    // Oversized arguments are not kept: the call is replaced by "{}" and marked,
    // and the runtime answers it with a tool error instead of ending the run.
    const appendArgs = (call, text) => {
      if (call.argumentsTooLarge) call.argumentsTooLarge += text.length;
      else {
        call.args += text;
        if (call.args.length > MAX_TOOL_ARGUMENT_CHARS) {
          call.argumentsTooLarge = call.args.length;
          call.args = "{}";
        }
      }
    };
    let content = "",
      reasoning = "",
      finish = null;
    const blocks = new Map();
    // 按开始顺序记录工具调用：流在调用结束事件前被截断时，
    // 半截参数也要留下来交给截断过滤，而不是悄悄消失。
    const calls = new Map();
    const items = [];
    const messageItems = new Map();
    const reasoningItems = new Map();
    const reader = stream.getReader();
    try {
      for (;;) {
        const { value: part, done } = await reader.read();
        if (done) break;
        idle.signal.throwIfAborted();
        idle.touch();
        switch (part.type) {
          case "text-start":
          case "text-delta": {
            if (responses) {
              const itemId = part.providerMetadata?.openai?.itemId ?? part.id;
              let item = messageItems.get(part.id);
              if (!item) {
                item = { type: "message", id: itemId, role: "assistant", status: "completed", content: [{ type: "output_text", text: "", annotations: [] }] };
                messageItems.set(part.id, item);
                items.push(item);
              }
              if (part.type === "text-delta") item.content[0].text += part.delta;
            }
            if (part.type === "text-delta" && part.delta) {
              content += part.delta;
              onDelta(part.delta);
            }
            break;
          }
          case "reasoning-start":
          case "reasoning-delta":
          case "reasoning-end": {
            let block = blocks.get(part.id);
            if (!block) {
              block = { text: "" };
              blocks.set(part.id, block);
            }
            mergeSignature(block, part.providerMetadata);
            if (part.type === "reasoning-delta" && part.delta) {
              block.text += part.delta;
              reasoning += part.delta;
            }
            if (responses && block.itemId) {
              let item = reasoningItems.get(block.itemId);
              if (!item) {
                item = { type: "reasoning", id: block.itemId, summary: [] };
                reasoningItems.set(block.itemId, item);
                items.push(item);
              }
              if (block.encrypted) item.encrypted_content = block.encrypted;
              if (!block.summary) {
                block.summary = { type: "summary_text", text: "" };
                item.summary.push(block.summary);
              }
              block.summary.text = block.text;
            }
            break;
          }
          case "tool-input-start":
            if (!calls.has(part.id)) calls.set(part.id, { id: part.id, name: part.toolName, args: "" });
            check(calls.size <= maxCalls, "TOOL_LIMIT", "工具调用数量或索引无效", 502);
            break;
          case "tool-input-delta": {
            const call = calls.get(part.id);
            if (call) appendArgs(call, part.delta || "");
            break;
          }
          case "tool-call": {
            const call = calls.get(part.toolCallId) || { id: part.toolCallId };
            call.name = part.toolName;
            call.args = "";
            delete call.argumentsTooLarge;
            appendArgs(call, String(part.input ?? ""));
            calls.set(call.id, call);
            check(calls.size <= maxCalls, "TOOL_LIMIT", "工具调用数量或索引无效", 502);
            if (responses)
              items.push({
                type: "function_call",
                ...(part.providerMetadata?.openai?.itemId ? { id: part.providerMetadata.openai.itemId } : {}),
                call_id: call.id,
                name: call.name,
                arguments: call.args,
                status: "completed",
              });
            break;
          }
          case "finish":
            finish = part;
            break;
          case "error":
            throw new StreamFailure(part.error);
        }
        check(content.length + reasoning.length < (responses ? 2_000_000 : 120000), "OUTPUT_LIMIT", "模型输出超过单轮上限", 502);
      }
    } finally {
      reader.releaseLock();
    }
    return this.finalize({ kind, content, reasoning, blocks, calls: [...calls.values()], items, finish });
  }

  finalize({ kind, content, reasoning, blocks, calls, items, finish }) {
    const responses = kind === "openai-responses";
    const anthropic = kind === "anthropic";
    // 截断：Chat 为 length，Claude 为 max_tokens，Responses 为 incomplete(max_output_tokens)。
    const raw = finish?.finishReason?.raw;
    const unified = finish?.finishReason?.unified;
    let reason;
    if (responses) {
      check(finish && ["stop", "tool-calls", "length"].includes(unified), "PROVIDER_INCOMPLETE", "模型响应失败或被中止，执行未完成", 502);
      reason = unified === "length" ? "length" : calls.length ? "tool_calls" : "stop";
    } else {
      check(finish, "INCOMPLETE_STREAM", "模型流中断或没有正常结束", 502);
      reason = anthropic
        ? { end_turn: "stop", tool_use: "tool_calls", max_tokens: "length" }[raw]
        : ["stop", "tool_calls", "length"].includes(raw) ? raw : undefined;
      check(reason, "INCOMPLETE_STREAM", "模型流异常结束", 502);
    }
    const truncated = reason === "length";
    const toolCalls = calls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.args },
      ...(call.argumentsTooLarge ? { argumentsTooLarge: call.argumentsTooLarge } : {}),
    }));
    check(new Set(toolCalls.map((c) => c.id)).size === toolCalls.length, "PROVIDER_PROTOCOL", "模型工具标识重复", 502);
    // 截断流里的工具参数可能是半截 JSON：无法解析的调用丢弃，完整的照常执行。
    const usableCalls = truncated ? toolCalls.filter((call) => parseable(call.function.arguments)) : toolCalls;
    if (!responses) {
      check(reason !== "tool_calls" || usableCalls.length, "PROVIDER_PROTOCOL", "模型未提供工具调用", 502);
      check(reason !== "stop" || !usableCalls.length, "PROVIDER_PROTOCOL", "模型结束状态与工具调用不一致", 502);
      check(
        truncated || content.trim() || usableCalls.length,
        truncated ? "INCOMPLETE_STREAM" : "EMPTY_OUTPUT",
        truncated ? "模型达到输出上限，且没有可交付的内容" : "模型没有返回内容",
        502,
      );
    }
    check(usableCalls.every((call) => call.id && call.function.name), "PROVIDER_PROTOCOL", "模型工具标识无效", 502);
    const thinkingBlocks = anthropic
      ? [...blocks.values()]
          .filter((b) => b.redactedData || b.signature)
          .map((b) => b.redactedData
            ? { type: "redacted_thinking", data: b.redactedData }
            : { type: "thinking", thinking: b.text, signature: b.signature })
      : [];
    // usage 保留厂商原字段名：calibrateInput 依赖 input_tokens 才计入缓存 token。
    const usage = finish?.usage?.raw ? { ...finish.usage.raw } : null;
    if (anthropic && usage && usage.total_tokens == null)
      usage.total_tokens = Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0);
    return {
      message: {
        role: "assistant",
        content: responses ? content : content || null,
        ...(!responses && reasoning ? { reasoning_content: reasoning } : {}),
        ...(thinkingBlocks.length ? { thinkingBlocks } : {}),
        // 截断轮的输出项可能含半截条目，回放时改用文本与完整工具调用重建。
        ...(responses && !truncated ? { responseItems: items } : {}),
        ...(usableCalls.length ? { tool_calls: usableCalls } : {}),
      },
      usage,
      ...(truncated ? { stopReason: "max_tokens" } : {}),
    };
  }

  mapError(error, { idle, fetchError }) {
    if (error instanceof AppError) return error;
    // 空闲超时与调用方取消都以 signal.reason 抛出；runtime 依赖 TimeoutError 这个名字。
    if (idle.signal.aborted) return idle.signal.reason ?? error;
    // 请求阶段的错误（含重试耗尽的网络错误）原样抛出。
    if (fetchError) return fetchError;
    const responses = this.provider === "openai-responses";
    const cause = error instanceof StreamFailure ? error.cause : error;
    if (!(error instanceof StreamFailure) && Number.isInteger(cause?.statusCode)) {
      const mapped = responses
        ? new AppError("PROVIDER_RESPONSE", `Responses 服务返回无效响应（${cause.statusCode}）`, 502)
        : new AppError("PROVIDER_ERROR", `模型服务返回 ${cause.statusCode}，请检查服务配置或稍后重试`, 502);
      // Auth, quota and bad-request errors will not fix themselves on retry.
      if (cause.statusCode >= 400 && cause.statusCode < 500 && ![408, 409, 429].includes(cause.statusCode))
        mapped.retryable = false;
      return mapped;
    }
    // Responses 的一切非终态失败都按“执行未完成”处理。
    if (responses) return new AppError("PROVIDER_INCOMPLETE", "模型响应失败或被中止，执行未完成", 502);
    const name = String(cause?.name || "");
    if (/JSONParseError|TypeValidationError/.test(name))
      return new AppError("PROVIDER_PROTOCOL", "模型流包含无效 JSON", 502);
    if (/without a finish reason/i.test(String(cause?.message || "")))
      return new AppError("INCOMPLETE_STREAM", "模型流中断或没有正常结束", 502);
    return new AppError("PROVIDER_ERROR", "模型执行失败，未将本次内容标为完成", 502);
  }
}
