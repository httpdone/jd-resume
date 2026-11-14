// Agent 自主阅读本机项目：OpenAI 兼容的工具调用（tool calling）循环。
// 工具全部只读，且限定在项目根目录内；复用 project-scan 的忽略目录、密钥文件黑名单和脱敏。
// 探索结束后不在这里出结果：把读到的内容整理成材料，交给 story_from_project 走原有的结构化输出 + 修复 / 重试流程。
import fs from 'node:fs';
import path from 'node:path';
import { loadSettings, isLocalBase } from '../settings.mjs';
import { LlmError, httpMessage, idleTimeouts, splitSseEvents, parseSseEvent } from './llm.mjs';
import {
  scanProject, resolveProjectDir, isSecretFile, redactSecrets, readText, gitFiles, filterList, walk, gitStats, run,
  IGNORE_DIRS, BINARY_EXT, LOCK_FILES, extOf,
} from '../project-scan.mjs';

export const EXPLORE_LIMITS = {
  maxSteps: 20,            // 最多工具调用次数
  maxRounds: 14,           // 最多模型往返轮数
  toolChars: 80000,        // 工具输出累计字符上限
  perCall: 6000,           // 单次工具输出上限
  timeMs: 4 * 60 * 1000,   // 整体时间上限
  searchHits: 60,
  listEntries: 300,
};

