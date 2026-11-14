import fs from 'node:fs';
import path from 'node:path';
import { RESUMES_DIR, TEMPLATE_DIR } from './config.mjs';
import { stripEditorChrome, looksPolluted } from './sanitize-body.mjs';

const META = 'meta.json';
const BODY = 'body.html';

export function slugify(name) {
  const cleaned = String(name || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) throw new Error('简历名称不能为空');
  if (/[\\/:*?"<>|]/.test(cleaned)) throw new Error('简历名称不能包含 \\ / : * ? " < > |');
  if (/^\./.test(cleaned)) throw new Error('简历名称不能以 . 开头');
  if (cleaned.length > 80) throw new Error('简历名称过长（最多 80 个字符）');
  return cleaned;
}

function resumeDir(slug) {
  return path.join(RESUMES_DIR, slug);
}

export function resumeSlugs() {
  if (!fs.existsSync(RESUMES_DIR)) return [];
  return fs.readdirSync(RESUMES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && fs.existsSync(path.join(RESUMES_DIR, d.name, BODY)))
    .map((d) => d.name);
}

export function readMeta(slug) {
  const file = path.join(resumeDir(slug), META);
  if (!fs.existsSync(file)) return { name: slug };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeMeta(slug, meta) {
  fs.writeFileSync(path.join(resumeDir(slug), META), JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

export function readBody(slug) {
  return fs.readFileSync(path.join(resumeDir(slug), BODY), 'utf8');
}

const HISTORY = '.history';
const HISTORY_KEEP = 30;

// 每次覆盖 body.html 前把旧内容存一份到 .history/，可在网页里回滚
function backupBody(slug) {
  const file = path.join(resumeDir(slug), BODY);
  if (!fs.existsSync(file)) return;
  const dir = path.join(resumeDir(slug), HISTORY);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(file, path.join(dir, stamp + '.html'));
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.html')).sort();
  for (const old of all.slice(0, Math.max(0, all.length - HISTORY_KEEP))) fs.rmSync(path.join(dir, old), { force: true });
}

export function listHistory(slug) {
  const dir = path.join(resumeDir(slug), HISTORY);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.html')).sort().reverse().map((f) => {
    const stat = fs.statSync(path.join(dir, f));
    return { id: f.replace(/\.html$/, ''), bytes: stat.size, at: stat.mtime.toISOString() };
  });
}

export function readHistory(slug, id) {
  if (!/^[\w-]+$/.test(id)) throw new Error('非法的历史版本 id');
  const file = path.join(resumeDir(slug), HISTORY, id + '.html');
  if (!fs.existsSync(file)) throw new Error('历史版本不存在');
  return fs.readFileSync(file, 'utf8');
}

export function writeBody(slug, html, { backup = true } = {}) {
  html = stripEditorChrome(html);
  fs.mkdirSync(resumeDir(slug), { recursive: true });
  if (backup) {
    const file = path.join(resumeDir(slug), BODY);
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== html) backupBody(slug);
  }
  fs.writeFileSync(path.join(resumeDir(slug), BODY), html, 'utf8');
  const meta = readMeta(slug);
  meta.updatedAt = new Date().toISOString();
  writeMeta(slug, meta);
}

export function countPages(html) {
  return (html.match(/data-resume-page=/g) || []).length;
}

export function listResumes() {
  return resumeSlugs().map((slug) => {
    const body = readBody(slug);
    const meta = readMeta(slug);
    return {
      slug,
      name: meta.name || slug,
      pages: countPages(body),
      bytes: Buffer.byteLength(body),
      from: meta.from || '',
      createdAt: meta.createdAt || '',
      target: meta.target || null,
      tags: meta.tags || [],
      lang: meta.lang || "",
      template: meta.template || "classic",
      theme: meta.theme || {},
      updatedAt: meta.updatedAt || fs.statSync(path.join(resumeDir(slug), BODY)).mtime.toISOString(),
    };
  }).sort((a, b) => a.slug.localeCompare(b.slug, 'zh'));
}

export function hasResume(slug) {
  return fs.existsSync(path.join(resumeDir(slug), BODY));
}

export function createResume(name, fromSlug, extraMeta = {}) {
  const slug = slugify(name);
  if (hasResume(slug)) throw new Error('简历「' + slug + '」已存在');

  const source = fromSlug ? path.join(resumeDir(slugify(fromSlug)), BODY) : path.join(TEMPLATE_DIR, 'base.html');
  if (!fs.existsSync(source)) throw new Error('模板来源不存在：' + (fromSlug || 'template/base.html'));

  const body = fs.readFileSync(source, 'utf8');
  const now = new Date().toISOString();
  fs.mkdirSync(resumeDir(slug), { recursive: true });
  fs.writeFileSync(path.join(resumeDir(slug), BODY), body, 'utf8');
  if (fromSlug && hasResume(slugify(fromSlug))) {
    const srcAssets = path.join(resumeDir(slugify(fromSlug)), 'assets');
    if (fs.existsSync(srcAssets)) fs.cpSync(srcAssets, path.join(resumeDir(slug), 'assets'), { recursive: true });
  }
  const srcMeta = fromSlug && hasResume(slugify(fromSlug)) ? readMeta(slugify(fromSlug)) : {};
  writeMeta(slug, {
    name: slug,
    from: fromSlug ? slugify(fromSlug) : 'template',
    createdAt: now,
    updatedAt: now,
    template: srcMeta.template || 'classic',
    theme: srcMeta.theme || {},
    ...extraMeta,
  });
  return { slug, pages: countPages(body) };
}

export function deleteResume(name) {
  const slug = slugify(name);
  if (slug === 'template') throw new Error('不能删除基础模板');
  if (!hasResume(slug)) throw new Error('找不到简历「' + slug + '」');
  fs.rmSync(resumeDir(slug), { recursive: true, force: true });
  return slug;
}

export function resolveSlug(input) {
  const slugs = resumeSlugs();
  if (!input) {
    if (slugs.length === 1) return slugs[0];
    throw new Error('仓库里有 ' + slugs.length + ' 份简历，请指定名称：' + slugs.join('、'));
  }
  const slug = slugify(input);
  if (hasResume(slug)) return slug;
  const fuzzy = slugs.filter((s) => s.includes(slug));
  if (fuzzy.length === 1) return fuzzy[0];
  if (fuzzy.length > 1) throw new Error('名称不唯一，匹配到：' + fuzzy.join('、'));
  throw new Error('找不到简历「' + slug + '」，现有：' + (slugs.join('、') || '（空）'));
}

export function renameResume(fromName, toName) {
  const from = slugify(fromName);
  const to = slugify(toName);
  if (!hasResume(from)) throw new Error('找不到简历「' + from + '」');
  if (from === to) return to;
  if (fs.existsSync(resumeDir(to))) throw new Error('简历「' + to + '」已存在');
  fs.renameSync(resumeDir(from), resumeDir(to));
  const meta = readMeta(to);
  meta.name = to;
  meta.updatedAt = new Date().toISOString();
  writeMeta(to, meta);
  return to;
}

export function uniqueSlug(name) {
  const base = slugify(name);
  if (!fs.existsSync(resumeDir(base))) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = base + '-' + i;
    if (!fs.existsSync(resumeDir(candidate))) return candidate;
  }
  throw new Error('无法生成不重复的名称');
}

export function resumePath(slug) { return resumeDir(slugify(slug)); }

export function trashResume(name) {
  const slug = slugify(name);
  if (!hasResume(slug)) throw new Error('找不到简历「' + slug + '」');
  const dest = path.join(RESUMES_DIR, '.trash', slug + '-' + Date.now().toString(36));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(resumeDir(slug), dest);
  return { slug, path: dest };
}

export function restoreTrashed(trashPath, slug) {
  const to = slugify(slug);
  if (hasResume(to)) throw new Error('简历「' + to + '」已存在，无法还原');
  if (!trashPath || !fs.existsSync(trashPath)) throw new Error('找不到可还原的简历文件');
  const resolved = path.resolve(trashPath);
  const root = path.join(RESUMES_DIR, '.trash');
  if (!resolved.startsWith(root + path.sep)) throw new Error('非法的回收路径');
  fs.renameSync(resolved, resumeDir(to));
  return to;
}

export function repairAllBodies() {
  const fixed = [];
  for (const slug of resumeSlugs()) {
    const file = path.join(resumeDir(slug), BODY);
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, 'utf8');
    if (!looksPolluted(raw)) continue;
    writeBody(slug, raw, { backup: true });
    fixed.push(slug);
  }
  return fixed;
}
