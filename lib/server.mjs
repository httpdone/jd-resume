// 简历平台 Web 服务：纯 Node http，零依赖
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ASSETS_DIR, OUT_DIR, PUBLIC_DIR, HOME, HOME_MODE } from './config.mjs';
import { initUserData, importExamples, wipeUserData, dataInfo } from './userdata.mjs';
import {
  listResumes, readBody, writeBody, createResume, deleteResume, renameResume, resolveSlug,
  hasResume, slugify, countPages, readMeta, writeMeta, listHistory, readHistory, uniqueSlug,
  repairAllBodies,
} from './store.mjs';
import {
  assetsDir, listResumeAssets, saveResumeAsset, deleteResumeAsset, resolveAssetFile,
  listLibrary, saveLibraryItem, getLibraryFile, deleteLibraryItem, applyLibraryItem,
  portableAssetSrcs,
} from './media.mjs';
import { fetchModelList, modelForTask } from './models.mjs';
import { renderHtml } from './render.mjs';
import { listTemplates, normalizeStyle } from './templates.mjs';
import { printPdfAuto, findBrowser } from './pdf.mjs';
import { publicSettings, saveSettings, keyFor } from './settings.mjs';
import { streamChat, extractJson, llmReady } from './agent/llm.mjs';
import { buildMessages } from './agent/prompts.mjs';
import { schemaFor } from './agent/schemas.mjs';
import { remapAgentItemIds } from '../public/js/refs.js';
import { mockStream } from './agent/mock.mjs';
import { loadSettings } from './settings.mjs';
import {
  loadApps, createApp, updateApp, deleteApp, saveStatuses, renameResumeRefs, loadJds, saveJd, deleteJd, deleteJds, restoreJds,
} from './apps.mjs';
import { collectJdSource } from './fetch-jd.mjs';
import { loadStories, getStory, createStory, updateStory, deleteStory, deleteStories, restoreStories, importFromResume } from './stories.mjs';
import { loadInterviews, getSession, createSession, updateSession, deleteSession, addWrong, deleteWrong, renameInterviewRefs } from './interviews.mjs';
import { buildCalendar, eventsFromApps } from './ics.mjs';
import { analyzeApps, listReminders } from './insights.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.pdf': 'application/pdf',
};

// 预览 iframe 专用样式（只在网页里生效，不会写进 body.html，也不进 PDF）
const PREVIEW_CSS = `
html, body { background: transparent !important; margin: 0 !important; padding: 0 !important; overflow: hidden; }
#cv-container { padding: 0 !important; }
.main { box-shadow: 0 6px 28px rgba(15, 23, 42, .14), 0 1px 3px rgba(15,23,42,.08); margin-bottom: 28px !important; }
.main:last-child { margin-bottom: 0 !important; }
body.rp-edit #cv-container:focus { outline: none; }
body.rp-edit .section-item-container:hover, body.rp-edit .user:hover { outline: 1px dashed rgba(99, 102, 241, .55); outline-offset: 2px; border-radius: 2px; }
.rp-hl { outline: 2px solid #6366f1 !important; outline-offset: 3px; border-radius: 3px; background: rgba(99, 102, 241, .06); transition: background .3s; }
.rp-flash { animation: rpflash 1.6s ease-out 1; }
@keyframes rpflash { 0% { background: rgba(34, 197, 94, .35); } 100% { background: transparent; } }
::highlight(rp-todo) { background-color: #fde68a; color: #92400e; }
::highlight(rp-kw) { background-color: rgba(99, 102, 241, .18); }
@media print { .main { box-shadow: none !important; } }

body.rp-edit .user-avatar, body.rp-edit .user-school, body.rp-edit .edu-crest, body.rp-media-target { cursor: pointer; }
.rp-media-bar { position: absolute; left: 50%; bottom: -8px; transform: translate(-50%, 100%); display: none; gap: 2px; padding: 3px; background: #fff; border: 1px solid rgba(15,23,42,.12); border-radius: 8px; box-shadow: 0 8px 24px rgba(15,23,42,.16); z-index: 40; white-space: nowrap; }
.edu-crest-host { position: relative; }
body.rp-edit .user-avatar:hover .rp-media-bar, body.rp-edit .user-school:hover .rp-media-bar, body.rp-edit .edu-crest-host:hover .rp-media-bar { display: flex; }
.rp-media-bar button { border: 0; background: transparent; font: 11px/1.2 inherit; padding: 4px 6px; border-radius: 6px; cursor: pointer; color: #334155; }
.rp-media-bar button:hover { background: #eef2ff; color: #4338ca; }
`;

