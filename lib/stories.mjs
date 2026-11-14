// 经历素材库：完整 STAR 经历，供 JD 适配 / 改写作为证据来源（仍然不编造）
import path from 'node:path';
import { DATA_DIR } from './config.mjs';
import { readJson, writeJson, newId, nowIso } from './jsonfile.mjs';
import { readBody } from './store.mjs';

const FILE = path.join(DATA_DIR, 'stories.json');
export const STORY_TYPES = [
  { id: 'internship', name: '实习' },
  { id: 'project', name: '项目' },
  { id: 'research', name: '科研' },
  { id: 'competition', name: '竞赛' },
  { id: 'org', name: '组织/社团' },
  { id: 'award', name: '奖项' },
  { id: 'other', name: '其他' },
];

const FIELDS = ['type', 'title', 'org', 'role', 'start', 'end', 'location', 'background', 'task', 'action', 'result', 'sourceSlug', 'sourceItemId'];

function load() {
  const data = readJson(FILE, null);
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.items) ? data.items : [];
}
function save(items) { writeJson(FILE, { items }); }

function clean(input, base = {}) {
  const item = { ...base };
  for (const k of FIELDS) if (input[k] !== undefined) item[k] = typeof input[k] === 'string' ? input[k].trim() : input[k];
  item.type = STORY_TYPES.some((t) => t.id === item.type) ? item.type : 'project';
  item.title = String(item.title || '').slice(0, 120);
  item.org = String(item.org || '').slice(0, 80);
  item.role = String(item.role || '').slice(0, 80);
  item.metrics = Array.isArray(input.metrics) ? input.metrics.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 20) : (item.metrics || []);
  item.stack = Array.isArray(input.stack) ? input.stack.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 30) : (item.stack || []);
  item.tags = Array.isArray(input.tags) ? input.tags.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 20) : (item.tags || []);
  item.evidence = Array.isArray(input.evidence) ? input.evidence.map((e) => ({
    label: String(e.label || e.url || '链接').slice(0, 80),
    url: String(e.url || '').slice(0, 500),
    note: String(e.note || '').slice(0, 300),
  })).filter((e) => e.url || e.note).slice(0, 10) : (item.evidence || []);
  for (const k of ['background', 'task', 'action', 'result']) item[k] = String(item[k] || '').slice(0, 4000);
  return item;
}

export function loadStories() { return { items: load(), types: STORY_TYPES }; }

export function getStory(id) {
  const item = load().find((x) => x.id === id);
  if (!item) throw Object.assign(new Error('素材不存在'), { status: 404 });
  return item;
}

export function createStory(input) {
  if (!String(input.title || '').trim()) throw Object.assign(new Error('请填写经历标题'), { status: 400 });
  const item = clean(input, { id: newId(), createdAt: nowIso(), updatedAt: nowIso() });
  const items = load();
  items.unshift(item);
  save(items);
  return item;
}

export function updateStory(id, patch) {
  const items = load();
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) throw Object.assign(new Error('素材不存在'), { status: 404 });
  items[i] = clean({ ...items[i], ...patch }, items[i]);
  items[i].updatedAt = nowIso();
  save(items);
  return items[i];
}

export function deleteStory(id) {
  const items = load();
  const next = items.filter((x) => x.id !== id);
  if (next.length === items.length) throw Object.assign(new Error('素材不存在'), { status: 404 });
  save(next);
}

export function deleteStories(ids) {
  const want = [...new Set((Array.isArray(ids) ? ids : [ids]).map((x) => String(x || '')).filter(Boolean))];
  if (!want.length) throw Object.assign(new Error('请选择要删除的素材'), { status: 400 });
  const items = load();
  const deleted = items.filter((x) => want.includes(x.id));
  if (!deleted.length) throw Object.assign(new Error('素材不存在'), { status: 404 });
  const drop = new Set(deleted.map((x) => x.id));
  save(items.filter((x) => !drop.has(x.id)));
  return { ok: true, deleted };
}

export function restoreStories(snapshots) {
  const rows = Array.isArray(snapshots) ? snapshots : [];
  if (!rows.length) throw Object.assign(new Error('没有可撤销的内容'), { status: 400 });
  const items = load();
  const restored = [];
  for (const item of rows) {
    if (!item || !item.id || items.some((x) => x.id === item.id)) continue;
    items.unshift(item);
    restored.push(item.id);
  }
  save(items);
  return { ok: true, restored };
}

