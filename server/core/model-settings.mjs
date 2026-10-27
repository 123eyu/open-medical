import { createHash } from 'node:crypto';
import { resolveModelContext } from '../../shared/model-context.mjs';
import { CredentialVault } from './oauth.mjs';
import { createProvider } from './providers.mjs';
import { check, AppError } from '../errors.mjs';
import { contextBudget, assertContextBudget } from './context-budget.mjs';

function validateBudget(config) {
  const provider = createProvider(config);
  // Validate the saved budget before the connection probe replaces maxTokens.
  assertContextBudget(contextBudget({ provider, thinking: provider.provider === 'anthropic' ? 'enabled' : undefined }));
}

const kinds = ['deepseek', 'openai', 'openai-compatible', 'openai-responses', 'anthropic', 'local'];
const key = 'platform:model-settings:v1';
const fingerprint = c => createHash('sha256').update(JSON.stringify({
  provider: c.provider, baseUrl: c.baseUrl?.replace(/\/$/, ''), model: c.model, apiKey: c.apiKey || '',
  vision: c.vision === true, timeoutMs: c.timeoutMs || 90000, maxTokens: c.maxTokens || 8192, contextWindow: c.contextWindow ?? null,
})).digest('hex');
export class ModelSettings {
  constructor(db, directory, initial) {
    this.vault = new CredentialVault(db, directory);
    this.initial = initial;
    this.saved = this.vault.get(key);
    this.tests = new Map();
    this.testGenerations = new Map();
  }
  provider() { return this.saved.provider ? createProvider(this.saved) : this.initial; }
  configuration() {
    const p = this.provider();
    return this.saved.provider ? this.saved : { provider: p.local ? 'local' : p.provider, baseUrl: p.baseUrl, model: p.model,
      apiKey: p.apiKey || '', vision: p.vision === true, timeoutMs: p.timeoutMs || 90000, maxTokens: p.maxTokens || 8192, contextWindow: p.contextWindow };
  }
  testRecord(config = this.configuration()) {
    return this.tests?.get(fingerprint(config)) || { status: 'untested', checkedAt: null, checks: [], message: '本次启动尚未测试此连接。' };
  }
  public() {
    const p = this.provider();
    return { provider: this.saved.provider || (p.local ? 'local' : p.provider), baseUrl: p.baseUrl || '', model: p.model || '', hasKey: Boolean(p.apiKey), vision: p.vision === true, source: this.saved.provider ? 'saved' : 'environment', timeoutMs: p.timeoutMs || 90000, contextWindow: p.contextWindow ?? null, contextDefaults: resolveModelContext(p), maxTokens: p.maxTokens || 8192, test: this.testRecord() };
  }
  candidate(body) {
    check(kinds.includes(body.provider), 'MODEL_SETTINGS', '请选择支持的模型协议');
    for (const field of ['baseUrl', 'model']) check(typeof body[field] === 'string' && body[field].trim().length > 0 && body[field].length <= 500, 'MODEL_SETTINGS', '请填写有效的接口地址和模型名称');
    let url;
    try { url = new URL(body.baseUrl.trim()); } catch { throw new AppError('MODEL_SETTINGS', '接口地址格式无效', 400); }
    check(!url.username && !url.password && !url.search && !url.hash, 'MODEL_SETTINGS', '接口地址不能包含账号、密码、查询参数或片段');
    check(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)), 'MODEL_SETTINGS', '请使用 HTTPS；本地模型允许回环 HTTP 地址');
    check(body.provider !== 'local' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'MODEL_SETTINGS', '本机模型只能使用本机回环地址；远端服务请选择对应接口协议并确认资料处理授权');
    const baseUrl = url.href.replace(/\/$/, '');
    const existing = this.provider(), previous = this.public();
    check(body.apiKey === undefined || (typeof body.apiKey === 'string' && body.apiKey.length <= 8192), 'MODEL_SETTINGS', '密钥格式无效');
    const apiKey = body.apiKey?.trim() || (body.provider === previous.provider && baseUrl === previous.baseUrl.replace(/\/$/, '') ? existing.apiKey : '');
    check(body.provider === 'local' || Boolean(apiKey), 'MODEL_SETTINGS', '请填写 API Key；更换协议或接口地址时须重新输入密钥');
    const config = { provider: body.provider, baseUrl, model: body.model.trim(), apiKey: apiKey || '', timeoutMs: Number(body.timeoutMs ?? 90000), maxTokens: Number(body.maxTokens ?? 8192) };
    if (body.contextWindow != null) config.contextWindow = Number(body.contextWindow);
    else if (body.contextWindow === undefined && body.provider === previous.provider && baseUrl === previous.baseUrl.replace(/\/$/, '') && body.model.trim() === previous.model && existing.contextWindow) config.contextWindow = existing.contextWindow;
    // 图片能力由用户声明:勾选后图片资料可直接交给该模型读取;未勾选则走本机 OCR。
    config.vision = body.vision === true || (!Object.hasOwn(body, 'vision') && previous.vision === true && body.provider === previous.provider && body.model.trim() === previous.model);
    validateBudget(config);
    return config;
  }
  save(config) { this.vault.set(key, config); this.saved = config; return this.provider(); }
  async test(config, { signal } = {}) {
    validateBudget(config);
    const start = Date.now(), id = fingerprint(config), token = Symbol();
    this.testGenerations.set(id, token);
    const finish = (status, checks, message) => {
      const record = { status, checkedAt: new Date().toISOString(), checks, message };
      if (this.testGenerations.get(id) === token) {
        this.tests.set(id, record);
        this.testGenerations.delete(id);
        if (this.tests.size > 100) this.tests.delete(this.tests.keys().next().value);
      }
      return record;
    };
    const deadline = AbortSignal.timeout(30000);
    const probeSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const p = createProvider({ ...config, timeoutMs: Math.min(config.timeoutMs, 30000), maxTokens: 256 });
    const run = async (id, fn) => {
      const began = Date.now();
      try { probeSignal.throwIfAborted(); const message = await fn(); probeSignal.throwIfAborted(); return { id, ok: true, message, durationMs: Date.now() - began }; }
      catch (error) { return { id, ok: false, message: error instanceof AppError && error.code === 'MODEL_TEST' ? error.message : '请求失败或超时', durationMs: Date.now() - began }; }
    };
    const text = await run('text', async () => {
      const result = await p.complete([{ role: 'user', content: 'Reply with OK.' }], [], { signal: probeSignal });
      check(Boolean(result?.message?.content), 'MODEL_TEST', '模型未返回文本');
      return '文本生成正常';
    });
    if (!text.ok) {
      const message = signal?.aborted ? '连接测试已取消，未确认可用。' : '连接测试失败。请检查接口地址、模型名称、密钥权限和网络；测试最长等待 30 秒。';
      finish(signal?.aborted ? 'cancelled' : 'failed', [text], message);
      throw new AppError('MODEL_TEST', message, 400);
    }
    // Tool calling and JSON output decide whether the model can drive the agent;
    // failures are reported, not fatal, so text-only models remain usable.
    const tools = await run('tools', async () => {
      const tool = { type: 'function', function: { name: 'report_ready', description: 'Report readiness status.', parameters: { type: 'object', properties: { status: { type: 'string', enum: ['ready'] } }, required: ['status'], additionalProperties: false } } };
      const result = await p.complete([{ role: 'user', content: 'Call the report_ready tool with status "ready". Do not answer in text.' }], [tool], { signal: probeSignal });
      check(result?.message?.tool_calls?.some((call) => call.function?.name === 'report_ready'), 'MODEL_TEST', '该模型不支持工具调用，Agent 能力将受限');
      return '工具调用正常';
    });
    const json = await run('json', async () => {
      const result = await p.complete([{ role: 'user', content: 'Return only a JSON object {"ok": true} with no other text.' }], [], { signal: probeSignal });
      const raw = String(result?.message?.content || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
      let value;
      try { value = JSON.parse(raw); } catch { throw new AppError('MODEL_TEST', '未能输出有效 JSON，自动分诊等结构化功能可能不稳定'); }
      check(value && typeof value === 'object' && !Array.isArray(value), 'MODEL_TEST', '未能输出 JSON 对象，自动分诊等结构化功能可能不稳定');
      return 'JSON 输出正常';
    });
    const checks = [text, tools, json];
    const failed = checks.filter((item) => !item.ok);
    const status = signal?.aborted ? 'cancelled' : deadline.aborted ? 'failed' : failed.length ? 'partial' : 'passed';
    const message = status === 'cancelled' ? '连接测试已取消，未确认全部能力。' : status === 'failed' ? '连接测试超时，未确认全部能力。'
      : failed.length ? `文本通过，部分能力受限：${failed.map(item => item.message).join('；')}。` : '本次测试通过：文本、工具调用和 JSON 输出均正常。';
    const record = finish(status, checks, message);
    return { ok: !['failed', 'cancelled'].includes(status), durationMs: Date.now() - start, checks, message, test: record };
  }
}