function sendJson(res, code, payload) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath, extraHeaders = {}) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const headers = { 'content-type': MIME[ext] || 'application/octet-stream', ...extraHeaders };
  if (ext === '.woff2' || ext === '.woff' || ext === '.ttf') headers['cache-control'] = 'public, max-age=604800';
  else headers['cache-control'] = 'no-cache';
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

function safeJoin(base, rel) {
  const target = path.resolve(base, rel);
  if (target !== base && !target.startsWith(base + path.sep)) throw Object.assign(new Error('forbidden'), { status: 403 });
  return target;
}

function readBodyJson(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('请求体过大'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch { reject(Object.assign(new Error('JSON 格式错误'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function validateBody(html) {
  const s = String(html || '').trim();
  if (!s.includes('id="cv-container"')) throw Object.assign(new Error('内容里没有 #cv-container，拒绝写入'), { status: 400 });
  if (!/data-resume-page=/.test(s)) throw Object.assign(new Error('内容里没有简历页（data-resume-page），拒绝写入'), { status: 400 });
  if (/<script[\s>]/i.test(s)) throw Object.assign(new Error('简历内容不能包含 <script>'), { status: 400 });
  return s + '\n';
}

function resumeInfo(slug) {
  return listResumes().find((r) => r.slug === slug);
}

function openInBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* 忽略 */ }
}

async function exportPdf(slug) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const htmlPath = path.join(OUT_DIR, slug + '.html');
  const pdfPath = path.join(OUT_DIR, slug + '.pdf');
  const body = readBody(slug);
  const meta = normalizeStyle(readMeta(slug));
  fs.writeFileSync(htmlPath, renderHtml({ body, title: slug, fontHref: pathToFileURL(path.join(ASSETS_DIR, 'fonts.css')).href, meta, assetBase: pathToFileURL(assetsDir(slug)).href + '/' }), 'utf8');
  const { bytes } = await printPdfAuto({ htmlPath, pdfPath });
  return { bytes, pages: countPages(body), file: slug + '.pdf', url: '/out/' + encodeURIComponent(slug + '.pdf'), path: pdfPath, template: meta.template };
}

// ---------- Agent：SSE 流式 ----------
async function handleAgent(req, res) {
  const payload = await readBodyJson(req);
  const settings = loadSettings();
  const ready = llmReady();
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  const send = (event, data) => res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
  const controller = new AbortController();
  // 每 15 秒发一行 SSE 注释保活，防止代理 / 浏览器把长时间的流当成空闲连接断掉
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* 已关闭 */ } }, 15000);
  res.on('close', () => { clearInterval(ping); controller.abort(); });

  try {
    const built = buildMessages(payload);
    const schema = built.json ? schemaFor(payload.task, payload) : null;
    const useMock = settings.mock || payload.mock === true;
    if (!useMock && !ready.ok) {
      send('error', { message: ready.reason + '。请到「设置」配置大模型，或打开「演示模式」先体验流程。', code: 'not_configured' });
      return res.end();
    }
    const model = useMock ? '演示模式' : modelForTask(payload.task);
    send('meta', { mock: useMock, model, task: payload.task });
    const onDelta = (text) => send('delta', { text });
    const full = useMock
      ? await mockStream(payload, onDelta, controller.signal)
      : await streamChat({ messages: built.messages, json: built.json, schema, signal: controller.signal, onDelta, onThinking: (t) => send('thinking', { text: t }), override: { model } });
    if (built.json) {
      let data;
      try { data = extractJson(full); } catch (error) {
        if (useMock || controller.signal.aborted) throw error;
        // 自动修复不了：把原输出交回模型，让它只重新输出合法 JSON（只重试一次）
        send('thinking', { text: '\n[输出的 JSON 格式有误，正在让模型重新输出…]\n' });
        const retry = await streamChat({
          messages: String(full || '').trim()
            ? [...built.messages, { role: 'assistant', content: full }, { role: 'user', content: '你上面的输出不是合法 JSON（' + error.message + '）。请只输出修正后的完整 JSON，不要任何解释；字符串里的英文双引号请改成「」。' }]
            : built.messages,
          json: true, schema, signal: controller.signal, onDelta: () => {}, onThinking: () => {}, override: { model },
        });
        try { data = extractJson(retry); } catch (err2) {
          send('error', { message: err2.message + '（已自动重试一次）', raw: retry.slice(0, 4000), code: 'parse' });
          return res.end();
        }
      }
      send('result', { data: remapAgentItemIds(data, payload.resume) });
    } else {
      send('result', { text: full });
    }
  } catch (error) {
    if (!controller.signal.aborted) send('error', { message: error.message, code: error.code || 'error' });
  }
  res.end();
}

