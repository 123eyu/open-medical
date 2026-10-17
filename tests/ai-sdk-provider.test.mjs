import test from "node:test";
import assert from "node:assert/strict";
import { createProvider } from "../server/core/providers.mjs";
import { AiSdkProvider } from "../server/core/ai-sdk-provider.mjs";

const sseResponse = (chunks, init = {}) =>
  new Response(chunks.join(""), { status: 200, headers: { "content-type": "text/event-stream" }, ...init });
const chat = (delta, finish = null, extra = {}) =>
  `data: ${JSON.stringify({ id: "c1", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
const DONE = "data: [DONE]\n\n";
const claude = (frames) =>
  sseResponse(frames.map((f) => `event: ${f.type}\ndata: ${JSON.stringify(f)}\n\n`));
const claudeStart = (usage = { input_tokens: 5 }) => ({
  type: "message_start",
  message: { id: "msg_1", type: "message", role: "assistant", model: "claude-test", content: [], usage },
});
const responsesStream = (events) =>
  sseResponse(events.map((e, i) => `data: ${JSON.stringify({ sequence_number: i, ...e })}\n\n`));

function recorder(respond) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return respond(requests.length, requests.at(-1));
  };
  return { requests, fetchImpl };
}

const tool = (name) => ({
  type: "function",
  function: { name, description: name, parameters: { type: "object", properties: { path: { type: "string" } } } },
});

test("every provider kind runs on the AI SDK implementation with config validation intact", () => {
  for (const provider of ["deepseek", "openai", "openai-responses", "anthropic", "openrouter"])
    assert.ok(createProvider({ provider, apiKey: "k" }) instanceof AiSdkProvider, provider);
  assert.ok(createProvider({ provider: "local", baseUrl: "http://127.0.0.1:11434/v1" }) instanceof AiSdkProvider);
  const claude = createProvider({ provider: "anthropic", apiKey: "k", vision: false });
  assert.equal(claude.vision, false);
  assert.equal(claude.maxTokens, 8192);
  assert.throws(() => createProvider({ provider: "openai", apiKey: "k", baseUrl: "http://evil.example/v1" }), /HTTPS/);
  assert.throws(() => createProvider({ provider: "local", baseUrl: "http://10.0.0.2:11434/v1" }), /回环/);
});

test(`DeepSeek streams text, keeps raw usage and sends thinking control`, async () => {
  const { requests, fetchImpl } = recorder(() =>
    sseResponse([
      chat({ role: "assistant", content: "你好" }),
      chat({ content: "医学" }),
      chat({}, "stop", { usage: { prompt_tokens: 11, completion_tokens: 2, total_tokens: 13, prompt_cache_hit_tokens: 4 } }),
      DONE,
    ]));
  const p = createProvider({ provider: "deepseek", apiKey: "k", baseUrl: "https://ds.example/v1", fetchImpl, thinking: "enabled" });
  const deltas = [];
  const result = await p.complete([{ role: "user", content: "hi" }], [], { onDelta: (d) => deltas.push(d), maxTokens: 512 });
  assert.deepEqual(deltas, ["你好", "医学"]);
  assert.equal(result.message.content, "你好医学");
  assert.equal(result.usage.prompt_tokens, 11);
  assert.equal(result.usage.completion_tokens, 2);
  assert.equal(requests[0].url, "https://ds.example/v1/chat/completions");
  assert.deepEqual(requests[0].body.thinking, { type: "enabled" });
  assert.equal(requests[0].body.max_tokens, 512);
  assert.equal(requests[0].body.stream, true);
  assert.equal(requests[0].body.stream_options.include_usage, true);
});

test(`DeepSeek reasoning_content and tool calls round-trip through history`, async () => {
  const { requests, fetchImpl } = recorder((n) =>
    n === 1
      ? sseResponse([
          chat({ reasoning_content: "先看文件" }),
          chat({ tool_calls: [{ index: 0, id: "t1", type: "function", function: { name: "read_file", arguments: '{"path":' } }] }),
          chat({ tool_calls: [{ index: 0, function: { arguments: '"a.txt"}' } }] }, "tool_calls"),
          DONE,
        ])
      : sseResponse([chat({ content: "完成" }, "stop"), DONE]));
  const p = createProvider({ provider: "deepseek", apiKey: "k", baseUrl: "https://ds.example/v1", fetchImpl });
  const history = [{ role: "system", content: "规则" }, { role: "user", content: "读 a.txt" }];
  const first = await p.complete(history, [tool("read_file")]);
  assert.equal(first.message.reasoning_content, "先看文件");
  assert.deepEqual(first.message.tool_calls, [{ id: "t1", type: "function", function: { name: "read_file", arguments: '{"path":"a.txt"}' } }]);
  await p.complete([...history, first.message, { role: "tool", tool_call_id: "t1", content: "内容" }], [tool("read_file")]);
  const sent = requests[1].body.messages;
  assert.deepEqual(sent.map((m) => m.role), ["system", "user", "assistant", "tool"]);
  assert.equal(sent[2].reasoning_content, "先看文件");
  assert.equal(sent[2].tool_calls[0].id, "t1");
  assert.deepEqual(JSON.parse(sent[2].tool_calls[0].function.arguments), { path: "a.txt" });
  assert.equal(sent[3].tool_call_id, "t1");
  assert.equal(sent[3].content, "内容");
  assert.equal(requests[1].body.tools[0].function.name, "read_file");
});

test(`malformed historical tool arguments stay visible to the model`, async () => {
  const { requests, fetchImpl } = recorder(() => sseResponse([chat({ content: "已修正" }, "stop"), DONE]));
  const p = createProvider({ provider: "openai", apiKey: "k", baseUrl: "https://oa.example/v1", fetchImpl });
  const malformed = '{"note":"原文"未转义""}';
  await p.complete([
    { role: "user", content: "整理" },
    { role: "assistant", content: "", tool_calls: [{ id: "bad", type: "function", function: { name: "save", arguments: malformed } }] },
    { role: "tool", tool_call_id: "bad", content: '{"code":"INVALID_TOOL_ARGS"}' },
  ], []);
  const sentArgs = requests[0].body.messages[1].tool_calls[0].function.arguments;
  // 旧实现原样发送；新实现包成合法 JSON，但原文必须完整保留。
  const recovered = sentArgs === malformed ? malformed : JSON.parse(sentArgs).invalid_json_arguments;
  assert.equal(recovered, malformed);
});

test(`OpenAI-compatible omits DeepSeek thinking; local maps reasoning_effort`, async () => {
  const { requests, fetchImpl } = recorder(() => sseResponse([chat({ content: "ok" }, "stop"), DONE]));
  const openai = createProvider({ provider: "openai", apiKey: "k", baseUrl: "https://oa.example/v1", fetchImpl });
  await openai.complete([{ role: "user", content: "hi" }], [tool("read_file")], { thinking: "enabled" });
  assert.equal(requests[0].body.thinking, undefined);
  assert.equal(requests[0].body.reasoning_effort, undefined);
  assert.equal(requests[0].body.tools[0].function.name, "read_file");
  assert.equal(requests[0].headers.Authorization ?? requests[0].headers.authorization, "Bearer k");
  const local = createProvider({ provider: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "m", fetchImpl });
  await local.complete([{ role: "user", content: "hi" }], []);
  await local.complete([{ role: "user", content: "hi" }], [], { thinking: "enabled" });
  assert.equal(requests[1].body.reasoning_effort, "none");
  assert.equal(requests[2].body.reasoning_effort, "high");
  assert.equal(requests[2].body.thinking, undefined);
});

test(`image input is sent as image_url for chat models`, async () => {
  const { requests, fetchImpl } = recorder(() => sseResponse([chat({ content: "看到了" }, "stop"), DONE]));
  const p = createProvider({ provider: "openai", apiKey: "k", baseUrl: "https://oa.example/v1", fetchImpl, vision: true });
  await p.complete([{ role: "user", content: [
    { type: "input_text", text: "这张图" },
    { type: "input_image", image_url: "data:image/png;base64,iVBORw0KGgo=" },
  ] }], []);
  const parts = requests[0].body.messages[0].content;
  assert.deepEqual(parts[0], { type: "text", text: "这张图" });
  assert.equal(parts[1].type, "image_url");
  assert.equal(parts[1].image_url.url, "data:image/png;base64,iVBORw0KGgo=");
});

test(`chat truncation keeps complete tool calls and drops cut ones`, async () => {
  const { fetchImpl } = recorder(() =>
    sseResponse([
      chat({ content: "部分说明" }),
      chat({ tool_calls: [
        { index: 0, id: "ok", type: "function", function: { name: "t1", arguments: '{"a":1}' } },
        { index: 1, id: "cut", type: "function", function: { name: "t2", arguments: '{"b":"半截' } },
      ] }, "length"),
      DONE,
    ]));
  const p = createProvider({ provider: "openai", apiKey: "k", baseUrl: "https://oa.example/v1", fetchImpl });
  const result = await p.complete([{ role: "user", content: "hi" }], []);
  assert.equal(result.stopReason, "max_tokens");
  assert.equal(result.message.content, "部分说明");
  assert.deepEqual(result.message.tool_calls.map((c) => c.id), ["ok"]);
});

test(`protocol violations fail instead of returning empty success`, async (t) => {
  const cases = {
    "no finish": [chat({ content: "partial" })],
    "malformed json": ["data: broken\n\n"],
    "error frame": [`data: ${JSON.stringify({ error: { message: "boom", type: "server_error" } })}\n\n`],
    "stop with tools": [chat({ tool_calls: [{ index: 0, id: "x", type: "function", function: { name: "t", arguments: "{}" } }] }, "stop"), DONE],
    "empty": [chat({}, "stop"), DONE],
  };
  for (const [name, chunks] of Object.entries(cases))
    await t.test(name, async () => {
      const p = createProvider({ provider: "openai", apiKey: "k", baseUrl: "https://oa.example/v1", fetchImpl: async () => sseResponse(chunks) });
      await assert.rejects(p.complete([{ role: "user", content: "hi" }], []), (e) => e.status === 502 && typeof e.code === "string");
    });
});

test(`HTTP errors map to readable AppErrors and retries happen before streaming`, async () => {
  const statuses = [];
  let calls = 0;
  const flaky = createProvider({ provider: "openai", apiKey: "k", baseUrl: "https://oa.example/v1",
    fetchImpl: async () => (++calls === 1
      ? new Response("busy", { status: 429, headers: { "retry-after": "0" } })
      : sseResponse([chat({ content: "ok" }, "stop"), DONE])) });
  const ok = await flaky.complete([{ role: "user", content: "hi" }], [], { onStatus: (s) => statuses.push(s) });
  assert.equal(ok.message.content, "ok");
  assert.equal(calls, 2);
  assert.equal(statuses[0].status, "retrying");
  assert.equal(statuses[0].httpStatus, 429);
  const denied = createProvider({ provider: "anthropic", apiKey: "k", baseUrl: "https://claude.example",
    fetchImpl: async () => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "bad key" } }), { status: 401, headers: { "content-type": "application/json" } }) });
  await assert.rejects(denied.complete([{ role: "user", content: "hi" }], []), (e) => e.code === "PROVIDER_ERROR" && e.message.includes("401"));
  const notSse = createProvider({ provider: "openai", apiKey: "k", baseUrl: "https://oa.example/v1",
    fetchImpl: async () => new Response("{}", { headers: { "content-type": "application/json" } }) });
  await assert.rejects(notSse.complete([{ role: "user", content: "hi" }], []), (e) => e.code === "PROVIDER_PROTOCOL");
});

test(`caller abort and idle timeout keep their error names`, async (t) => {
  // 空闲计时器是 unref 的；内存流没有 socket 撑住事件循环，测试里手动保活。
  const keepAlive = setInterval(() => {}, 1000);
  t.after(() => clearInterval(keepAlive));
  const encoder = new TextEncoder();
  // 与真实 fetch 一样：signal 中止时响应体随之报错。
  const stalling = async (_url, init) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(chat({ content: "开始" })));
      init.signal?.addEventListener("abort", () => controller.error(init.signal.reason), { once: true });
    },
  }), { headers: { "content-type": "text/event-stream" } });
  const idle = createProvider({ provider: "openai", apiKey: "k", baseUrl: "https://oa.example/v1", timeoutMs: 100, fetchImpl: stalling });
  await assert.rejects(idle.complete([{ role: "user", content: "hi" }], []), (e) => e.name === "TimeoutError");
  const controller = new AbortController();
  const cancelled = createProvider({ provider: "openai", apiKey: "k", baseUrl: "https://oa.example/v1", timeoutMs: 5000, fetchImpl: stalling });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(cancelled.complete([{ role: "user", content: "hi" }], [], { signal: controller.signal }), (e) => e.name === "AbortError");
});

test(`Anthropic cache usage keeps vendor field names and total_tokens`, async () => {
  const { requests, fetchImpl } = recorder(() => claude([
    claudeStart({ input_tokens: 3, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, output_tokens: 1 }),
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "好" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4 } },
    { type: "message_stop" },
  ]));
  const p = createProvider({ provider: "anthropic", apiKey: "k", baseUrl: "https://claude.example", model: "claude-test", fetchImpl });
  const result = await p.complete([{ role: "system", content: "甲" }, { role: "system", content: "乙" }, { role: "user", content: "hi" }], [tool("a"), tool("b")]);
  assert.equal(result.usage.input_tokens, 3);
  assert.equal(result.usage.cache_read_input_tokens, 900);
  assert.equal(result.usage.output_tokens, 4);
  assert.equal(result.usage.total_tokens, 7);
  const body = requests[0].body;
  assert.equal(requests[0].url, "https://claude.example/v1/messages");
  assert.deepEqual(body.system, [{ type: "text", text: "甲\n\n乙", cache_control: { type: "ephemeral" } }]);
  assert.equal(body.tools[0].cache_control, undefined);
  assert.deepEqual(body.tools[1].cache_control, { type: "ephemeral" });
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(body.max_tokens, 8192);
});

test(`Anthropic signed and redacted thinking replay only when thinking is on`, async () => {
  const { requests, fetchImpl } = recorder((n) => n === 1 ? claude([
    claudeStart(),
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "先读" } },
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-1" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "redacted_thinking", data: "opaque" } },
    { type: "content_block_stop", index: 1 },
    { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "u1", name: "read_file", input: {} } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"path":"a"}' } },
    { type: "content_block_stop", index: 2 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 9 } },
    { type: "message_stop" },
  ]) : claude([
    claudeStart(),
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "完成" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ]));
  const p = createProvider({ provider: "anthropic", apiKey: "k", baseUrl: "https://claude.example", model: "claude-test", thinking: "enabled", fetchImpl });
  const history = [{ role: "user", content: "读 a" }];
  const first = await p.complete(history, [tool("read_file")]);
  assert.deepEqual(first.message.thinkingBlocks, [
    { type: "thinking", thinking: "先读", signature: "sig-1" },
    { type: "redacted_thinking", data: "opaque" },
  ]);
  assert.equal(first.message.reasoning_content, "先读");
  assert.deepEqual(requests[0].body.thinking, { type: "enabled", budget_tokens: 4096 });
  assert.equal(requests[0].body.max_tokens, 8192 + 4096);
  const next = [...history, first.message, { role: "tool", tool_call_id: "u1", content: "内容" }];
  await p.complete(next, [tool("read_file")]);
  const replay = requests[1].body.messages[1].content;
  assert.deepEqual(replay.map((b) => b.type), ["thinking", "redacted_thinking", "tool_use"]);
  assert.equal(replay[0].signature, "sig-1");
  assert.equal(replay[0].thinking, "先读");
  assert.equal(replay[1].data, "opaque");
  assert.deepEqual(replay[2].input, { path: "a" });
  assert.equal(requests[1].body.messages[2].content[0].tool_use_id, "u1");
  await p.complete(next, [tool("read_file")], { thinking: "disabled" });
  assert.deepEqual(requests[2].body.messages[1].content.map((b) => b.type), ["tool_use"]);
});

test(`Anthropic image input becomes a base64 image block`, async () => {
  const { requests, fetchImpl } = recorder(() => claude([
    claudeStart(),
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "图" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ]));
  const p = createProvider({ provider: "anthropic", apiKey: "k", baseUrl: "https://claude.example", model: "claude-test", fetchImpl });
  await p.complete([{ role: "user", content: [
    { type: "input_text", text: "看" },
    { type: "input_image", image_url: "data:image/png;base64,iVBORw0KGgo=" },
  ] }], []);
  const blocks = requests[0].body.messages[0].content;
  assert.deepEqual(blocks[0], { type: "text", text: "看" });
  assert.equal(blocks[1].type, "image");
  assert.deepEqual(blocks[1].source, { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" });
});

const reasoningItem = { type: "reasoning", id: "rs_1", encrypted_content: "enc-1", summary: [{ type: "summary_text", text: "想一想" }] };
const callItem = { type: "function_call", id: "fc_1", call_id: "call_1", name: "read_file", arguments: '{"path":"a"}', status: "completed" };
const messageItem = { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "我先读文件", annotations: [] }] };

function responsesTurn(output, { status = "completed", reason } = {}) {
  const events = [{ type: "response.created", response: { id: "resp_1", created_at: 1, model: "m" } }];
  output.forEach((item, index) => {
    if (item.type === "reasoning") {
      events.push({ type: "response.output_item.added", output_index: index, item: { type: "reasoning", id: item.id, encrypted_content: null, summary: [] } });
      events.push({ type: "response.reasoning_summary_part.added", item_id: item.id, output_index: index, summary_index: 0, part: { type: "summary_text", text: "" } });
      events.push({ type: "response.reasoning_summary_text.delta", item_id: item.id, output_index: index, summary_index: 0, delta: item.summary[0].text });
      events.push({ type: "response.reasoning_summary_part.done", item_id: item.id, output_index: index, summary_index: 0, part: item.summary[0] });
    } else if (item.type === "message") {
      events.push({ type: "response.output_item.added", output_index: index, item: { ...item, content: [] } });
      events.push({ type: "response.output_text.delta", item_id: item.id, output_index: index, content_index: 0, delta: item.content[0].text });
    } else {
      events.push({ type: "response.output_item.added", output_index: index, item: { ...item, arguments: "" } });
      events.push({ type: "response.function_call_arguments.delta", item_id: item.id, output_index: index, delta: item.arguments });
    }
    events.push({ type: "response.output_item.done", output_index: index, item });
  });
  events.push({
    type: status === "completed" ? "response.completed" : "response.incomplete",
    response: { id: "resp_1", created_at: 1, model: "m", status, output, usage: { input_tokens: 20, output_tokens: 6, input_tokens_details: { cached_tokens: 10 } }, ...(reason ? { incomplete_details: { reason } } : {}) },
  });
  return responsesStream(events);
}

test(`Responses replays encrypted reasoning, calls and outputs across turns`, async () => {
  const { requests, fetchImpl } = recorder((n) => n === 1
    ? responsesTurn([reasoningItem, messageItem, callItem])
    : responsesTurn([{ ...messageItem, id: "msg_2", content: [{ type: "output_text", text: "完成", annotations: [] }] }]));
  const p = createProvider({ provider: "openai-responses", apiKey: "k", baseUrl: "https://oa.example/v1", model: "gpt-test", reasoningEffort: "low", fetchImpl });
  const deltas = [];
  const first = await p.complete([{ role: "system", content: "规则" }, { role: "user", content: "读 a" }], [tool("read_file")], { onDelta: (d) => deltas.push(d) });
  assert.deepEqual(deltas, ["我先读文件"]);
  assert.equal(first.message.content, "我先读文件");
  assert.deepEqual(first.message.tool_calls, [{ id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a"}' } }]);
  assert.equal(first.usage.input_tokens, 20);
  const kinds = first.message.responseItems.map((i) => i.type);
  assert.deepEqual(kinds, ["reasoning", "message", "function_call"]);
  assert.equal(first.message.responseItems[0].encrypted_content, "enc-1");
  const body0 = requests[0].body;
  assert.equal(requests[0].url, "https://oa.example/v1/responses");
  assert.equal(body0.store, false);
  assert.deepEqual(body0.include, ["reasoning.encrypted_content"]);
  assert.equal(body0.reasoning.effort, "low");
  assert.equal(body0.tools[0].name, "read_file");
  assert.equal(body0.tools[0].strict, false);
  await p.complete([{ role: "system", content: "规则" }, { role: "user", content: "读 a" }, first.message, { role: "tool", tool_call_id: "call_1", content: "内容" }], [tool("read_file")]);
  const input = requests[1].body.input;
  const reasoning = input.find((i) => i.type === "reasoning");
  assert.equal(reasoning.encrypted_content, "enc-1");
  assert.equal(reasoning.id, "rs_1");
  const call = input.find((i) => i.type === "function_call");
  assert.equal(call.call_id, "call_1");
  assert.deepEqual(JSON.parse(call.arguments), { path: "a" });
  const output = input.find((i) => i.type === "function_call_output");
  assert.equal(output.call_id, "call_1");
  assert.equal(output.output, "内容");
  assert.ok(input.indexOf(reasoning) < input.indexOf(call));
});

test(`Responses soft-lands max_output_tokens and fails other incomplete reasons`, async () => {
  const cut = { ...callItem, id: "fc_2", call_id: "call_2", arguments: '{"path":"b' };
  const p = createProvider({ provider: "openai-responses", apiKey: "k", baseUrl: "https://oa.example/v1", model: "gpt-test",
    fetchImpl: async () => responsesTurn([messageItem, callItem], { status: "incomplete", reason: "max_output_tokens" }) });
  const result = await p.complete([{ role: "user", content: "写" }], []);
  assert.equal(result.stopReason, "max_tokens");
  assert.equal(result.message.content, "我先读文件");
  assert.deepEqual(result.message.tool_calls.map((c) => c.id), ["call_1"]);
  assert.equal(result.message.responseItems, undefined);
  assert.ok(cut);
  const filtered = createProvider({ provider: "openai-responses", apiKey: "k", baseUrl: "https://oa.example/v1", model: "gpt-test",
    fetchImpl: async () => responsesTurn([messageItem], { status: "incomplete", reason: "content_filter" }) });
  await assert.rejects(filtered.complete([{ role: "user", content: "写" }], []), (e) => e.code === "PROVIDER_INCOMPLETE");
});

test("resumes checkpoints saved before the AI SDK migration", async () => {
  // 迁移前保存的检查点：Responses 原始输出项、Claude 签名思考块、DeepSeek reasoning_content。
  const responses = recorder(() => responsesTurn([messageItem]));
  const sdkResponses = createProvider({ provider: "openai-responses", apiKey: "k", baseUrl: "https://oa.example/v1", model: "gpt-test", fetchImpl: responses.fetchImpl });
  await sdkResponses.complete([
    { role: "user", content: "读 a" },
    { role: "assistant", content: "我先读文件", responseItems: [reasoningItem, messageItem, callItem], tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a"}' } }] },
    { role: "tool", tool_call_id: "call_1", content: "内容" },
  ], [tool("read_file")]);
  const input = responses.requests[0].body.input;
  assert.equal(input.find((i) => i.type === "reasoning")?.encrypted_content, "enc-1");
  assert.equal(input.find((i) => i.type === "function_call")?.call_id, "call_1");
  assert.equal(input.find((i) => i.type === "function_call_output")?.output, "内容");
  assert.ok(input.some((i) => i.role === "assistant" && JSON.stringify(i.content).includes("我先读文件")));

  const claudeRec = recorder(() => claude([
    claudeStart(),
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "好" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ]));
  const sdkClaude = createProvider({ provider: "anthropic", apiKey: "k", baseUrl: "https://claude.example", model: "claude-test", thinking: "enabled", fetchImpl: claudeRec.fetchImpl });
  await sdkClaude.complete([
    { role: "user", content: "读 a" },
    { role: "assistant", content: null, reasoning_content: "先读", thinkingBlocks: [{ type: "thinking", thinking: "先读", signature: "sig-legacy" }], tool_calls: [{ id: "u1", type: "function", function: { name: "read_file", arguments: '{"path":"a"}' } }] },
    { role: "tool", tool_call_id: "u1", content: "内容" },
  ], [tool("read_file")]);
  const replay = claudeRec.requests[0].body.messages[1].content;
  assert.deepEqual(replay.map((b) => b.type), ["thinking", "tool_use"]);
  assert.equal(replay[0].signature, "sig-legacy");
});
