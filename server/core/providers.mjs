import { AiSdkProvider } from "./ai-sdk-provider.mjs";
import { check } from "../errors.mjs";

// 各厂商子类只负责配置解析与校验；请求、流解析与结果整形都在 AiSdkProvider。
export class DeepSeekProvider extends AiSdkProvider {
  constructor({
    apiKey,
    local = false,
    baseUrl = "https://api.deepseek.com/v1",
    model = "deepseek-v4-flash",
    timeoutMs = 90000,
    thinking = "disabled",
    maxTokens = 8192,
    contextWindow,
    contextWindows,
    fetchImpl = fetch,
  } = {}) {
    super();
    this.apiKey = apiKey;
    this.local = local;
    this.provider = "deepseek";
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    check(
      Number.isInteger(timeoutMs) && timeoutMs >= 50 && timeoutMs <= 600000,
      "PROVIDER_CONFIG",
      "模型超时须为 50–600000 毫秒",
    );
    check(
      ["enabled", "disabled"].includes(thinking),
      "PROVIDER_CONFIG",
      "DEEPSEEK_THINKING 需为 enabled 或 disabled",
    );
    check(
      Number.isInteger(maxTokens) && maxTokens >= 256 && maxTokens <= 131072,
      "PROVIDER_CONFIG",
      "模型输出预算须为 256–131072 token",
    );
    this.timeoutMs = timeoutMs;
    this.thinking = thinking;
    this.includeThinking = true;
    this.maxTokens = maxTokens;
    if (contextWindow !== undefined) check(Number.isInteger(contextWindow) && contextWindow >= 512 && contextWindow <= 10000000, "PROVIDER_CONFIG", "模型上下文窗口须为 512–10000000 token");
    this.contextWindow = contextWindow;
    this.contextWindows = contextWindows;
    this.fetch = fetchImpl;
    const url = new URL(this.baseUrl);
    if (local)
      check(
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
          !url.username &&
          !url.password,
        "LOCAL_PROVIDER_URL",
        "本地模型必须使用回环地址",
      );
    check(
      url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)),
      "PROVIDER_URL",
      "模型地址必须为 HTTPS（本地测试除外）",
    );
  }
}

// OpenAI-compatible providers share the Chat Completions wire protocol but do not
// receive DeepSeek-only `thinking` fields. This is also the adapter seam for
// OpenRouter, Azure-compatible gateways and local vLLM endpoints.
export class OpenAIProvider extends DeepSeekProvider {
  constructor(options = {}) {
    super({
      ...options,
      baseUrl: options.baseUrl || "https://api.openai.com/v1",
      model: options.model || "gpt-4.1-mini",
      thinking: "disabled",
    });
    this.includeThinking = false;
    this.provider = options.local ? "local" : "openai";
  }
}

export class ResponsesProvider extends OpenAIProvider {
  constructor(options = {}) {
    super(options);
    this.provider = "openai-responses";
    this.vision = true;
    this.reasoningEffort = options.reasoningEffort;
    check(
      !this.reasoningEffort ||
        ["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(
          this.reasoningEffort,
        ),
      "PROVIDER_CONFIG",
      "推理强度无效",
    );
  }
}

export class AnthropicProvider extends AiSdkProvider {
  constructor({
    apiKey,
    baseUrl = "https://api.anthropic.com",
    model = "claude-sonnet-4-5",
    timeoutMs = 90000,
    maxTokens = 8192,
    thinking = "disabled",
    promptCache = true,
    contextWindow,
    contextWindows,
    fetchImpl = fetch,
  } = {}) {
    super();
    check(
      ["enabled", "disabled"].includes(thinking),
      "PROVIDER_CONFIG",
      "ANTHROPIC_THINKING 需为 enabled 或 disabled",
    );
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.thinking = thinking;
    this.promptCache = promptCache;
    this.vision = true; // Claude 3+ 全系支持图片输入;模型设置里可显式关闭。
    this.timeoutMs = timeoutMs;
    this.maxTokens = maxTokens;
    if (contextWindow !== undefined) check(Number.isInteger(contextWindow) && contextWindow >= 512 && contextWindow <= 10000000, "PROVIDER_CONFIG", "模型上下文窗口须为 512–10000000 token");
    this.contextWindow = contextWindow;
    this.contextWindows = contextWindows;
    this.fetch = fetchImpl;
    this.provider = "anthropic";
    const url = new URL(this.baseUrl);
    check(
      url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)),
      "PROVIDER_URL",
      "模型地址必须为 HTTPS（本地测试除外）",
    );
    check(
      Number.isInteger(timeoutMs) && timeoutMs >= 50 && timeoutMs <= 600000,
      "PROVIDER_CONFIG",
      "模型超时须为 50–600000 毫秒",
    );
    check(
      Number.isInteger(maxTokens) && maxTokens >= 256 && maxTokens <= 131072,
      "PROVIDER_CONFIG",
      "模型输出预算须为 256–131072 token",
    );
  }
}