async function runAgentOnce(payload) {
  const settings = loadSettings();
  const ready = llmReady();
  const built = buildMessages(payload);
  const schema = built.json ? schemaFor(payload.task, payload) : null;
  const useMock = settings.mock || payload.mock === true;
  if (!useMock && !ready.ok) {
    const err = new Error(ready.reason + '。请到「设置」配置大模型，或打开「演示模式」再试。');
    err.code = 'not_configured';
    throw err;
  }
  const full = useMock ? await mockStream(payload, () => {}, undefined) : await streamChat({ messages: built.messages, json: built.json, schema, override: { model: modelForTask(payload.task) } });
  if (built.json) return { data: remapAgentItemIds(extractJson(full), payload.resume), mock: useMock, raw: full };
  return { text: full, mock: useMock, raw: full };
}

function sendIcs(res, ics, filename) {
  const name = filename || 'events.ics';
  res.writeHead(200, {
    'content-type': 'text/calendar; charset=utf-8',
    'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(name),
    'cache-control': 'no-store',
  });
  res.end(ics);
}

// ---------- 路由 ----------
async function route(req, res, url) {
  const { pathname } = url;
  const method = req.method;
  const parts = pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));

  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
  if (method === 'GET' && parts[0] === 'static') return sendFile(res, safeJoin(PUBLIC_DIR, parts.slice(1).join('/')));
  if (method === 'GET' && parts[0] === 'assets') return sendFile(res, safeJoin(ASSETS_DIR, parts.slice(1).join('/')));
  if (method === 'GET' && parts[0] === 'out') {
    const file = safeJoin(OUT_DIR, parts.slice(1).join('/'));
    const headers = url.searchParams.get('download') ? { 'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(path.basename(file)) } : {};
    return sendFile(res, file, headers);
  }

  // 预览页：iframe 里加载，父页面直接操作 DOM
  if (method === 'GET' && parts[0] === 'preview' && parts[1]) {
    const slug = slugify(parts[1]);
    if (!hasResume(slug)) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('找不到简历'); }
    const hist = url.searchParams.get('history');
    const body = hist ? readHistory(slug, hist) : readBody(slug);
    const meta = normalizeStyle(readMeta(slug));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(renderHtml({ body, title: slug, fontHref: '/assets/fonts.css', extraHead: '<style>' + PREVIEW_CSS + '</style>\n', meta, assetBase: '/api/resumes/' + encodeURIComponent(slug) + '/assets/' }));
  }

  if (parts[0] !== 'api') { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('not found'); }
  const [, group, a, b, c, d] = parts;

  if (group === 'templates' && method === 'GET') return sendJson(res, 200, { items: listTemplates() });

  if (group === 'health') {
    let browser = null;
    try { browser = findBrowser(); } catch { /* 无 */ }
    return sendJson(res, 200, { ok: true, root: HOME, ...dataInfo(), browser, node: process.version, llm: llmReady() });
  }

  if (group === 'userdata' && method === 'POST') {
    if (a === 'import-examples') return sendJson(res, 200, { ok: true, ...importExamples() });
    if (a === 'wipe') {
      const body = await readBodyJson(req);
      return sendJson(res, 200, { ok: true, ...wipeUserData(body.confirm) });
    }
  }

  if (group === 'resumes') {
    if (!a) {
      if (method === 'GET') return sendJson(res, 200, { items: listResumes() });
      if (method === 'POST') {
        const body = await readBodyJson(req);
        const name = body.unique ? uniqueSlug(body.name || '') : body.name;
        const from = body.from ? resolveSlug(body.from) : null;
        const created = createResume(name, from, body.meta || {});
        return sendJson(res, 200, { ok: true, ...created, item: resumeInfo(created.slug) });
      }
    }
    const slug = slugify(a);
    if (!hasResume(slug)) return sendJson(res, 404, { ok: false, error: '找不到简历「' + slug + '」' });
    if (!b) {
      if (method === 'GET') return sendJson(res, 200, { slug, meta: readMeta(slug), html: readBody(slug), info: resumeInfo(slug) });
      if (method === 'PUT') {
        const body = await readBodyJson(req);
        const html = portableAssetSrcs(validateBody(body.html));
        writeBody(slug, html);
        return sendJson(res, 200, { ok: true, bytes: Buffer.byteLength(html), pages: countPages(html), at: new Date().toISOString() });
      }
      if (method === 'DELETE') {
        deleteResume(slug);
        return sendJson(res, 200, { ok: true });
      }
    }
    if (b === 'rename' && method === 'POST') {
      const body = await readBodyJson(req);
      const to = renameResume(slug, body.name || '');
      renameResumeRefs(slug, to);
      renameInterviewRefs(slug, to);
      return sendJson(res, 200, { ok: true, slug: to });
    }
    if (b === 'meta' && method === 'PATCH') {
      const body = await readBodyJson(req);
      const meta = readMeta(slug);
      for (const k of ['target', 'tags', 'note', 'lang', 'template', 'theme']) if (body[k] !== undefined) meta[k] = body[k];
      if (body.template !== undefined || body.theme !== undefined) {
        const n = normalizeStyle(meta);
        meta.template = n.template; meta.theme = n.theme;
      }
      writeMeta(slug, meta);
      return sendJson(res, 200, { ok: true, meta });
    }
    if (b === 'history') {
      if (!c && method === 'GET') return sendJson(res, 200, { items: listHistory(slug) });
      if (c && !d && method === 'GET') return sendJson(res, 200, { html: readHistory(slug, c) });
      if (c && d === 'restore' && method === 'POST') {
        const html = readHistory(slug, c);
        writeBody(slug, html);
        return sendJson(res, 200, { ok: true });
      }
    }
    if (b === 'pdf' && method === 'POST') {
      try {
        return sendJson(res, 200, { ok: true, ...(await exportPdf(slug)) });
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: error.message });
      }
    }
    if (b === 'assets') {
      if (!c && method === 'GET') return sendJson(res, 200, { items: listResumeAssets(slug) });
      if (!c && method === 'POST') {
        const body = await readBodyJson(req);
        const item = body.fromLibrary ? applyLibraryItem(slug, body.fromLibrary, body.kind) : saveResumeAsset(slug, body);
        return sendJson(res, 200, { ok: true, ...item });
      }
      if (c && method === 'GET') {
        try { return sendFile(res, resolveAssetFile(slug, decodeURIComponent(c))); }
        catch (error) { return sendJson(res, error.status || 400, { ok: false, error: error.message }); }
      }
      if (c && method === 'DELETE') return sendJson(res, 200, deleteResumeAsset(slug, decodeURIComponent(c)));
    }
  }

  if (group === 'settings') {
    if (!a && method === 'GET') return sendJson(res, 200, publicSettings());
    if (!a && method === 'PUT') return sendJson(res, 200, saveSettings(await readBodyJson(req)));
    if (a === 'models' && method === 'POST') {
      const body = await readBodyJson(req);
      const r = await fetchModelList({ baseUrl: body.baseUrl, apiKey: body.apiKey, preset: body.preset });
      return sendJson(res, 200, r);
    }
    if (a === 'test' && method === 'POST') {
      const body = await readBodyJson(req);
      const started = Date.now();
      try {
        const override = {};
        const p = body.llm || {};
        for (const k of ['baseUrl', 'model']) if (p[k]) override[k] = String(p[k]).replace(/\/+$/, '');
        if (p.apiKey && !String(p.apiKey).includes('****')) override.apiKey = p.apiKey;
        else if (p.preset || p.baseUrl) override.apiKey = keyFor(loadSettings().llm, p.preset, p.baseUrl || undefined).key;
        override.maxTokens = 32;
        const text = await streamChat({ messages: [{ role: 'user', content: '请只回复两个字：成功' }], override });
        return sendJson(res, 200, { ok: true, ms: Date.now() - started, reply: text.slice(0, 60) });
      } catch (error) {
        return sendJson(res, 200, { ok: false, ms: Date.now() - started, error: error.message });
      }
    }
  }

  if (group === 'agent' && method === 'POST') return handleAgent(req, res);

  if (group === 'media-library') {
    if (!a && method === 'GET') return sendJson(res, 200, { items: listLibrary(url.searchParams.get('kind') || '') });
    if (!a && method === 'POST') return sendJson(res, 200, { ok: true, item: saveLibraryItem(await readBodyJson(req)) });
    if (a && method === 'GET') {
      try {
        const { file } = getLibraryFile(a);
        return sendFile(res, file);
      } catch (error) { return sendJson(res, error.status || 404, { ok: false, error: error.message }); }
    }
    if (a && method === 'DELETE') return sendJson(res, 200, deleteLibraryItem(a));
  }


  if (group === 'apps') {
    if (!a && method === 'GET') return sendJson(res, 200, loadApps());
    if (!a && method === 'POST') return sendJson(res, 200, { ok: true, item: createApp(await readBodyJson(req)) });
    if (a === '_statuses' && method === 'PUT') return sendJson(res, 200, { ok: true, statuses: saveStatuses((await readBodyJson(req)).statuses) });
    if (a && method === 'PUT') return sendJson(res, 200, { ok: true, item: updateApp(a, await readBodyJson(req)) });
    if (a && method === 'DELETE') { deleteApp(a); return sendJson(res, 200, { ok: true }); }
  }

  if (group === 'jds') {
    if (a === 'fetch' && method === 'POST') {
      const body = await readBodyJson(req);
      if (!body.url && !body.html && !body.text) return sendJson(res, 400, { ok: false, error: '请提供岗位链接，或粘贴网页原文 / HTML' });
      let collected;
      try {
        collected = await collectJdSource(body);
      } catch (error) {
        return sendJson(res, error.status || 400, { ok: false, error: error.message, code: error.code || 'fetch_failed', hint: '自动抓取失败时，把岗位页全文或 HTML 粘贴过来，仍然可以抽取。' });
      }
      let extracted = collected.extracted || {};
      const wantLlm = body.useLlm !== false;
      if (wantLlm && (collected.text || '').length >= 20) {
        try {
          const r = await runAgentOnce({ task: 'extract_jd', text: collected.text, title: collected.title, url: collected.url });
          const d = r.data || {};
          if (d.ok === false && !extracted.text) {
            collected.wall = true;
            collected.warnings = [...(collected.warnings || []), d.reason].filter(Boolean);
          }
          if (d.company || d.role || (d.text && d.text.length >= 40)) {
            extracted = {
              company: d.company || extracted.company,
              role: d.role || extracted.role,
              location: d.location || extracted.location,
              text: (d.text && d.text.length >= 40) ? d.text : extracted.text,
            };
            collected.mock = r.mock;
          }
        } catch (error) {
          if (error.code === 'not_configured') collected.warnings.push(error.message);
          else collected.warnings.push('模型抽取没成功，已回退到规则结果：' + error.message);
        }
      }
      const ok = (extracted.text || '').length >= 40 && !collected.wall;
      return sendJson(res, 200, {
        ok, wall: collected.wall, source: collected.source, url: collected.url, title: collected.title,
        warnings: collected.warnings || [], hint: collected.hint || (ok ? '' : '没能稳定抽出完整 JD。请检查链接，或改为粘贴岗位页原文。'),
        company: extracted.company || '', role: extracted.role || '', location: extracted.location || '',
        text: extracted.text || '', rawPreview: (collected.text || '').slice(0, 1500), mock: collected.mock || false,
      });
    }
    if (a === '_batch' && method === 'POST') {
      const body = await readBodyJson(req);
      return sendJson(res, 200, deleteJds(body.ids || [], { deleteTailored: Boolean(body.deleteTailored) }));
    }
    if (a === '_restore' && method === 'POST') {
      const body = await readBodyJson(req);
      return sendJson(res, 200, restoreJds(body.snapshots || body.deleted || []));
    }
    if (!a && method === 'GET') return sendJson(res, 200, { items: loadJds() });
    if (!a && method === 'POST') return sendJson(res, 200, { ok: true, item: saveJd(await readBodyJson(req)) });
    if (a && method === 'DELETE') {
      const body = method === 'DELETE' ? await readBodyJson(req).catch(() => ({})) : {};
      const r = deleteJd(a, { deleteTailored: Boolean(body && body.deleteTailored) });
      return sendJson(res, 200, { ok: true, ...r });
    }
  }

  if (group === 'stories') {
    if (!a && method === 'GET') return sendJson(res, 200, loadStories());
    if (!a && method === 'POST') return sendJson(res, 200, { ok: true, item: createStory(await readBodyJson(req)) });
    if (a === '_import' && method === 'POST') {
      const body = await readBodyJson(req);
      if (!body.slug) return sendJson(res, 400, { ok: false, error: '请指定要导入的简历' });
      return sendJson(res, 200, { ok: true, ...importFromResume(body.slug, { skipExisting: body.skipExisting !== false, items: body.items }) });
    }
    if (a === '_batch' && method === 'POST') {
      const body = await readBodyJson(req);
      return sendJson(res, 200, deleteStories(body.ids || []));
    }
    if (a === '_restore' && method === 'POST') {
      const body = await readBodyJson(req);
      return sendJson(res, 200, restoreStories(body.snapshots || []));
    }
    if (a && method === 'GET') return sendJson(res, 200, { item: getStory(a) });
    if (a && method === 'PUT') return sendJson(res, 200, { ok: true, item: updateStory(a, await readBodyJson(req)) });
    if (a && method === 'DELETE') { deleteStory(a); return sendJson(res, 200, { ok: true }); }
  }

  if (group === 'interviews') {
    if (a === '_wrong' && !b && method === 'GET') return sendJson(res, 200, { items: loadInterviews().wrong });
    if (a === '_wrong' && !b && method === 'POST') return sendJson(res, 200, { ok: true, item: addWrong(await readBodyJson(req)) });
    if (a === '_wrong' && b && method === 'DELETE') { deleteWrong(b); return sendJson(res, 200, { ok: true }); }
    if (!a && method === 'GET') return sendJson(res, 200, loadInterviews());
    if (!a && method === 'POST') return sendJson(res, 200, { ok: true, item: createSession(await readBodyJson(req)) });
    if (a && method === 'GET') return sendJson(res, 200, { item: getSession(a) });
    if (a && method === 'PUT') return sendJson(res, 200, { ok: true, item: updateSession(a, await readBodyJson(req)) });
    if (a && method === 'DELETE') { deleteSession(a); return sendJson(res, 200, { ok: true }); }
  }

  if (group === 'apps') {
    if (a === '_insights' && method === 'GET') return sendJson(res, 200, analyzeApps(loadApps()));
    if (a === '_reminders' && method === 'GET') {
      const days = Math.max(1, Math.min(60, Number(url.searchParams.get('days') || loadSettings().remindAfterDays || 7)));
      return sendJson(res, 200, listReminders(loadApps(), { days }));
    }
    if (a === '_ics' && method === 'GET') {
      const data = loadApps();
      const ics = buildCalendar(eventsFromApps(data.items), '简历投递日程');
      return sendIcs(res, ics, '投递日程.ics');
    }
    if (a && b === 'ics' && method === 'GET') {
      const data = loadApps();
      const app = data.items.find((x) => x.id === a);
      if (!app) return sendJson(res, 404, { ok: false, error: '投递记录不存在' });
      const eventId = url.searchParams.get('event') || '';
      const evs = eventsFromApps(data.items, { appId: a, eventId: eventId || undefined });
      const ics = buildCalendar(evs, app.company + ' · 投递日程');
      const fname = eventId ? (app.company || '投递') + '-' + (evs[0]?.title || '事件') + '.ics' : (app.company || '投递') + '.ics';
      return sendIcs(res, ics, fname);
    }
  }

  return sendJson(res, 404, { ok: false, error: '接口不存在：' + method + ' ' + pathname });
}

