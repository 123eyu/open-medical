# 提案：用 Vercel AI SDK 替换手写的模型调用层

状态：已全部实施。AI SDK 是唯一的模型调用实现，手写协议层与 `AI_ENGINE` 开关已删除。实现说明见第 0 节，第 1–7 节保留原提案。

## 0. 实现说明（2026-10）

**结构**

- `server/core/ai-sdk-provider.mjs` 的 `AiSdkProvider` 负责请求、流解析和结果整形。
- `providers.mjs` 里的 `DeepSeekProvider`、`OpenAIProvider`、`ResponsesProvider`、`AnthropicProvider` 继承它，只做配置解析与校验。
- `complete()` 的入参和返回值不变，调用方无需改动。
- 不开启任何 SDK 遥测。

**与原提案的差异**

- 不引入 `ai` 核心包，也不用 `streamText`，直接调用 provider 包的 `LanguageModelV4.doStream()`。原因如下：
  - SDK 的重试、工具校验和多步循环都绕开了，重试只在拿到响应流之前由 `requestProvider` 负责；
  - 流事件可以逐个映射回现有的返回结构。
- 依赖只有 `@ai-sdk/anthropic`、`@ai-sdk/openai`、`@ai-sdk/deepseek`、`@ai-sdk/openai-compatible`。它们按厂商动态加载，已打进离线安装包（`scripts/runtime-dependencies.mjs`）。
- 原计划的灰度阶段（开关默认旧实现、观察后切换）已跳过，直接删除了旧实现。

**测试**

- `tests/ai-sdk-provider.test.mjs` 覆盖：
  - 文本、usage、思考字段和工具往返；
  - 截断、协议违规、429 重试、401、非 SSE 响应、中止和空闲超时；
  - Claude 缓存断点和签名思考块回放；
  - Responses 加密推理回放；
  - 从迁移前保存的检查点继续执行。

**相对旧实现的行为差异**

- Chat Completions 流不再强制要求 `[DONE]`，收到 `finish_reason` 即视为完整。
- 历史工具参数会重新序列化：合法的 JSON 按新格式输出，非法的包装成 `{"invalid_json_arguments": 原文}`。
- SDK 的结构校验比旧实现严格（见 7.7），以下不规范网关会报错：
  - 省略 Claude `message_delta.usage` 的网关；
  - Responses 流里 `function_call` 条目缺少 `id`/`status` 的网关。
- `store:false` 时回放的 Responses `function_call` 不带条目 `id`，工具调用和结果靠 `call_id` 配对。

**风险**

- 没有用真实 API Key 做过冒烟测试，以上验证都基于贴近真实事件格式的模拟流。上线后应先在常用厂商上实际跑几轮。

## 1. 背景

- 所有模型调用都在 `server/core/providers.mjs` 里手写：原生 `fetch` 加手写 SSE 解析，共四个类：`DeepSeekProvider`、`OpenAIProvider`、`ResponsesProvider`、`AnthropicProvider`。
- 每接一家新厂商，都要自己处理消息格式、工具调用格式、流式事件、思考块签名、缓存标记和 usage 字段，维护成本高，也容易出兼容问题。
- 调用方大约 15 处，都只依赖 `provider.complete(messages, tools, opts)`，以及 `model`、`vision`、`maxTokens`、`contextWindow` 等几个属性。涉及 Agent 主循环、子 Agent、团队协作、护理分诊、随访、OCR、上下文压缩、模型自检等。

## 2. 目标与非目标

**目标**

- 模型调用层改用 AI SDK：`ai`，加上 `@ai-sdk/anthropic`、`@ai-sdk/openai`、`@ai-sdk/deepseek`、`@ai-sdk/openai-compatible`。
- `complete()` 的入参和返回值保持不变，`agent-runtime.mjs` 和所有调用方都不用改。
- 通过开关灰度上线，可以随时切回旧实现。

**非目标**

