// 简历头像 / 校徽与常用素材库：文件落在 resumes/<slug>/assets/，不把大图写成 base64 塞进 body.html
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, RESUMES_DIR } from './config.mjs';
import { slugify, hasResume } from './store.mjs';

const MAX_BYTES = 4 * 1024 * 1024;
const LIBRARY_DIR = path.join(DATA_DIR, 'media-library');
const LIBRARY_INDEX = path.join(DATA_DIR, 'media-library.json');

const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

export function assetsDir(slug) {
  return path.join(RESUMES_DIR, slugify(slug), 'assets');
}

export function assetUrl(slug, name, { absolute = false } = {}) {
  const rel = '/api/resumes/' + encodeURIComponent(slugify(slug)) + '/assets/' + encodeURIComponent(name);
  return absolute ? rel : rel;
}

function sniffMime(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.length >= 6 && buf.slice(0, 6).toString('ascii').startsWith('GIF8')) return 'image/gif';
  return '';
}

function decodeImage(data) {
  const raw = String(data || '');
  const b64 = raw.replace(/^data:[^;]+;base64,/, '');
  if (!b64) throw Object.assign(new Error('没有收到图片数据'), { status: 400 });
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw Object.assign(new Error('图片数据无效'), { status: 400 });
  if (buf.length > MAX_BYTES) throw Object.assign(new Error('图片过大（压缩后请不超过 4MB）'), { status: 400 });
  const mime = sniffMime(buf);
  if (!mime) throw Object.assign(new Error('仅支持 JPEG / PNG / WebP / GIF'), { status: 400 });
  return { buf, mime, ext: MIME_EXT[mime] };
}

export function sanitizeAssetName(kind, ext) {
  const e = ext && ext.startsWith('.') ? ext : '.' + (ext || 'jpg');
  if (kind === 'avatar') return 'avatar' + e;
  if (kind === 'school') return 'school' + e;
  const m = String(kind || '').match(/^edu-([A-Za-z0-9_-]{1,40})$/);
  if (m) return 'edu-' + m[1] + e;
  throw Object.assign(new Error('无法识别的图片类型'), { status: 400 });
}

function kindPrefix(kind) {
  if (kind === 'avatar' || kind === 'school') return kind;
  const m = String(kind || '').match(/^(edu-[A-Za-z0-9_-]{1,40})$/);
  if (m) return m[1];
  return '';
}

function clearKind(dir, kind) {
  const prefix = kindPrefix(kind);
  if (!prefix || !fs.existsSync(dir)) return [];
  const removed = [];
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(prefix + '.') || f === prefix) {
      fs.rmSync(path.join(dir, f), { force: true });
      removed.push(f);
    }
  }
  return removed;
}

export function listResumeAssets(slug) {
  const dir = assetsDir(slug);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => !f.startsWith('.')).map((name) => {
    const st = fs.statSync(path.join(dir, name));
    return { name, bytes: st.size, url: assetUrl(slug, name), updatedAt: st.mtime.toISOString() };
  });
}

export function saveResumeAsset(slug, { kind, data, mime } = {}) {
  if (!hasResume(slug)) throw Object.assign(new Error('找不到简历'), { status: 404 });
  const img = decodeImage(data);
  if (mime && MIME_EXT[mime] && mime !== img.mime) {
    // 以文件魔数为准，忽略声明不符
  }
  const name = sanitizeAssetName(kind, img.ext);
  const dir = assetsDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  clearKind(dir, kind);
  fs.writeFileSync(path.join(dir, name), img.buf);
  return { name, bytes: img.buf.length, mime: img.mime, url: assetUrl(slug, name), kind };
}

export function deleteResumeAsset(slug, kind) {
  if (!hasResume(slug)) throw Object.assign(new Error('找不到简历'), { status: 404 });
  const removed = clearKind(assetsDir(slug), kind);
  return { ok: true, removed };
}

export function resolveAssetFile(slug, name) {
  const raw = String(name || '');
  const safe = path.basename(raw);
  if (!safe || safe !== raw || safe.startsWith('.') || !/^[A-Za-z0-9._-]+$/.test(safe)) {
    throw Object.assign(new Error('非法的文件名'), { status: 400 });
  }
  const dir = path.resolve(assetsDir(slug));
  const file = path.resolve(dir, safe);
  if (file !== path.join(dir, safe) && !file.startsWith(dir + path.sep)) throw Object.assign(new Error('非法路径'), { status: 400 });
  return file;
}

export function copyAssets(fromSlug, toSlug) {
  const src = assetsDir(fromSlug);
  if (!fs.existsSync(src)) return false;
  const dst = assetsDir(toSlug);
  fs.cpSync(src, dst, { recursive: true });
  return true;
}