function createProviderByKind(provider, options = {}) {
  const kind = provider;
  if (kind === "openai-responses" || kind === "responses")
    return new ResponsesProvider({
      apiKey:
        options.apiKey ||
        process.env.OPENAI_API_KEY ||
        process.env.AI_API_KEY ||
        "",
      baseUrl: options.baseUrl || process.env.OPENAI_BASE_URL,
      model: options.model || process.env.OPENAI_MODEL,
      reasoningEffort:
        options.reasoningEffort || process.env.AI_REASONING_EFFORT,
      timeoutMs: Number(
        options.timeoutMs ?? process.env.AI_TIMEOUT_MS ?? 90000,
      ),
      maxTokens: Number(options.maxTokens ?? process.env.AI_MAX_TOKENS ?? 8192),
      contextWindow: options.contextWindow,
      contextWindows: options.contextWindows,
      fetchImpl: options.fetchImpl,
    });
  if (kind === "local")
    return new OpenAIProvider({
      apiKey: options.apiKey || "",
      local: true,
      baseUrl:
        options.baseUrl ||
        process.env.LOCAL_MODEL_BASE_URL ||
        "http://127.0.0.1:11434/v1",
      model: options.model || process.env.LOCAL_MODEL_NAME || "local-model",
      timeoutMs: Number(
        options.timeoutMs ?? process.env.AI_TIMEOUT_MS ?? 90000,
      ),
      maxTokens: Number(options.maxTokens ?? process.env.AI_MAX_TOKENS ?? 8192),
      contextWindow: options.contextWindow,
      contextWindows: options.contextWindows,
      fetchImpl: options.fetchImpl,
    });
  if (kind === "anthropic" || kind === "claude")
    return new AnthropicProvider({
      apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "",
      baseUrl: options.baseUrl || process.env.ANTHROPIC_BASE_URL,
      model: options.model || process.env.ANTHROPIC_MODEL,
      timeoutMs: Number(
        options.timeoutMs ??
          process.env.AI_TIMEOUT_MS ??
          process.env.ANTHROPIC_TIMEOUT_MS ??
          90000,
      ),
      maxTokens: Number(
        options.maxTokens ??
          process.env.AI_MAX_TOKENS ??
          process.env.ANTHROPIC_MAX_TOKENS ??
          8192,
      ),
      thinking: options.thinking || process.env.ANTHROPIC_THINKING || "disabled",
      promptCache:
        options.promptCache ?? process.env.ANTHROPIC_PROMPT_CACHE !== "0",
      contextWindow: options.contextWindow,
      contextWindows: options.contextWindows,
      fetchImpl: options.fetchImpl,
    });
  if (
    kind === "openai" ||
    kind === "openai-compatible" ||
    kind === "openrouter"
  )
    return new OpenAIProvider({
      apiKey:
        options.apiKey ||
        (kind === "openrouter" ? process.env.OPENROUTER_API_KEY : undefined) ||
        process.env.OPENAI_API_KEY ||
        process.env.AI_API_KEY ||
        "",
      baseUrl:
        options.baseUrl ||
        process.env.OPENAI_BASE_URL ||
        (kind === "openrouter" ? "https://openrouter.ai/api/v1" : undefined),
      model:
        options.model ||
        (kind === "openrouter" ? process.env.OPENROUTER_MODEL : undefined) ||
        process.env.OPENAI_MODEL,
      timeoutMs: Number(
        options.timeoutMs ?? process.env.AI_TIMEOUT_MS ?? 90000,
      ),
      maxTokens: Number(options.maxTokens ?? process.env.AI_MAX_TOKENS ?? 8192),
      contextWindow: options.contextWindow,
      contextWindows: options.contextWindows,
      fetchImpl: options.fetchImpl,
    });
  return new DeepSeekProvider({
    apiKey: options.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "",
    baseUrl: options.baseUrl || process.env.DEEPSEEK_BASE_URL,
    model: options.model || process.env.DEEPSEEK_MODEL,
    thinking: options.thinking || process.env.DEEPSEEK_THINKING || "disabled",
    maxTokens: Number(
      options.maxTokens ??
        process.env.DEEPSEEK_MAX_TOKENS ??
        process.env.AI_MAX_TOKENS ??
        8192,
    ),
    timeoutMs: Number(
      options.timeoutMs ??
        process.env.DEEPSEEK_TIMEOUT_MS ??
        process.env.AI_TIMEOUT_MS ??
        90000,
    ),
    contextWindow: options.contextWindow,
    contextWindows: options.contextWindows,
    fetchImpl: options.fetchImpl,
  });
}

// 用户在模型设置里声明的图片能力优先于各协议类的默认值:
// 显式 vision:true 让 openai-compatible/anthropic 等接入的多模态模型
// 可以直接读取图片资料;显式 false 关闭该能力。
export function createProvider(options = {}) {
  const provider = createProviderByKind(
    String(
      options.provider ??
        process.env.AI_PROVIDER ??
        process.env.MODEL_PROVIDER ??
        "deepseek",
    ).toLowerCase(),
    options,
  );
  if (options && Object.hasOwn(options, "vision"))
    provider.vision = options.vision === true;
  return provider;
}