- 不使用 AI SDK 的 Agent 循环（`maxSteps` / `stopWhen`），也不用它执行工具。ReAct 循环、审批、交付校验、红旗规则继续用自研实现。
- 不改消息存储格式和会话恢复逻辑。

## 3. 设计

### 3.1 新文件 `server/core/ai-sdk-provider.mjs`

```js
export class AiSdkProvider {
  constructor({ kind, apiKey, baseUrl, model, thinking, promptCache, maxTokens,
                timeoutMs, contextWindow, contextWindows, vision, fetchImpl }) { … }
  async complete(messages, tools, { model, thinking, budget, maxTokens, signal, onDelta, onStatus } = {}) {
    // 返回值与现有 provider 完全一致：
    // { message: { role:"assistant", content, reasoning_content?, thinkingBlocks?, responseItems?, tool_calls? },
    //   usage,                 // 保留各厂商原字段名，见 7.2
    //   stopReason?: "max_tokens" }
  }
}
```

对外暴露的属性和现在一致：`provider`、`model`、`vision`、`local`、`maxTokens`、`baseUrl`、`thinking`、`contextWindow`、`contextWindows`、`mediaTokenReserve`。

### 3.2 厂商工厂

| 现有 `kind` | AI SDK 包 | 说明 |
|---|---|---|
| `deepseek` | `@ai-sdk/deepseek` | 原生支持 `reasoning_content` |
| `openai` / `openai-compatible` / `openrouter` | `@ai-sdk/openai-compatible` | Chat Completions 接口 |
| `openai-responses` | `@ai-sdk/openai`（`.responses()`） | 见 7.5 |
| `anthropic` / `claude` | `@ai-sdk/anthropic` | 缓存和思考块通过 `providerOptions` 设置 |
| `local`（Ollama 等） | `@ai-sdk/openai-compatible` | 需支持离线使用 |

所有工厂都把 `fetchImpl` 传给 SDK 的 `fetch` 参数，现有测试注入假 `fetch` 的方式可以继续用。

### 3.3 消息转换（主要工作量）

`toModelMessages(messages)` 负责把内部的 OpenAI 风格消息转换成 AI SDK 的 `ModelMessage`：

- `system`、`user`（文本或图片）转换成对应角色的 parts。
- 助手消息的 `tool_calls` 转换成 `{ type:"tool-call", toolCallId, toolName, input }`。`arguments` 先 `JSON.parse`，解析失败时保留原字符串，见 7.4。
- `role:"tool"` 转换成 `{ role:"tool", content:[{ type:"tool-result", toolCallId, toolName, output }] }`，其中 `toolName` 要从前面的助手消息里查出来。
- 思考内容必须原样往返：
  - Anthropic 的 `thinkingBlocks`（带签名）转换成 `{ type:"reasoning", text, providerOptions:{ anthropic:{ signature } } }`；
  - DeepSeek 的 `reasoning_content` 转换成 reasoning part。

  签名一旦丢失，Claude 会拒绝带工具调用的续轮请求，这部分必须有测试覆盖。

### 3.4 工具

`toSdkTools(tools)` 只转换 schema（用 `jsonSchema()` 包装），不提供 `execute`。SDK 只负责解析出工具调用，执行仍由 `agent-runtime` 的 Act 阶段完成，审批、`beforeTool` 等钩子都不受影响。

### 3.5 流式输出与返回值映射

调用 `streamText({ model, messages, tools, maxOutputTokens, abortSignal, providerOptions, maxRetries: 0 })`，然后遍历 `fullStream`：

| 流事件 | 处理方式 |
|---|---|
| `text-delta` | 追加到 `content`，并调用 `onDelta(text)`（参数是字符串，见 7.1） |
| `reasoning-delta` | 追加到 `reasoning_content` / `thinkingBlocks` |
| `tool-call` | 追加到 `tool_calls`，格式为 `{ id, type:"function", function:{ name, arguments } }` |
| `finish` | `finishReason === "length"` 时设置 `stopReason:"max_tokens"`；`totalUsage` 按 7.2 映射 |
| `error` | 转换成现有错误，见 3.7 |