export function rewriteAssetSrcs(html, assetBase) {
  if (!html) return html;
  const prefix = !assetBase ? 'assets/' : (assetBase.endsWith('/') ? assetBase : assetBase + '/');
  return String(html).replace(/<img\b[^>]*>/gi, (tag) => {
    const m = tag.match(/\bdata-rp-asset=(["'])([^"']+)\1/i);
    const rel = tag.match(/\bsrc=(["'])(?:(?:\.\/)?assets\/|\/api\/resumes\/[^/]+\/assets\/)([^"'?]+)/i);
    const name = m ? m[2] : (rel ? decodeURIComponent(rel[2]) : '');
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) return tag;
    const href = prefix.startsWith('file:') ? prefix + name : prefix + encodeURIComponent(name);
    const safe = href.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    if (/\ssrc=/i.test(tag)) return tag.replace(/\ssrc=(["'])[\s\S]*?\1/i, ' src="' + safe + '"');
    return tag.replace(/<img/i, '<img src="' + safe + '"');
  });
}

export function portableAssetSrcs(html) {
  if (!html) return html;
  return String(html).replace(/<img\b[^>]*>/gi, (tag) => {
    const m = tag.match(/\bdata-rp-asset=(["'])([^"']+)\1/i);
    if (!m) return tag;
    const name = m[2];
    if (!name || /[\\/]/.test(name)) return tag;
    if (/\ssrc=/i.test(tag)) return tag.replace(/\ssrc=(["'])[\s\S]*?\1/i, ' src="assets/' + name + '"');
    return tag.replace(/<img/i, '<img src="assets/' + name + '"');
  });
}

function readLibrary() {
  try {
    const list = JSON.parse(fs.readFileSync(LIBRARY_INDEX, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function writeLibrary(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LIBRARY_INDEX, JSON.stringify(list, null, 2) + '\n', 'utf8');
}

export function listLibrary(kind) {
  const list = readLibrary();
  return kind ? list.filter((x) => x.kind === kind) : list;
}

export function saveLibraryItem({ kind, title, data } = {}) {
  const k = kind === 'school' ? 'school' : 'avatar';
  const img = decodeImage(data);
  const id = crypto.randomBytes(6).toString('hex');
  const name = id + img.ext;
  fs.mkdirSync(LIBRARY_DIR, { recursive: true });
  fs.writeFileSync(path.join(LIBRARY_DIR, name), img.buf);
  const item = {
    id, kind: k, title: String(title || (k === 'school' ? '常用校徽' : '常用头像')).slice(0, 40),
    file: name, mime: img.mime, bytes: img.buf.length, createdAt: new Date().toISOString(),
  };
  const list = readLibrary();
  list.unshift(item);
  writeLibrary(list);
  return { ...item, url: '/api/media-library/' + id };
}

export function getLibraryFile(id) {
  const item = readLibrary().find((x) => x.id === id);
  if (!item) throw Object.assign(new Error('常用素材不存在'), { status: 404 });
  const file = path.join(LIBRARY_DIR, path.basename(item.file));
  if (!fs.existsSync(file)) throw Object.assign(new Error('常用素材文件缺失'), { status: 404 });
  return { item, file };
}

export function deleteLibraryItem(id) {
  const list = readLibrary();
  const item = list.find((x) => x.id === id);
  if (!item) throw Object.assign(new Error('常用素材不存在'), { status: 404 });
  fs.rmSync(path.join(LIBRARY_DIR, path.basename(item.file)), { force: true });
  writeLibrary(list.filter((x) => x.id !== id));
  return { ok: true };
}

export function applyLibraryItem(slug, id, kind) {
  const { item, file } = getLibraryFile(id);
  const useKind = kind || item.kind;
  const buf = fs.readFileSync(file);
  const ext = path.extname(item.file) || MIME_EXT[item.mime] || '.jpg';
  const name = sanitizeAssetName(useKind, ext);
  const dir = assetsDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  clearKind(dir, useKind);
  fs.writeFileSync(path.join(dir, name), buf);
  return { name, bytes: buf.length, mime: item.mime, url: assetUrl(slug, name), kind: useKind, from: item.id };
}

export const MEDIA_CSS = `
#cv-container img[data-rp-asset]{ object-fit:cover; }
#cv-container .user-avatar-image[data-rp-shape="circle"],
#cv-container .user-school img[data-rp-shape="circle"],
#cv-container .edu-crest[data-rp-shape="circle"]{ border-radius:50%; object-fit:cover; }
#cv-container .user-avatar-image[data-rp-shape="rounded"],
#cv-container .user-school img[data-rp-shape="rounded"],
#cv-container .edu-crest[data-rp-shape="rounded"]{ border-radius:12%; object-fit:cover; }
#cv-container .user-avatar-image[data-rp-shape="square"],
#cv-container .user-school img[data-rp-shape="square"],
#cv-container .edu-crest[data-rp-shape="square"]{ border-radius:0; object-fit:cover; }
#cv-container .user.rp-no-avatar .user-avatar{ display:none !important; }
#cv-container .user.rp-no-school .user-school{ display:none !important; }
#cv-container .user.rp-no-avatar .user-info.has-profile{ min-height:0 !important; }
#cv-container .edu-crest{ width:22px; height:22px; object-fit:contain; margin-right:6px; vertical-align:middle; display:inline-block; flex:0 0 22px; }
#cv-container .edu-crest:not([src]), #cv-container .edu-crest[src=""]{ display:none; }
#cv-container .menu-title .left{ display:flex; align-items:center; }
`;
