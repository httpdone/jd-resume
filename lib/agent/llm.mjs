// OpenAI 兼容接口调用（流式），用 Node 18+ 自带 fetch，不引依赖
import { loadSettings, isLocalBase } from '../settings.mjs';

export class LlmError extends Error {
  constructor(message, code = 'llm_error') { super(message); this.code = code; }
}

export function llmReady() {
  const { llm, mock } = loadSettings();
  if (mock) return { ok: true, mock: true };
  if (!llm.baseUrl || !llm.model) return { ok: false, reason: '未配置 Base URL 或模型名' };
  if (!llm.apiKey && !isLocalBase(llm.baseUrl)) return { ok: false, reason: '未配置 API Key' };
  return { ok: true, mock: false };
}

const MODE_SCHEMA = 'json_schema';
const MODE_OBJECT = 'json_object';
const MODE_OFF = 'off';
const FORMAT_MODES = [MODE_SCHEMA, MODE_OBJECT, MODE_OFF];

// 按「Base URL + 模型」记住哪种输出模式可用，避免每次都先撞一次不支持的 json_schema
const modeCache = new Map();

export function resetStructuredOutputCache() { modeCache.clear(); }
export function structuredOutputCache() { return modeCache; }

function cacheKey(cfg) {
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '').toLowerCase();
  return base + '|' + String(cfg.model || '');
}

function cacheOf(cfg) {
  const k = cacheKey(cfg);
  if (!modeCache.has(k)) modeCache.set(k, { ok: '', failed: new Set() });
  return modeCache.get(k);
}

export function normalizeStructuredOutput(value, { jsonMode } = {}) {
  if (jsonMode === false) return MODE_OFF;
  const v = String(value || 'auto').trim().toLowerCase().replace(/-/g, '_');
  if (v === 'json_schema' || v === 'schema') return MODE_SCHEMA;
  if (v === 'json_object' || v === 'json' || v === 'jsonmode') return MODE_OBJECT;
  if (v === 'off' || v === 'none' || v === 'false' || v === '0') return MODE_OFF;
  return 'auto';
}

export function wrapJsonSchema(schema, name = 'result') {
  if (!schema) return null;
  if (schema.schema && schema.type !== 'object') {
    return {
      name: String(schema.name || name).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'result',
      strict: schema.strict !== false,
      schema: schema.schema,
    };
  }
  if (schema.type === 'object') {
    return { name: String(name).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'result', strict: true, schema };
  }
  return null;
}

function planModes({ json, schema, cfg }) {
  if (!json) return [MODE_OFF];
  const pref = normalizeStructuredOutput(cfg.structuredOutput, { jsonMode: cfg.jsonMode });
  if (pref === MODE_OFF) return [MODE_OFF];
  let order;
  if (pref === MODE_OBJECT) order = [MODE_OBJECT, MODE_OFF];
  else if (pref === MODE_SCHEMA) order = schema ? [MODE_SCHEMA, MODE_OBJECT, MODE_OFF] : [MODE_OBJECT, MODE_OFF];
  else order = schema ? [MODE_SCHEMA, MODE_OBJECT, MODE_OFF] : [MODE_OBJECT, MODE_OFF];
  const cache = cacheOf(cfg);
  const failed = cache.failed;
  const usable = order.filter((m) => m === MODE_OFF || !failed.has(m));
  if (cache.ok && usable.includes(cache.ok)) {
    return [cache.ok, ...usable.filter((m) => m !== cache.ok)];
  }
  return usable.length ? usable : [MODE_OFF];
}

function responseFormatFor(mode, schema) {
  if (mode === MODE_SCHEMA && schema) return { type: 'json_schema', json_schema: schema };
  if (mode === MODE_OBJECT) return { type: 'json_object' };
  return undefined;
}

export function isFormatRejection(status, text) {
  const code = Number(status);
  if (code !== 400 && code !== 422 && code !== 415) return false;
  return /response_format|json_schema|json_object|structured[ _-]?output|unsupported|not support|unavailable now|unknown parameter|unrecognized request|invalid[_ ]schema/i.test(String(text || ''));
}

export function httpMessage(res, text) {
  let msg = text;
  try { msg = JSON.parse(text).error?.message || text; } catch { /* 原样 */ }
  const hint = res.status === 401 ? '（API Key 无效）' : res.status === 404 ? '（Base URL 或模型名不对）' : res.status === 429 ? '（额度不足或请求太频繁）' : '';
  const err = new LlmError('模型接口返回 ' + res.status + hint + '：' + String(msg).slice(0, 400), 'http_' + res.status);
  err.status = res.status;
  err.body = text;
  return err;
}