每收到一个流事件，都要调用一次 `idle.touch()`。

### 3.6 Prompt 缓存与思考

- **Anthropic 缓存**：在系统提示和最后一个工具上设置 `providerOptions.anthropic.cacheControl = { type:"ephemeral" }`，与现有断点位置一致；继续由 `ANTHROPIC_PROMPT_CACHE` 控制。
- **思考**：
  - Anthropic：`thinking` / `budget` 转换成 `providerOptions.anthropic.thinking = { type:"enabled", budgetTokens }`；
  - OpenAI Responses：转换成 `reasoningEffort`。

### 3.7 超时、重试与错误

- **超时**：继续复用 `idleSignal`（空闲超时），与调用方传入的 `signal` 用 `AbortSignal.any` 合并。
- **重试**：SDK 的 `maxRetries` 设为 0，重试逻辑见 7.3。
- **错误**：把 SDK 的 `APICallError` 按 `statusCode` 转换成 `AppError`，错误文案沿用现有写法。超时类错误必须保留 `name === "TimeoutError"`，因为 `runtime.mjs` 靠这个名字判断超时。

### 3.8 接入与开关

```js
if ((options.engine ?? process.env.AI_ENGINE) === "ai-sdk")
  return withVision(new AiSdkProvider({ kind, ...resolvedOptions }), options);
```

- 默认仍走旧实现。
- 设置 `AI_ENGINE=ai-sdk` 开启，也可以在模型设置里按模型单独开启。
- 环境变量（API key、base URL 等）的解析抽成公共函数，新旧两套实现共用。

### 3.9 医疗场景约束

- 不上报任何数据：不开启 `experimental_telemetry`，不使用 AI Gateway，请求只发往用户配置的 `baseUrl`。
- 离线包必须可用：`verify:offline` 要确认 `@ai-sdk/*` 已打进离线包，断网时本地模型（`local`）仍能使用。

## 4. 测试

1. 用参数化的方式让 `provider.test.mjs`、`provider-request.test.mjs` 同时跑新旧两套实现，覆盖：文本、工具调用、多轮工具结果、`max_tokens` 截断、中断与空闲超时、错误映射。
2. 新增往返测试：Anthropic 思考块签名、DeepSeek `reasoning_content`、Responses `responseItems` 在多轮对话中能原样往返；缓存标记出现在请求体的正确位置。
3. 真实模型冒烟测试：用 `npm run verify:model` 和 `verify:agent`，每家厂商各跑一次。
4. 全量回归：`AI_ENGINE=ai-sdk npm test`。

## 5. 上线步骤

| 阶段 | 内容 | 估计工作量（已按第 7 节修正） |
|---|---|---|
| 一 | `AiSdkProvider`、消息转换、重试用的 fetch 包装；先接 OpenAI 兼容接口和 DeepSeek；新旧实现跑同一组测试 | 4–5 天 |
| 二 | Anthropic（缓存、思考块签名）、Responses（`responseItems` 回放）、旧检查点兼容 | 3–4 天 |
| 三 | 内部默认开启 `AI_ENGINE=ai-sdk`，观察错误率、首字延迟、缓存命中率 | 1 周 |
| 四 | 切换默认实现；稳定后删除旧的 provider 类，`providers.mjs` 只保留工厂和配置解析 | 1 天 |

## 6. 风险与应对

- **AI SDK 大版本变动快**（v4 到 v5 改过消息格式）：锁定主版本号；SDK 的类型只在 `ai-sdk-provider.mjs` 内部使用，不往外泄漏。
- **思考块或签名丢失导致 Claude 续轮报错**：阶段二的往返测试负责发现；出问题时可以按模型单独回退到旧实现。
- **部分 OpenAI 兼容厂商有非标准字段**：`openai-compatible` 支持自定义 metadata 提取；实在不兼容的继续用旧实现。
- **新旧实现并存期间的维护成本**：控制在阶段三的观察期内，阶段四删掉旧代码。