export const TOOLS = [
  { type: 'function', function: { name: 'list_dir', description: '列出项目内某个目录的文件和子目录（已排除依赖、构建产物、隐藏目录和密钥文件）', parameters: { type: 'object', properties: { path: { type: 'string', description: '相对项目根目录的路径，根目录用 .' }, depth: { type: 'integer', description: '1 或 2，默认 1' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'read_file', description: '读取项目内一个文本文件的一段（单次最多约 6000 字符）。密钥类文件会被拒绝。', parameters: { type: 'object', properties: { path: { type: 'string', description: '相对项目根目录的文件路径' }, start_line: { type: 'integer', description: '从第几行开始，默认 1' }, max_lines: { type: 'integer', description: '最多读多少行，默认 200' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'search', description: '在项目源码里按正则搜索（不区分大小写），返回「文件:行号: 内容」，最多 60 条', parameters: { type: 'object', properties: { pattern: { type: 'string', description: '正则表达式' }, glob: { type: 'string', description: '可选，文件过滤，如 *.py 或 src/**/*.ts' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'git_log', description: '查看提交记录（日期、作者、提交说明）', parameters: { type: 'object', properties: { author: { type: 'string', description: '可选，作者名或邮箱' }, limit: { type: 'integer', description: '条数，最多 50，默认 30' }, path: { type: 'string', description: '可选，只看某个文件或目录的提交' } } } } },
  { type: 'function', function: { name: 'git_stats', description: '提交统计：总提交数、参与者、时间跨度、本人提交数、改动最多的目录和文件', parameters: { type: 'object', properties: {} } } },
];

const STEP_LABEL = {
  list_dir: (a) => '查看目录 ' + (a.path || '.'),
  read_file: (a) => '读取 ' + (a.path || '') + (a.start_line > 1 ? '（第 ' + a.start_line + ' 行起）' : ''),
  search: (a) => '搜索 ' + (a.pattern || '') + (a.glob ? '（' + a.glob + '）' : ''),
  git_log: (a) => '查看提交记录' + (a.path ? ' ' + a.path : '') + (a.author ? '（' + a.author + '）' : ''),
  git_stats: () => '统计提交数据',
};

// ---------- 沙箱 ----------
function toPosix(p) { return p.split(path.sep).join('/'); }

/** 把模型给的相对路径解析到项目根目录内；越界、符号链接指向外部、依赖目录、密钥文件一律拒绝 */
export function resolveInside(root, rel, { allowIgnored = false } = {}) {
  const raw = String(rel ?? '.').trim().replace(/\\/g, '/') || '.';
  if (path.isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) throw new Error('只能使用相对项目根目录的路径');
  const abs = path.resolve(root, raw);
  const relOut = path.relative(root, abs);
  if (relOut.startsWith('..') || path.isAbsolute(relOut)) throw new Error('路径超出项目目录，已拒绝');
  let real = abs;
  try { real = fs.realpathSync(abs); } catch { throw new Error('不存在：' + (toPosix(relOut) || '.')); }
  const relReal = path.relative(root, real);
  if (relReal.startsWith('..') || path.isAbsolute(relReal)) throw new Error('该路径通过符号链接指向项目外部，已拒绝');
  const parts = toPosix(relReal).split('/').filter(Boolean);
  if (parts.some((p) => isSecretFile(p))) throw Object.assign(new Error('已跳过：可能含密钥'), { secret: true });
  if (!allowIgnored && parts.some((p, i) => IGNORE_DIRS.has(p) || (p.startsWith('.') && p !== '.github' && !(i === parts.length - 1 && !isSecretFile(p) && /^\.(gitignore|editorconfig|prettierrc|eslintrc)/.test(p))))) {
    throw new Error('已跳过：依赖、构建产物或隐藏目录');
  }
  if (parts.some((p) => isSecretFile(p))) throw Object.assign(new Error('已跳过：可能含密钥'), { secret: true });
  return { abs: real, rel: parts.join('/') || '.' };
}

function globToRe(glob) {
  if (!glob) return null;
  let g = String(glob).trim().replace(/\\/g, '/');
  if (!g.includes('/')) g = '**/' + g;
  const re = g.replace(/[.+^${}()|[\]]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '(?:.*/)?');
  return new RegExp('^' + re + '$', 'i');
}

export function createTools(root, { author } = {}) {
  const filesRead = new Set();
  let fileList = null;
  const listFiles = async () => {
    if (fileList) return fileList;
    const listed = await gitFiles(root);
    fileList = (listed ? filterList(listed) : walk(root, Date.now() + 15000)).files;
    return fileList;
  };
  const impl = {
    async list_dir({ path: p = '.', depth = 1 }) {
      const { abs, rel } = resolveInside(root, p);
      if (!fs.statSync(abs).isDirectory()) throw new Error('不是目录：' + rel);
      const max = Math.min(2, Math.max(1, Number(depth) || 1));
      const lines = [];
      const visit = (dir, d, prefix) => {
        let ents;
        try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        ents.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
        for (const e of ents) {
          if (lines.length >= EXPLORE_LIMITS.listEntries) return;
          if (e.isSymbolicLink() || isSecretFile(e.name)) continue;
          if (e.isDirectory()) {
            if (IGNORE_DIRS.has(e.name) || (e.name.startsWith('.') && e.name !== '.github')) continue;
            lines.push(prefix + e.name + '/');
            if (d < max) visit(path.join(dir, e.name), d + 1, prefix + '  ');
          } else if (e.isFile()) {
            let size = 0;
            try { size = fs.statSync(path.join(dir, e.name)).size; } catch { /* 忽略 */ }
            lines.push(prefix + e.name + '  (' + (size >= 1024 ? Math.round(size / 1024) + ' KB' : size + ' B') + ')');
          }
        }
      };
      visit(abs, 1, '');
      return '目录 ' + rel + '：\n' + (lines.join('\n') || '（空）') + (lines.length >= EXPLORE_LIMITS.listEntries ? '\n…（条目过多，已截断）' : '');
    },
    async read_file({ path: p, start_line = 1, max_lines = 200 }) {
      const { abs, rel } = resolveInside(root, p);
      const st = fs.statSync(abs);
      if (!st.isFile()) throw new Error('不是文件：' + rel);
      const name = rel.slice(rel.lastIndexOf('/') + 1);
      if (LOCK_FILES[name]) throw new Error('已跳过：锁文件不读取内容');
      if (BINARY_EXT.has(extOf(name))) throw new Error('已跳过：二进制或媒体文件');
      if (st.size > 4 * 1024 * 1024) throw new Error('文件过大（' + Math.round(st.size / 1024) + ' KB），请用 search 定位后分段读取');
      const text = readText(abs, Math.max(st.size, 1));
      if (text == null) throw new Error('已跳过：不是文本文件');
      const all = text.split('\n');
      const from = Math.max(1, Number(start_line) || 1);
      const n = Math.min(400, Math.max(1, Number(max_lines) || 200));
      const slice = all.slice(from - 1, from - 1 + n);
      let body = slice.map((l, i) => String(from + i).padStart(4) + '  ' + l).join('\n');
      let cut = '';
      if (body.length > EXPLORE_LIMITS.perCall - 200) { body = body.slice(0, EXPLORE_LIMITS.perCall - 200); cut = '\n…（单次输出已达上限，可用 start_line 继续读）'; }
      filesRead.add(rel);
      return '文件 ' + rel + '（共 ' + all.length + ' 行，显示第 ' + from + '-' + Math.min(all.length, from - 1 + n) + ' 行）：\n' + body + cut;
    },
    async search({ pattern, glob }) {
      let re;
      try { re = new RegExp(String(pattern || ''), 'i'); } catch { re = new RegExp(String(pattern || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
      if (!String(pattern || '').trim()) throw new Error('请提供搜索内容');
      const gre = globToRe(glob);
      const hits = [];
      let bytes = 0;
      let filesHit = 0;
      for (const rel of await listFiles()) {
        if (hits.length >= EXPLORE_LIMITS.searchHits || bytes > 30 * 1024 * 1024) break;
        const name = rel.slice(rel.lastIndexOf('/') + 1);
        if (isSecretFile(name) || LOCK_FILES[name] || BINARY_EXT.has(extOf(name)) || /\.min\.(js|css)$/i.test(name)) continue;
        if (gre && !gre.test(rel)) continue;
        if (rel.split('/').some((p) => isSecretFile(p))) continue;
        const abs = path.join(root, rel);
        let size = 0;
        try { const st = fs.lstatSync(abs); if (!st.isFile()) continue; size = st.size; } catch { continue; }
        if (size > 1024 * 1024) continue;
        const text = readText(abs, size + 1);
        if (text == null) continue;
        bytes += size;
        let any = false;
        text.split('\n').forEach((line, i) => {
          if (hits.length < EXPLORE_LIMITS.searchHits && re.test(line)) { hits.push(rel + ':' + (i + 1) + ': ' + line.trim().slice(0, 200)); any = true; }
        });
        if (any) filesHit++;
      }
      return '搜索「' + pattern + '」' + (glob ? '（' + glob + '）' : '') + '：' + hits.length + ' 条，分布在 ' + filesHit + ' 个文件' + (hits.length >= EXPLORE_LIMITS.searchHits ? '（已达上限）' : '') + '\n' + hits.join('\n');
    },
    async git_log({ author: a, limit = 30, path: p }) {
      const n = Math.min(50, Math.max(1, Number(limit) || 30));
      const args = ['log', '--no-merges', '-n', String(n), '--format=%ad %an %s', '--date=short'];
      if (a) args.push('--fixed-strings', '--regexp-ignore-case', '--author=' + String(a));
      args.push('HEAD');
      if (p) { const r = resolveInside(root, p); args.push('--', r.rel); }
      const out = await run('git', args, root);
      if (out == null) return '不是 Git 仓库、没有提交，或本机没有安装 git';
      return '提交记录（' + n + ' 条以内）：\n' + (out.trim() || '（没有匹配的提交）');
    },
    async git_stats() {
      const g = await gitStats(root, author);
      if (!g) return '不是 Git 仓库，或本机没有安装 git';
      if (!g.commits) return '是 Git 仓库，但还没有提交';
      const { subjects, ...rest } = g;
      return JSON.stringify(rest);
    },
  };
  return {
    filesRead,
    async call(name, args) {
      const fn = impl[name];
      if (!fn) return { ok: false, text: '未知工具：' + name };
      try {
        const out = await fn(args || {});
        const r = redactSecrets(out);
        return { ok: true, text: r.text, redactions: r.hits };
      } catch (e) {
        return { ok: false, text: e.message, secret: Boolean(e.secret) };
      }
    },
  };
}

// ---------- 一次带工具的流式请求 ----------
export function isToolRejection(status, text) {
  const code = Number(status);
  if (code !== 400 && code !== 404 && code !== 422 && code !== 501) return false;
  return /tool|function[ _-]?call|functions|unsupported|not support|unknown parameter|unrecognized/i.test(String(text || ''));
}

async function chatWithTools({ messages, tools, signal, onThinking, cfg }) {
  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const idle = idleTimeouts();
  const ctl = new AbortController();
  let timedOut = 0;
  let timer = null;
  const arm = (ms) => { clearTimeout(timer); timer = setTimeout(() => { timedOut = ms; ctl.abort(); }, ms); };
  const onAbort = () => ctl.abort();
  if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  let maxTokens = Number(cfg.maxTokens || 32768);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const body = { model: cfg.model, messages, tools, tool_choice: 'auto', stream: true, temperature: Number(cfg.temperature ?? 0.4), max_tokens: maxTokens };
      arm(idle.first);
      let res;
      try {
        res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (cfg.apiKey || 'none'), accept: 'text/event-stream' }, body: JSON.stringify(body), signal: ctl.signal });
      } catch (error) {
        if (timedOut) throw new LlmError('模型超过 ' + Math.round(timedOut / 1000) + ' 秒没有返回内容', 'timeout');
        if (error.name === 'AbortError') throw new LlmError('请求已取消', 'aborted');
        throw new LlmError('无法连接到 ' + url + '：' + (error.cause?.message || error.message), 'network');
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (res.status === 400 && maxTokens > 8192 && /max_tokens|max_completion_tokens|maximum.*tokens|token.*limit/i.test(text)) { maxTokens = 8192; continue; }
        const err = httpMessage(res, text);
        if (isToolRejection(res.status, text)) err.code = 'tools_unsupported';
        throw err;
      }
      arm(idle.stream);
      const out = { content: '', reasoning: '', toolCalls: [], finishReason: '' };
      const ctype = res.headers.get('content-type') || '';
      if (!ctype.includes('event-stream')) {
        const data = await res.json();
        const ch = data.choices?.[0] || {};
        out.content = ch.message?.content || '';
        out.reasoning = ch.message?.reasoning_content || '';
        out.toolCalls = (ch.message?.tool_calls || []).map((t) => ({ id: t.id, name: t.function?.name, args: t.function?.arguments || '' }));
        out.finishReason = ch.finish_reason || '';
        if (out.reasoning) onThinking?.(out.reasoning);
        return out;
      }
      const decoder = new TextDecoder();
      let buffer = '';
      const take = (raw) => {
        const { data } = parseSseEvent(raw);
        if (!data || data === '[DONE]') return;
        let obj;
        try { obj = JSON.parse(data); } catch { return; }
        if (obj.error) throw new LlmError('模型返回错误：' + (obj.error.message || JSON.stringify(obj.error)));
        const ch = obj.choices?.[0] || {};
        const d = ch.delta || ch.message || {};
        const r = d.reasoning_content || d.reasoning;
        if (r) { out.reasoning += r; onThinking?.(r); }
        if (typeof d.content === 'string') out.content += d.content;
        for (const tc of d.tool_calls || []) {
          const i = Number.isInteger(tc.index) ? tc.index : out.toolCalls.length;
          const slot = out.toolCalls[i] || (out.toolCalls[i] = { id: '', name: '', args: '' });
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name += tc.function.name;
          if (tc.function?.arguments) slot.args += tc.function.arguments;
        }
        if (ch.finish_reason) out.finishReason = ch.finish_reason;
      };
      for await (const chunk of res.body) {
        arm(idle.stream);
        buffer += decoder.decode(chunk, { stream: true });
        const { events, rest } = splitSseEvents(buffer);
        buffer = rest;
        for (const ev of events) take(ev);
      }
      buffer += decoder.decode();
      const { events, rest } = splitSseEvents(buffer + '\n\n');
      for (const ev of events) take(ev);
      if (rest.trim()) take(rest);
      out.toolCalls = out.toolCalls.filter(Boolean).map((t, i) => ({ ...t, id: t.id || 'call_' + i + '_' + Date.now().toString(36) }));
      return out;
    }
    throw new LlmError('模型接口拒绝了请求', 'http_400');
  } catch (error) {
    if (timedOut && error.name === 'AbortError') throw new LlmError('模型超过 ' + Math.round(timedOut / 1000) + ' 秒没有返回内容', 'timeout');
    if (error.name === 'AbortError') throw new LlmError('请求已取消', 'aborted');
    throw error;
  } finally {
    clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort);
  }
}

function explorePrompt(overview, note) {
  return [
    { role: 'system', content: `你是「简历 Agent」的项目阅读助手。用户把本机一个项目目录交给你，目标是为他写一条经历素材（STAR）收集证据。你可以调用只读工具 list_dir / read_file / search / git_log / git_stats 自己决定看哪些文件。
要求：
1. 先看下面程序给出的概览（目录树、依赖清单、统计、提交摘要），不要重复读概览里已经完整给出的内容。
2. 优先读：入口文件、路由 / 接口定义、核心业务模块、数据模型、部署配置；以及「本人改动最多」的目录和文件。用 search 统计或定位（如路由、数据表、关键类），用 git_log 看本人做过什么。
3. 预算有限：最多 ${EXPLORE_LIMITS.maxSteps} 次工具调用，工具输出累计不超过 ${EXPLORE_LIMITS.toolChars} 字符，总时长 ${Math.round(EXPLORE_LIMITS.timeMs / 60000)} 分钟。大文件先 search 再分段读，不要整读。
4. 不要尝试读取 .env、密钥、证书、凭据类文件，也不要访问项目目录以外的路径（会被拒绝）。
5. 证据够了就停止调用工具，用几句中文写下你确认了哪些事实（做了什么、用了什么技术、能数出来的数字及口径、本人的改动集中在哪），以及哪些代码证明不了（用户规模、性能、上线、分工等）。不要编造。` },
    { role: 'user', content: (note ? '【用户补充说明（可信）】\n' + note + '\n\n' : '') + overview },
  ];
}

/**
 * 运行探索。返回 { payload, summary, filesRead, steps, fallback }。
 * payload 是给 story_from_project 最终一步用的材料（概览 + 阅读记录）。
 */
export async function exploreProject({ path: input, author = {}, note = '', signal, useMock = false, model, onStep, onThinking }) {
  const root = resolveProjectDir(input);
  onStep?.({ text: '扫描项目概览…', kind: 'scan' });
  const overview = await scanProject({ path: root, author, lite: true });
  const tools = createTools(root, { author });
  const log = [];
  let used = 0;
  let steps = 0;
  let redactions = 0;
  let stopReason = '';
  const started = Date.now();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), EXPLORE_LIMITS.timeMs);
  const onUser = () => deadline.abort();
  signal?.addEventListener?.('abort', onUser, { once: true });

  const exec = async (name, argsRaw) => {
    let args = {};
    try { args = typeof argsRaw === 'string' ? (argsRaw.trim() ? JSON.parse(argsRaw) : {}) : (argsRaw || {}); } catch { args = {}; }
    const label = (STEP_LABEL[name] || (() => name))(args);
    if (steps >= EXPLORE_LIMITS.maxSteps || used >= EXPLORE_LIMITS.toolChars) {
      return '预算已用完，请停止调用工具，直接写结论。';
    }
    steps++;
    const r = await tools.call(name, args);
    redactions += r.redactions || 0;
    let text = r.text;
    const room = EXPLORE_LIMITS.toolChars - used;
    if (text.length > room) text = text.slice(0, Math.max(0, room)) + '\n…（工具输出预算用尽）';
    used += text.length;
    onStep?.({ text: label + (r.ok ? '' : ' — ' + r.text), kind: name, ok: r.ok, n: steps });
    log.push({ name, label, ok: r.ok, text });
    return r.ok ? text : '失败：' + text;
  };

  let fallback = '';
  let conclusion = '';
  try {
    if (useMock) {
      // 演示模式：固定的几步探索，离线可测
      const files = overview.summary.sent.filter((f) => f.kind === '清单' || f.kind === 'README').map((f) => f.file);
      await exec('list_dir', JSON.stringify({ path: '.', depth: 1 }));
      const s = await exec('search', JSON.stringify({ pattern: '\\.(get|post|put|delete)\\s*\\(|@(Get|Post)Mapping|@app\\.route' }));
      const firstHit = (s.split('\n')[1] || '').split(':')[0];
      const entry = firstHit || files.find((f) => !/README/i.test(f)) || '';
      if (entry) await exec('read_file', JSON.stringify({ path: entry, max_lines: 80 }));
      await exec('git_stats', '{}');
      conclusion = '（演示）已查看目录结构、接口定义和提交统计；用户规模、性能、上线情况代码里证明不了。';
    } else {
      const { llm } = loadSettings();
      const cfg = { ...llm, model: model || llm.model };
      if (!cfg.baseUrl || !cfg.model) throw new LlmError('还没有配置大模型', 'not_configured');
      if (!cfg.apiKey && !isLocalBase(cfg.baseUrl)) throw new LlmError('还没有配置 API Key', 'not_configured');
      const messages = explorePrompt(overview.payload, note);
      for (let round = 0; round < EXPLORE_LIMITS.maxRounds; round++) {
        if (deadline.signal.aborted) { stopReason = signal?.aborted ? 'aborted' : 'time'; break; }
        if (steps >= EXPLORE_LIMITS.maxSteps || used >= EXPLORE_LIMITS.toolChars) { stopReason = 'budget'; break; }
        let r;
        try {
          r = await chatWithTools({ messages, tools: TOOLS, signal: deadline.signal, onThinking, cfg });
        } catch (error) {
          if (error.code === 'tools_unsupported' && round === 0) { fallback = error.message; break; }
          if (error.code === 'aborted' && !signal?.aborted) { stopReason = 'time'; break; }
          throw error;
        }
        if (!r.toolCalls.length) { conclusion = r.content.trim(); break; }
        // 原样带回 assistant 的工具调用；推理模型（如 Kimi）要求把 reasoning_content 一并传回
        const msg = { role: 'assistant', content: r.content || null, tool_calls: r.toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.args || '{}' } })) };
        if (r.reasoning) msg.reasoning_content = r.reasoning;
        messages.push(msg);
        for (const t of r.toolCalls) {
          const out = await exec(t.name, t.args);
          messages.push({ role: 'tool', tool_call_id: t.id, content: out });
        }
      }
      if (!stopReason && !conclusion && !fallback) stopReason = 'rounds';
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onUser);
  }
  if (signal?.aborted) throw new LlmError('请求已取消', 'aborted');

  if (fallback) {
    onStep?.({ text: '当前模型接口不支持工具调用，已自动改用固定扫描', kind: 'fallback', ok: false });
    const full = await scanProject({ path: root, author });
    return { payload: full.payload, summary: full.summary, filesRead: full.summary.sent.map((f) => f.file), steps: 0, fallback, ms: Date.now() - started };
  }
  if (stopReason) onStep?.({ text: { time: '已到时间上限，', budget: '已用完阅读预算，', rounds: '已到轮数上限，' }[stopReason] + '开始整理素材', kind: 'stop' });
  else onStep?.({ text: '阅读完成，开始整理素材', kind: 'stop' });

  const readList = [...tools.filesRead];
  const base = overview.summary.sent.filter((f) => !/^（/.test(f.file)).map((f) => f.file);
  const payload = overview.payload
    + '\n\n=== Agent 阅读记录（共 ' + log.length + ' 次工具调用）===\n'
    + log.map((l) => '--- ' + l.label + (l.ok ? '' : '（失败）') + ' ---\n' + l.text).join('\n')
    + (conclusion ? '\n\n=== 阅读结论（Agent 草记，仍以上面的原文为准）===\n' + redactSecrets(conclusion).text.slice(0, 4000) : '')
    + '\n\n=== 实际读取过的文件（evidence 只能引用这些，或「统计结果」「git log」「目录树」）===\n' + [...new Set([...base, ...readList])].join('\n');
  return {
    payload,
    summary: { ...overview.summary, explore: { steps, toolChars: used, redactions, filesRead: readList, stopReason: stopReason || 'done' } },
    filesRead: [...new Set([...base, ...readList])],
    steps,
    fallback: '',
    ms: Date.now() - started,
  };
}

/** evidence 只保留实际读过的文件或程序统计项 */
export function filterEvidence(data, filesRead) {
  if (!data || !Array.isArray(data.evidence)) return data;
  const allow = new Set((filesRead || []).map((f) => String(f).replace(/^\.\//, '')));
  const generic = /^(（?统计结果）?|（?git log）?|（?目录树）?|git_stats|提交统计|用户补充说明)$/i;
  data.evidence = data.evidence.filter((e) => {
    const f = String(e.file || '').replace(/[`'"]/g, '').replace(/^\.\//, '').replace(/[:#]\d+(-\d+)?$/, '').trim();
    return generic.test(f) || allow.has(f);
  });
  return data;
}