// onDelta(text) 每收到一段正文就回调；onThinking(text) 推理模型的思考过程
// schema：{name, strict, schema} 或根为 type:object 的 JSON Schema；json:true 时走结构化输出回退链
export async function streamChat({ messages, json = false, schema, signal, onDelta, onThinking, override } = {}) {
  const { llm } = loadSettings();
  const cfg = { ...llm, ...(override || {}) };
  if (!cfg.baseUrl || !cfg.model) throw new LlmError('还没有配置大模型：请到「设置」填写 Base URL、API Key 和模型名，或打开演示模式', 'not_configured');
  if (!cfg.apiKey && !isLocalBase(cfg.baseUrl)) throw new LlmError('还没有配置 API Key：请到「设置」填写，或设置环境变量 LLM_API_KEY', 'not_configured');

  const wrapped = json ? wrapJsonSchema(schema, schema?.name || 'result') : null;
  const modes = planModes({ json, schema: wrapped, cfg });
  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';

  const idle = idleTimeouts();
  const ctl = new AbortController();
  let timedOut = 0;
  let timer = null;
  const arm = (ms) => { clearTimeout(timer); timer = setTimeout(() => { timedOut = ms; ctl.abort(); }, ms); };
  const onUserAbort = () => ctl.abort();
  if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', onUserAbort, { once: true }); }
  const fail = (error) => {
    if (timedOut) return new LlmError('模型超过 ' + Math.round(timedOut / 1000) + ' 秒没有返回内容，已中断。可稍后重试，或换一个响应更快的模型。', 'timeout');
    if (signal?.aborted || error?.name === 'AbortError') return new LlmError('请求已取消', 'aborted');
    return error;
  };

  try {
    let lastErr;
    let maxTokens = Number(cfg.maxTokens || 32768);
    for (let i = 0; i < modes.length; i++) {
      const mode = modes[i];
      const body = {
        model: cfg.model,
        messages,
        stream: true,
        temperature: Number(cfg.temperature ?? 0.4),
        max_tokens: maxTokens,
      };
      const rf = responseFormatFor(mode, wrapped);
      if (rf) body.response_format = rf;
      timedOut = 0;
      arm(idle.first);
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (cfg.apiKey || 'none'), accept: 'text/event-stream' },
          body: JSON.stringify(body),
          signal: ctl.signal,
        });
      } catch (error) {
        throw fail(error.name === 'AbortError' || error.name === 'TimeoutError' ? error : new LlmError('无法连接到 ' + url + '：' + (error.cause?.message || error.message), 'network'));
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        // 有的模型输出上限低于设置值（如 8192）：自动降到 8192 再试同一种格式
        if (res.status === 400 && maxTokens > 8192 && /max_tokens|max_completion_tokens|maximum.*tokens|token.*limit/i.test(text)) {
          maxTokens = 8192; i--; continue;
        }
        if (i < modes.length - 1 && isFormatRejection(res.status, text)) {
          cacheOf(cfg).failed.add(mode);
          if (cacheOf(cfg).ok === mode) cacheOf(cfg).ok = '';
          continue;
        }
        throw httpMessage(res, text);
      }
      cacheOf(cfg).ok = mode;
      arm(idle.stream);
      try {
        const meta = {};
        const full = await readOkResponse(res, { onDelta, onThinking, onChunk: () => arm(idle.stream), meta });
        if (!String(full).trim()) {
          // 推理模型把输出额度全花在思考上，正文为空
          if (meta.finishReason === 'length') {
            throw new LlmError('模型的思考过程用完了输出长度上限（max_tokens=' + body.max_tokens + '），没来得及输出结果。请在「设置」里把「最大输出 Token」调大（如 32768），或换用不带深度思考的模型。', 'empty_length');
          }
          // 少数模型把 JSON 放进了思考字段：尝试从中取出
          if (json && meta.reasoning && meta.reasoning.includes('{')) return meta.reasoning;
          throw new LlmError('模型没有返回正文内容' + (meta.finishReason ? '（结束原因：' + meta.finishReason + '）' : '') + '，请重试或换一个模型。', 'empty');
        }
        return full;
      } catch (error) {
        throw fail(error);
      }
    }
    throw lastErr || new LlmError('模型接口不支持当前的输出格式', 'http_400');
  } finally {
    clearTimeout(timer); signal?.removeEventListener?.('abort', onUserAbort);
  }
}

async function readOkResponse(res, hooks) {
  const ctype = res.headers.get('content-type') || '';
  if (!ctype.includes('event-stream')) {
    const data = await res.json();
    const ch = data.choices?.[0] || {};
    const full = ch.message?.content || '';
    if (hooks.meta) { hooks.meta.finishReason = ch.finish_reason || ''; hooks.meta.reasoning = ch.message?.reasoning_content || ''; }
    hooks.onDelta?.(full);
    return full;
  }
  return consumeOpenAiStream(res.body, hooks);
}

export function idleTimeouts() {
  const n = (v, d) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : d; };
  const stream = n(process.env.LLM_IDLE_TIMEOUT_MS, 120000);
  return { first: n(process.env.LLM_FIRST_BYTE_TIMEOUT_MS, 60000), stream };
}