## 7. 对照现有代码的修正（实施前必须处理）

### 7.1 `onDelta` 的参数是字符串

现有所有 provider 都调用 `onDelta("文本")`，`agent-runtime.mjs` 里的 `delta()` 也按字符串处理。不能改成 `onDelta({ type:"text" })`。

### 7.2 usage 保留各厂商原来的字段名

`calibrateInput`（`context-budget.mjs`）只有在看到 `input_tokens` 字段时，才会把 `cache_read_input_tokens` 和 `cache_creation_input_tokens` 计入。Anthropic 开启缓存后，命中时 `input_tokens` 很小；如果把字段统一改名为 `prompt_tokens`，缓存 token 会漏算，校准就失效了。

因此：

- Anthropic 和 Responses 继续返回 `input_tokens` / `output_tokens` / `cache_*`；
- Chat Completions 系列继续返回 `prompt_tokens` / `completion_tokens`；
- Anthropic 路径要继续补算 `total_tokens`，界面上的用量显示依赖它。

### 7.3 重试要在 fetch 层实现

现有重试写在 `requestProvider` 里，由各个 provider 调用。改用 SDK 后，请求由 SDK 内部发出，所以要把同样的逻辑包成传给 SDK 的 `fetch`：

- 只在拿到响应流之前重试；
- 重试的状态码保持为 429/500/502/503/504/529；
- 支持 `Retry-After`；
- 最多 3 次。

SDK 自带的重试必须关闭（`maxRetries: 0`），否则两层重试叠加。

### 7.4 保留现有的坏 JSON 工具参数处理

- 历史消息里，坏 JSON 参数要原样保留在 `invalid_json_arguments`，让模型看到原文并修正。
- 输出截断时，只丢弃无法解析的工具调用，完整的调用照常执行。

不能直接用 `arguments: JSON.stringify(input)`，否则原始字符串会丢失。实施前要先验证 SDK 遇到坏参数时会发出什么事件（`invalid` 标记的 tool-call 还是 `tool-error`）。

### 7.5 Responses 回放与旧检查点兼容

现有 Responses 路径使用 `store:false` 加上 `include: ["reasoning.encrypted_content"]`，依赖消息上的 `responseItems` 原样回放；截断轮不带 `responseItems`。

已保存的检查点里有 `responseItems` 和 `thinkingBlocks`。新实现必须能直接读取这些旧数据，否则切换开关后，进行中的会话续跑时会报错。

### 7.6 必须保留的厂商特有逻辑与协议校验

- DeepSeek 请求体里的 `thinking: { type }`。
- 本地 Ollama 的 `reasoning_effort` 映射（`none` / `high`）。
- 发请求前调用 `assertContextBudget` 做上下文预算检查。
- 协议校验：
  - 工具调用数量与索引上限；
  - 单个工具参数 30000 字符上限；
  - 单轮输出上限；
  - 工具 id 不能重复；
  - 结束原因与工具调用必须一致；
  - Responses 单轮工具调用不超过 8 个。

### 7.7 测试数据需要调整

现有假 SSE 测试数据写得比较随意：有的缺少 `message_start`，有的夹带 CRLF 心跳。SDK 的解析可能更严格，新旧实现跑同一组用例时，要预留时间修改这部分测试数据。

### 7.8 错误码依赖面很小

`providers.mjs` 以外几乎没有代码按 provider 错误码做分支判断，主要依赖的是错误文案和 `TimeoutError` 这个名字。错误映射只要保证这两点即可。

### 7.9 是否值得迁移

- 如果要接入很多原生协议厂商（Gemini、Bedrock、Vertex 等），迁移的收益明显。
- 如果只用现有几家，必要性不大：手写层已经补上了空闲超时、思考块回传、prompt 缓存和截断续写，测试也齐全，迁移等于把这些在 SDK 上重做一遍、重新验证一遍。
- 新增的依赖还要通过离线打包验证。
