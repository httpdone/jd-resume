// 用户数据目录的首次初始化、导入示例数据、删除所有用户数据
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOME, HOME_MODE, ROOT, RESUMES_DIR, DATA_DIR, OUT_DIR, STARTER_DIR, EXAMPLES_DIR, TEMPLATE_DIR, PUBLIC_DIR, ASSETS_DIR } from './config.mjs';
import { readJson, writeJson } from './jsonfile.mjs';

const MARKER = path.join(DATA_DIR, '.initialized');
export const WIPE_CONFIRM = 'DELETE_ALL_USER_DATA';

const isResumeDir = (dir, name) => !name.startsWith('.') && fs.existsSync(path.join(dir, name, 'body.html'));
function resumeNames(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && isResumeDir(dir, d.name)).map((d) => d.name); } catch { return []; }
}

/** 程序自带的入门模板（starter/ 下第一份简历），用户删掉自己的副本后也一直可用 */
export function starterBodyFile() {
  const name = resumeNames(STARTER_DIR)[0];
  return name ? path.join(STARTER_DIR, name, 'body.html') : path.join(TEMPLATE_DIR, 'base.html');
}

function copyResume(srcDir, name, { touch = false } = {}) {
  const dest = path.join(RESUMES_DIR, name);
  if (fs.existsSync(dest)) return false;
  fs.cpSync(path.join(srcDir, name), dest, { recursive: true, filter: (p) => !/(^|[\\/])\.history([\\/]|$)/.test(p) });
  if (touch) {
    const metaFile = path.join(dest, 'meta.json');
    const meta = readJson(metaFile, {}) || {};
    const now = new Date().toISOString();
    writeJson(metaFile, { ...meta, name, createdAt: now, updatedAt: now });
  }
  return true;
}

/**
 * 首次启动：数据目录还没有初始化标记、也没有任何简历时，复制一份入门模板并写入标记。
 * 之后用户删掉入门模板也不会再出现（标记已存在）。素材 / JD / 投递 / 面试数据一开始都是空的。
 */
export function initUserData() {
  fs.mkdirSync(RESUMES_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(MARKER)) return { created: [] };
  const created = [];
  if (!resumeNames(RESUMES_DIR).length) {
    for (const name of resumeNames(STARTER_DIR)) if (copyResume(STARTER_DIR, name, { touch: true })) created.push(name);
  }
  fs.writeFileSync(MARKER, new Date().toISOString() + '\n', 'utf8');
  return { created };
}

function mergeById(target = [], incoming = []) {
  const ids = new Set(target.map((x) => x && x.id).filter(Boolean));
  let added = 0;
  for (const item of incoming) {
    if (!item || (item.id && ids.has(item.id))) continue;
    target.push(item); if (item.id) ids.add(item.id); added++;
  }
  return added;
}

/** 把 examples/ 里的示例简历与数据导入用户目录：已有同名简历跳过，数据按 id 合并、不覆盖 */
export function importExamples() {
  const exResumes = path.join(EXAMPLES_DIR, 'resumes');
  const exData = path.join(EXAMPLES_DIR, 'data');
  if (!fs.existsSync(EXAMPLES_DIR)) throw new Error('程序目录里没有 examples/ 示例数据');
  fs.mkdirSync(RESUMES_DIR, { recursive: true });
  const resumes = { added: [], skipped: [] };
  for (const name of resumeNames(exResumes)) (copyResume(exResumes, name) ? resumes.added : resumes.skipped).push(name);

  const counts = {};
  const file = (n) => [path.join(exData, n), path.join(DATA_DIR, n)];
  // 经历素材 { items }
  {
    const [src, dst] = file('stories.json');
    const ex = readJson(src, null);
    if (ex) { const cur = readJson(dst, null) || {}; const items = Array.isArray(cur) ? cur : (cur.items || []); counts.stories = mergeById(items, Array.isArray(ex) ? ex : ex.items || []); writeJson(dst, { items }); }
  }
  // JD 库 []
  {
    const [src, dst] = file('jds.json');
    const ex = readJson(src, null);
    if (ex) { const cur = readJson(dst, null); const list = Array.isArray(cur) ? cur : []; counts.jds = mergeById(list, Array.isArray(ex) ? ex : []); writeJson(dst, list); }
  }
  // 投递 { statuses, items }：用户已有自定义状态时保留用户的
  {
    const [src, dst] = file('applications.json');
    const ex = readJson(src, null);
    if (ex) {
      const cur = readJson(dst, null) || {};
      const items = Array.isArray(cur.items) ? cur.items : [];
      counts.applications = mergeById(items, ex.items || []);
      const statuses = Array.isArray(cur.statuses) && cur.statuses.length ? cur.statuses : ex.statuses;
      writeJson(dst, statuses ? { statuses, items } : { items });
    }
  }
  // 模拟面试 { sessions, wrong }
  {
    const [src, dst] = file('interviews.json');
    const ex = readJson(src, null);
    if (ex) {
      const cur = readJson(dst, null) || {};
      const sessions = Array.isArray(cur.sessions) ? cur.sessions : [];
      const wrong = Array.isArray(cur.wrong) ? cur.wrong : [];
      counts.interviews = mergeById(sessions, ex.sessions || []) + mergeById(wrong, ex.wrong || []);
      writeJson(dst, { sessions, wrong });
    }
  }
  return { resumes, counts };
}

const within = (child, parent) => { const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };

/**
 * 删除所有用户数据：只删除 HOME 下的 resumes/、data/（含设置、API Key、素材库）、out/，
 * 绝不触碰程序目录里的 template / public / assets / starter / examples。删完重新初始化（入门模板）。
 */
export function wipeUserData(confirm) {
  if (confirm !== WIPE_CONFIRM) throw Object.assign(new Error('缺少确认口令，未删除任何数据'), { status: 400 });
  const home = path.resolve(HOME);
  if (home === path.parse(home).root || home === path.resolve(os.homedir())) throw new Error('数据目录是系统根目录或用户主目录，拒绝删除：' + home);
  const protectedDirs = [STARTER_DIR, EXAMPLES_DIR, TEMPLATE_DIR, PUBLIC_DIR, ASSETS_DIR].map((p) => path.resolve(p));
  const removed = [];
  for (const dir of [RESUMES_DIR, DATA_DIR, OUT_DIR]) {
    const target = path.resolve(dir);
    if (path.dirname(target) !== home || !within(target, home) || target === home) throw new Error('路径异常，拒绝删除：' + target);
    if (protectedDirs.some((p) => within(p, target) || within(target, p))) throw new Error('路径与程序目录重叠，拒绝删除：' + target);
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { recursive: true, force: true });
    removed.push(target);
  }
  const init = initUserData();
  return { home, mode: HOME_MODE, removed, created: init.created };
}

export function dataInfo() {
  return { home: HOME, mode: HOME_MODE, programDir: ROOT, hasExamples: fs.existsSync(path.join(EXAMPLES_DIR, 'resumes')) };
}