// 按 SSE 事件（空行分隔）解析，而不是按单行 JSON。这样跨 TCP 包的事件、多行 data: 都能拼完整。
export function splitSseEvents(buffer) {
  const norm = String(buffer || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = [];
  let rest = norm;
  let idx;
  while ((idx = rest.indexOf('\n\n')) >= 0) {
    parts.push(rest.slice(0, idx));
    rest = rest.slice(idx + 2);
  }
  return { events: parts, rest };
}

export function parseSseEvent(raw) {
  const dataLines = [];
  let event = '';
  for (const line of String(raw || '').split('\n')) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    else if (line.startsWith('event:')) event = line.slice(6).trim();
  }
  return { event, data: dataLines.join('\n') };
}

export async function consumeOpenAiStream(body, { onDelta, onThinking, onChunk, meta } = {}) {
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let reasoningAll = '';
  const take = (raw) => {
    const { data } = parseSseEvent(raw);
    if (!data || data === '[DONE]') return;
    let obj;
    try { obj = JSON.parse(data); } catch { return; }
    if (obj.error) throw new LlmError('模型返回错误：' + (obj.error.message || JSON.stringify(obj.error)));
    const choice = obj.choices?.[0] || {};
    const delta = choice.delta || {};
    const reasoning = delta.reasoning_content || delta.reasoning || choice.delta?.reasoning_content;
    if (reasoning) { reasoningAll += reasoning; onThinking?.(reasoning); }
    if (choice.finish_reason && meta) meta.finishReason = choice.finish_reason;
    const piece = delta.content || (typeof choice.message?.content === 'string' && !delta.content ? '' : delta.content);
    const text = typeof delta.content === 'string' ? delta.content
      : Array.isArray(delta.content) ? delta.content.map((c) => c?.text || c).join('')
      : '';
    if (text) { full += text; onDelta?.(text); }
  };
  for await (const chunk of body) {
    onChunk?.();
    buffer += decoder.decode(chunk, { stream: true });
    const { events, rest } = splitSseEvents(buffer);
    buffer = rest;
    for (const ev of events) take(ev);
  }
  buffer += decoder.decode();
  const { events, rest } = splitSseEvents(buffer + (buffer.endsWith('\n') ? '\n' : '\n\n'));
  for (const ev of events) take(ev);
  if (rest.trim()) take(rest);
  if (meta) meta.reasoning = reasoningAll;
  return full;
}

export function stripThink(text) {
  let s = String(text || '');
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // 未闭合的思考链：切到 JSON / 代码围栏之前，避免把正文一起删掉
  s = s.replace(/<think>[\s\S]*?(?=```|\{)/i, '');
  s = s.replace(/<\/?think>/gi, '');
  return s.trim();
}

// 宽松地从模型输出中取出 JSON 对象
export function extractJson(text) {
  if (!text) throw new Error('模型没有返回内容');
  let s = stripThink(text);
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型输出里没有 JSON');
  let body = s.slice(start, end + 1);
  try { return JSON.parse(body); } catch { /* 修复 */ }
  body = body.replace(/[\u201c\u201d]/g, (m) => (m === '\u201c' ? '「' : '」'));
  try { return JSON.parse(body.replace(/,\s*([}\]])/g, '$1')); } catch { /* 继续修复 */ }
  try { return JSON.parse(repairJson(body)); } catch (error) {
    const e = new Error('模型输出的 JSON 解析失败：' + error.message);
    e.code = 'parse';
    throw e;
  }
}

// 修复模型常见的 JSON 毛病：字符串里未转义的英文双引号、裸换行、元素之间缺逗号
export function repairJson(src) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') { out += c + (src[i + 1] ?? ''); i++; continue; }
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') continue;
      if (c === '\t') { out += '\\t'; continue; }
      if (c === '"') {
        // 后面紧跟结构字符才算字符串结束，否则是正文里的引号
        let j = i + 1;
        while (j < src.length && /\s/.test(src[j])) j++;
        const n = src[j];
        if (n === undefined || n === ',' || n === '}' || n === ']' || n === ':') { inStr = false; out += c; }
        else if (n === '"' && /\n/.test(src.slice(i + 1, j))) { inStr = false; out += c; } // 换行后紧跟新字符串：缺逗号，下面补
        else out += '\\"';
        continue;
      }
      out += c;
    } else {
      if (c === '"') {
        // 上一个有效字符是值的结尾（" } ] 数字）却没有逗号：补逗号
        const prev = out.replace(/\s+$/, '').slice(-1);
        if (prev && /["}\]\d]/.test(prev) && !/[:,\[{]/.test(prev)) out = out.replace(/\s+$/, '') + ',';
        inStr = true; out += c; continue;
      }
      if (c === '{' || c === '[') {
        const prev = out.replace(/\s+$/, '').slice(-1);
        if (prev && /["}\]]/.test(prev)) out = out.replace(/\s+$/, '') + ',';
      }
      out += c;
    }
  }
  return out
    .replace(/,\s*([}\]])/g, '$1');
}