function strip(html) {
  return String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

const MODULE_TYPE = {
  works: 'internship', project_experience: 'project', reasearch_experience: 'research',
  orgs: 'org', honor: 'award', skill_list: null, personal_summary: null, edus: null,
};

// 从简历 HTML 抽出可导入的条目（不覆盖已有 sourceItemId）
export function previewImport(slug) {
  const html = readBody(slug);
  const items = [];
  const optRe = /id="(works|project_experience|orgs|reasearch_experience|honor)"[^>]*class="[^"]*option[\s\S]*?(?=<div[^>]+id="(?:works|project_experience|orgs|reasearch_experience|honor|skill_list|personal_summary|edus)"|<\/div><\/div><\/div>$)/g;
  // 更稳妥：按 section-item-container 扫，再用最近的 option id 判断模块
  const chunks = html.split(/class="[^"]*section-item-container/);
  let currentMod = '';
  // 重新用更简单的扫描
  const re = /id="(works|project_experience|orgs|reasearch_experience|honor|edus|skill_list|personal_summary)"|id="([^"]+)"[^>]*section-item-container[\s\S]*?<div[^>]*class="[^"]*menu-title[\s\S]*?<\/div>\s*(?:<div[^>]*class="[^"]*menu-title[\s\S]*?<\/div>)?\s*<div[^>]*class="[^"]*menu-content[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  // fallback parser below
  return parseResumeItems(html, slug);
}

export function parseResumeItems(html, slug) {
  // 只解析第一份内容副本（分页会复制多份 .content-scroll，避免导入重复）
  const first = html.indexOf('class="content-scroll"');
  if (first >= 0) {
    const next = html.indexOf('class="content-scroll"', first + 20);
    html = next > first ? html.slice(first, next) : html.slice(first);
  }

  function extractDiv(src, from) {
    const open = src.indexOf('>', from);
    if (open < 0) return '';
    let depth = 1, i = open + 1;
    while (i < src.length && depth > 0) {
      const nextOpen = src.indexOf('<div', i);
      const nextClose = src.indexOf('</div>', i);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) { depth++; i = nextOpen + 4; }
      else { depth--; if (depth === 0) return src.slice(open + 1, nextClose); i = nextClose + 6; }
    }
    return src.slice(open + 1);
  }

  const items = [];
  const re = /id="([^"]+)" class="[^"]*section-item-container/g;
  const hits = [];
  let m;
  while ((m = re.exec(html))) hits.push({ id: m[1], index: m.index });
  for (let i = 0; i < hits.length; i++) {
    const block = html.slice(hits[i].index, i + 1 < hits.length ? hits[i + 1].index : html.length);
    const id = hits[i].id;
    const head = html.slice(Math.max(0, hits[i].index - 2500), hits[i].index);
    const mods = [...head.matchAll(/id="(works|project_experience|orgs|reasearch_experience|honor)"/g)];
    const mod = mods.length ? mods[mods.length - 1][1] : (/^works-/.test(id) ? 'works' : /^project_experience-/.test(id) ? 'project_experience' : /^orgs-/.test(id) ? 'orgs' : /^reasearch_experience-/.test(id) ? 'reasearch_experience' : /^honor-/.test(id) ? 'honor' : '');
    const type = MODULE_TYPE[mod];
    if (!type) continue;
    const cIdx = block.search(/<div[^>]*class="[^"]*menu-content(?:\s|")/);
    const content = cIdx >= 0 ? extractDiv(block, cIdx) : '';
    const titleHtml = cIdx >= 0 ? block.slice(0, cIdx) : block;
    const titleText = [...titleHtml.matchAll(/<(?:span|div)[^>]*>([\s\S]*?)<\/(?:span|div)>/g)]
      .map((x) => strip(x[1]).replace(/\s+/g, ' '))
      .filter((t) => t && t.length < 80 && !/^[\/\-—]+$/.test(t));
    const uniq = [...new Set(titleText)];
    const org = uniq[0] || '';
    const dates = uniq.filter((t) => /\d{4}/.test(t));
    const role = uniq.find((t) => t !== org && !/\d{4}/.test(t) && t.length < 40) || '';
    const text = strip(content);
    if (!text && !org) continue;
    const dateStr = dates.join(' ');
    const start = dateStr.match(/(\d{4})\s*年\s*(\d{1,2})/) || ['', '', ''];
    const endM = dateStr.match(/[至\-—~]+\s*(?:(\d{4})\s*年\s*(\d{1,2})|至今|Present)/);
    items.push({
      type, title: [org, role].filter(Boolean).join(' · ') || uniq[0] || '未命名经历',
      org, role,
      start: start[1] ? start[1] + '-' + String(start[2]).padStart(2, '0') : '',
      end: /至今|Present/.test(dateStr) ? '至今' : (endM && endM[1] ? endM[1] + '-' + String(endM[2] || '01').padStart(2, '0') : ''),
      background: text.split('\n').filter(Boolean)[0] || '',
      task: '',
      action: text,
      result: (text.match(/[，。].{0,4}\d.*/) || [''])[0].slice(0, 200),
      metrics: (text.match(/\d+(\.\d+)?\s*(%|个|项|人|万|倍|ms|QPS|页|条)?/g) || []).slice(0, 8),
      stack: [],
      tags: [],
      evidence: [],
      sourceSlug: slug,
      sourceItemId: id,
    });
  }
  return items;
}


export function importFromResume(slug, { skipExisting = true, items: given } = {}) {
  const existing = load();
  const have = new Set(existing.filter((s) => s.sourceSlug === slug && s.sourceItemId).map((s) => s.sourceItemId));
  const parsed = given || parseResumeItems(readBody(slug), slug);
  const added = [];
  for (const raw of parsed) {
    if (skipExisting && raw.sourceItemId && have.has(raw.sourceItemId)) continue;
    if (!raw.title) continue;
    added.push(createStory(raw));
    if (raw.sourceItemId) have.add(raw.sourceItemId);
  }
  return { added: added.length, items: added, skipped: parsed.length - added.length };
}

export function storyToText(s) {
  return [
    `# ${s.title} [${s.id}]`,
    s.org ? '组织：' + s.org : '',
    s.role ? '角色：' + s.role : '',
    (s.start || s.end) ? '时间：' + [s.start, s.end].filter(Boolean).join(' ~ ') : '',
    s.background ? '背景：' + s.background : '',
    s.task ? '任务：' + s.task : '',
    s.action ? '行动：' + s.action : '',
    s.result ? '结果：' + s.result : '',
    s.metrics?.length ? '数据：' + s.metrics.join('；') : '',
    s.stack?.length ? '技术栈：' + s.stack.join('、') : '',
  ].filter(Boolean).join('\n');
}
