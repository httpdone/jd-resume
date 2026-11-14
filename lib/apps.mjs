// 投递记录与 JD 库：data/applications.json、data/jds.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.mjs';
import { hasResume, trashResume, restoreTrashed } from './store.mjs';

const APPS = path.join(DATA_DIR, 'applications.json');
const JDS = path.join(DATA_DIR, 'jds.json');

export const DEFAULT_STATUSES = [
  { name: '待投递', color: '#94a3b8', stage: 'todo' },
  { name: '已投递', color: '#3b82f6', stage: 'active' },
  { name: '笔试/测评', color: '#8b5cf6', stage: 'active' },
  { name: '一面', color: '#06b6d4', stage: 'interview' },
  { name: '二面', color: '#14b8a6', stage: 'interview' },
  { name: '三面/终面', color: '#0ea5e9', stage: 'interview' },
  { name: 'HR面', color: '#f59e0b', stage: 'interview' },
  { name: 'Offer', color: '#22c55e', stage: 'offer' },
  { name: '已拒绝', color: '#ef4444', stage: 'closed' },
  { name: '已放弃', color: '#64748b', stage: 'closed' },
];

export const EVENT_TYPES = ['投递', '笔试', '测评', '一面', '二面', '三面', 'HR面', '电话沟通', 'Offer沟通', '截止日期', '其他'];

const id = () => crypto.randomBytes(6).toString('hex');
const now = () => new Date().toISOString();

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// 先写临时文件再改名，避免写一半断电损坏
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

export function loadApps() {
  const data = readJson(APPS, null) || {};
  return { statuses: Array.isArray(data.statuses) && data.statuses.length ? data.statuses : DEFAULT_STATUSES, items: Array.isArray(data.items) ? data.items : [], eventTypes: EVENT_TYPES };
}

function saveApps(data) {
  writeJson(APPS, { statuses: data.statuses, items: data.items });
}

const APP_FIELDS = ['company', 'role', 'link', 'channel', 'location', 'salary', 'resumeSlug', 'jdId', 'status', 'appliedAt', 'notes', 'priority', 'contact', 'deadline'];

function cleanEvents(events) {
  return (Array.isArray(events) ? events : []).map((e) => ({
    id: e.id || id(),
    type: String(e.type || '其他').slice(0, 20),
    date: String(e.date || '').slice(0, 10),
    time: String(e.time || '').slice(0, 5),
    note: String(e.note || '').slice(0, 500),
    done: Boolean(e.done),
  })).filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date));
}

export function createApp(input) {
  const data = loadApps();
  if (!String(input.company || '').trim()) throw new Error('公司名称不能为空');
  const item = { id: id(), createdAt: now(), updatedAt: now(), history: [], events: [] };
  for (const k of APP_FIELDS) if (input[k] !== undefined) item[k] = typeof input[k] === 'string' ? input[k].trim() : input[k];
  item.status = item.status || data.statuses[0].name;
  item.history.push({ status: item.status, at: now() });
  item.events = cleanEvents(input.events);
  data.items.push(item);
  saveApps(data);
  return item;
}

export function updateApp(appId, patch) {
  const data = loadApps();
  const item = data.items.find((x) => x.id === appId);
  if (!item) throw new Error('投递记录不存在');
  const prev = item.status;
  for (const k of APP_FIELDS) if (patch[k] !== undefined) item[k] = typeof patch[k] === 'string' ? patch[k].trim() : patch[k];
  if (patch.events !== undefined) item.events = cleanEvents(patch.events);
  if (item.status !== prev) {
    item.history = item.history || [];
    item.history.push({ status: item.status, at: now() });
    // 第一次变成「已投递」且没填投递日期时，自动补今天
    if (!item.appliedAt && item.status !== data.statuses[0].name) item.appliedAt = new Date().toISOString().slice(0, 10);
  }
  item.updatedAt = now();
  saveApps(data);
  return item;
}

export function deleteApp(appId) {
  const data = loadApps();
  const before = data.items.length;
  data.items = data.items.filter((x) => x.id !== appId);
  if (data.items.length === before) throw new Error('投递记录不存在');
  saveApps(data);
}

