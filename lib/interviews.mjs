// 模拟面试会话与错题本
import path from 'node:path';
import { DATA_DIR } from './config.mjs';
import { readJson, writeJson, newId, nowIso } from './jsonfile.mjs';

const FILE = path.join(DATA_DIR, 'interviews.json');
export const INTERVIEW_TYPES = [
  { id: 'tech', name: '技术一面' },
  { id: 'project', name: '项目深挖' },
  { id: 'hr', name: 'HR 面' },
];

function load() {
  const d = readJson(FILE, null) || {};
  return { sessions: Array.isArray(d.sessions) ? d.sessions : [], wrong: Array.isArray(d.wrong) ? d.wrong : [] };
}
function save(d) { writeJson(FILE, { sessions: d.sessions, wrong: d.wrong }); }

export function loadInterviews() {
  const d = load();
  return { sessions: d.sessions.map(brief), wrong: d.wrong, types: INTERVIEW_TYPES };
}
const brief = (s) => ({
  id: s.id, type: s.type, typeName: (INTERVIEW_TYPES.find((t) => t.id === s.type) || {}).name || s.type,
  rounds: s.rounds, resumeSlug: s.resumeSlug, jdId: s.jdId, appId: s.appId,
  company: s.company, role: s.role, status: s.status, createdAt: s.createdAt, updatedAt: s.updatedAt,
  turns: (s.messages || []).filter((m) => m.role === 'assistant').length,
  score: s.review?.score, summary: s.review?.summary,
});

export function getSession(id) {
  const s = load().sessions.find((x) => x.id === id);
  if (!s) throw Object.assign(new Error('面试会话不存在'), { status: 404 });
  return s;
}

export function createSession(input) {
  if (!input.resumeSlug) throw Object.assign(new Error('请选择一份简历'), { status: 400 });
  const type = INTERVIEW_TYPES.some((t) => t.id === input.type) ? input.type : 'tech';
  const rounds = Math.max(3, Math.min(12, Number(input.rounds) || 6));
  const item = {
    id: newId(), type, rounds, resumeSlug: String(input.resumeSlug),
    jdId: input.jdId || '', appId: input.appId || '',
    company: String(input.company || '').slice(0, 80),
    role: String(input.role || '').slice(0, 80),
    messages: [], review: null, status: 'active',
    createdAt: nowIso(), updatedAt: nowIso(),
  };
  const d = load();
  d.sessions.unshift(item);
  save(d);
  return item;
}

export function updateSession(id, patch) {
  const d = load();
  const s = d.sessions.find((x) => x.id === id);
  if (!s) throw Object.assign(new Error('面试会话不存在'), { status: 404 });
  if (Array.isArray(patch.messages)) s.messages = patch.messages.slice(-80);
  if (patch.review !== undefined) s.review = patch.review;
  if (patch.status) s.status = patch.status;
  s.updatedAt = nowIso();
  save(d);
  return s;
}

export function deleteSession(id) {
  const d = load();
  const n = d.sessions.length;
  d.sessions = d.sessions.filter((x) => x.id !== id);
  if (d.sessions.length === n) throw Object.assign(new Error('面试会话不存在'), { status: 404 });
  save(d);
}

export function addWrong(input) {
  const d = load();
  const item = {
    id: newId(),
    question: String(input.question || '').slice(0, 500),
    type: input.type || 'tech',
    comment: String(input.comment || '').slice(0, 1000),
    reference: String(input.reference || '').slice(0, 2000),
    sessionId: input.sessionId || '',
    resumeSlug: input.resumeSlug || '',
    createdAt: nowIso(),
    lastAt: nowIso(),
    times: 1,
  };
  if (!item.question) throw Object.assign(new Error('题目不能为空'), { status: 400 });
  const exist = d.wrong.find((w) => w.question === item.question && w.resumeSlug === item.resumeSlug);
  if (exist) { exist.times += 1; exist.lastAt = nowIso(); exist.comment = item.comment || exist.comment; save(d); return exist; }
  d.wrong.unshift(item);
  save(d);
  return item;
}

export function deleteWrong(id) {
  const d = load();
  const n = d.wrong.length;
  d.wrong = d.wrong.filter((x) => x.id !== id);
  if (d.wrong.length === n) throw Object.assign(new Error('错题不存在'), { status: 404 });
  save(d);
}

export function renameInterviewRefs(from, to) {
  const d = load();
  let changed = false;
  for (const s of d.sessions) if (s.resumeSlug === from) { s.resumeSlug = to; changed = true; }
  for (const w of d.wrong) if (w.resumeSlug === from) { w.resumeSlug = to; changed = true; }
  if (changed) save(d);
}