export function startServer({ port = 4321, host = '127.0.0.1', open = true } = {}) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      await route(req, res, url);
    } catch (error) {
      const status = error.status || (/找不到|不存在/.test(error.message) ? 404 : 400);
      if (!res.headersSent) sendJson(res, status, { ok: false, error: error.message });
      else res.end();
    }
  });
  // Node 18+ 默认 requestTimeout=300s，会把超过 5 分钟的 AI 流式请求掐断；本地服务不需要总时长上限
  server.requestTimeout = 0;
  server.timeout = 0;
  server.keepAliveTimeout = 65000;
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error('端口 ' + port + ' 被占用，换一个：node cli.mjs serve --port ' + (port + 1));
      process.exit(1);
    }
    throw error;
  });
  try {
    const init = initUserData();
    if (init.created.length) console.log('  首次启动，已创建入门简历：' + init.created.join('、'));
  } catch (err) { console.warn('  初始化数据目录失败：' + err.message); }
  server.listen(port, host, () => {
    try {
      const fixed = repairAllBodies();
      if (fixed.length) console.log('  已自动清理误写入简历的编辑器工具栏文字：' + fixed.join('、'));
    } catch (err) { console.warn('  简历自动清理失败：' + err.message); }
    const url = 'http://' + (host === '0.0.0.0' ? '127.0.0.1' : host) + ':' + port + '/';
    console.log('');
    console.log('  简历工作台已启动：' + url);
    console.log('  数据目录：' + HOME + ({ env: '（RESUME_HOME）', portable: '（程序目录，沿用旧版位置）', user: '' }[HOME_MODE] || ''));
    console.log('  Ctrl+C 结束服务');
    console.log('');
    if (open) openInBrowser(url);
  });
  return server;
}