export function saveStatuses(statuses) {
  const list = (Array.isArray(statuses) ? statuses : []).map((s) => ({
    name: String(s.name || '').trim().slice(0, 16),
    color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#64748b',
    stage: ['todo', 'active', 'interview', 'offer', 'closed'].includes(s.stage) ? s.stage : 'active',
  })).filter((s) => s.name);
  const names = new Set();
  for (const s of list) { if (names.has(s.name)) throw new Error('状态名重复：' + s.name); names.add(s.name); }
  if (!list.length) throw new Error('至少保留一个状态');
  const data = loadApps();
  data.statuses = list;
  saveApps(data);
  return list;
}

// 简历改名/删除时同步投递记录里的引用
export function renameResumeRefs(from, to) {
  const data = loadApps();
  let changed = false;
  for (const it of data.items) if (it.resumeSlug === from) { it.resumeSlug = to; changed = true; }
  if (changed) saveApps(data);
  const jds = loadJds();
  let jdChanged = false;
  for (const j of jds) {
    if (j.baseSlug === from) { j.baseSlug = to; jdChanged = true; }
    if (j.tailoredSlug === from) { j.tailoredSlug = to; jdChanged = true; }
  }
  if (jdChanged) writeJson(JDS, jds);
}

export function loadJds() {
  const list = readJson(JDS, []);
  return Array.isArray(list) ? list : [];
}

const JD_FIELDS = ['company', 'role', 'link', 'text', 'baseSlug', 'tailoredSlug', 'analysis', 'match', 'tailor', 'interview', 'appId'];

export function saveJd(input) {
  const list = loadJds();
  let item = input.id ? list.find((x) => x.id === input.id) : null;
  if (!item) {
    item = { id: id(), createdAt: now() };
    list.unshift(item);
  }
  for (const k of JD_FIELDS) if (input[k] !== undefined) item[k] = input[k];
  item.updatedAt = now();
  writeJson(JDS, list);
  return item;
}

export function deleteJd(jdId, opts = {}) {
  const r = deleteJds([jdId], opts);
  if (!r.deleted.length) throw new Error('JD 不存在');
  return r;
}

export function deleteJds(ids, { deleteTailored = false } = {}) {
  const want = [...new Set((Array.isArray(ids) ? ids : [ids]).map((x) => String(x || '')).filter(Boolean))];
  if (!want.length) throw Object.assign(new Error('请选择要删除的 JD'), { status: 400 });
  const list = loadJds();
  const apps = loadApps();
  const snapshots = [];
  for (const jdId of want) {
    const item = list.find((x) => x.id === jdId);
    if (!item) continue;
    const unlinkedAppIds = [];
    for (const app of apps.items) {
      if (app.jdId === jdId) { app.jdId = ''; unlinkedAppIds.push(app.id); }
    }
    let trashed = null;
    if (deleteTailored && item.tailoredSlug && hasResume(item.tailoredSlug)) {
      trashed = trashResume(item.tailoredSlug);
    }
    snapshots.push({ item, unlinkedAppIds, trashed });
  }
  if (!snapshots.length) throw new Error('JD 不存在');
  const drop = new Set(snapshots.map((s) => s.item.id));
  writeJson(JDS, list.filter((x) => !drop.has(x.id)));
  if (snapshots.some((s) => s.unlinkedAppIds.length)) saveApps(apps);
  return { ok: true, deleted: snapshots };
}

export function restoreJds(snapshots) {
  const rows = Array.isArray(snapshots) ? snapshots : [];
  if (!rows.length) throw Object.assign(new Error('没有可撤销的内容'), { status: 400 });
  const list = loadJds();
  const apps = loadApps();
  const restored = [];
  for (const s of rows) {
    const item = s && s.item;
    if (!item || !item.id) continue;
    if (!list.some((x) => x.id === item.id)) list.unshift(item);
    for (const aid of s.unlinkedAppIds || []) {
      const app = apps.items.find((x) => x.id === aid);
      if (app && !app.jdId) app.jdId = item.id;
    }
    if (s.trashed && s.trashed.path && s.trashed.slug) {
      try { restoreTrashed(s.trashed.path, s.trashed.slug); } catch (err) { /* 简历可能已被手动还原 */ }
    }
    restored.push(item.id);
  }
  writeJson(JDS, list);
  saveApps(apps);
  return { ok: true, restored };
}
