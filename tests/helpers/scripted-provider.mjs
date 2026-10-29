// Scripted provider for offline, repeatable Agent tests.
//
// The medical runtime calls provider.complete(messages, tools, options) and
// expects { message: { role: "assistant", content, tool_calls? }, usage? }.
// Each normal call consumes the next scripted turn. Compaction requests are
// answered automatically because they are an infrastructure step, not a
// scripted conversation turn.

const COMPACTION_MARKER = "会话历史压缩器";
const DEFAULT_COMPACTION_SUMMARY =
  "基线测试历史摘要：保留用户任务、约束、已执行工具回执和未完成事项。";

let toolCallSequence = 0;

export function textTurn(text) {
  return { message: { role: "assistant", content: String(text) } };
}

export function toolCall(name, args = {}, id = `call_${++toolCallSequence}`) {
  return {
    message: {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    },
  };
}

function normalizeTurn(turn, callNumber) {
  if (typeof turn === "string") return textTurn(turn);
  if (Array.isArray(turn)) {
    return { message: { role: "assistant", content: null, tool_calls: turn } };
  }
  if (turn && typeof turn === "object") {
    if (turn.message) return turn;
    if (Array.isArray(turn.tool_calls)) {
      return {
        message: { role: "assistant", content: null, tool_calls: turn.tool_calls },
      };
    }
    if (typeof turn.text === "string") return textTurn(turn.text);
  }
  throw new Error(
    `ScriptedProvider 第 ${callNumber} 个脚本回复格式无效：` +
      "应为文本、tool_calls 数组，或 { message } / { tool_calls } / { text } 对象。",
  );
}

export class ScriptedProvider {
  constructor(
    script = [],
    {
      model = "scripted-baseline",
      provider = "scripted",
      maxTokens = 4096,
      contextWindow = 131072,
      compactionSummary = DEFAULT_COMPACTION_SUMMARY,
    } = {},
  ) {
    this.script = [...script];
    this.model = model;
    this.provider = provider;
    this.maxTokens = maxTokens;
    this.contextWindow = contextWindow;
    this.compactionSummary = compactionSummary;
    // A truthy apiKey marks the provider as configured to providerConfigured().
    this.apiKey = "scripted-provider";
    this.calls = [];
    this.compactionCalls = 0;
  }

  get remaining() {
    return this.script.length;
  }

  enqueue(...turns) {
    this.script.push(...turns);
    return this;
  }

  async complete(messages, tools = [], options = {}) {
    const system =
      messages.find((message) => message.role === "system")?.content || "";
    if (system.includes(COMPACTION_MARKER)) {
      this.compactionCalls += 1;
      return textTurn(this.compactionSummary);
    }
    if (!this.script.length) {
      throw new Error(
        `ScriptedProvider 脚本已用尽：第 ${this.calls.length + 1} 次模型调用没有预设回复。` +
          "请在测试里为每一次正常模型调用（含工具结果后的下一轮）预先 enqueue 一个回合。",
      );
    }
    const callNumber = this.calls.length + 1;
    const turn = this.script.shift();
    this.calls.push({
      messages: structuredClone(messages),
      tools: structuredClone(tools),
      model: options.model,
      thinking: options.thinking,
      maxTokens: options.maxTokens,
    });
    const resolved =
      typeof turn === "function"
        ? await turn({
            messages: structuredClone(messages),
            tools,
            options,
            callNumber,
          })
        : turn;
    return normalizeTurn(resolved, callNumber);
  }
}

export function createScriptedProvider(script = [], options = {}) {
  return new ScriptedProvider(script, options);
}
