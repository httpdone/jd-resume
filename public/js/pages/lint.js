import { esc } from '../ui.js';

const RISKY = ['主导', '上线', '企业级', '显著提升', '精通', '全面负责', '赋能', '闭环', '抓手', '沉淀'];

// 本地即时体检：不调用 AI
export function lintLocal(rd) {
  const items = rd.items().filter((i) => i.text);
  const todos = rd.countTodos();
  const risky = [];
  const noNum = [];
  const long = [];
  for (const it of items) {
    for (const w of RISKY) if (it.text.includes(w)) risky.push({ id: it.id, w });
    const lines = it.text.split('\n').filter((l) => l.length > 10);
    if (lines.length >= 2 && !/\d/.test(it.text) && !['skill_list', 'honor'].includes(it.module)) noNum.push(it);
    if (lines.some((l) => l.length > 130)) long.push(it);
  }
  const pages = rd.pages().length;
  const chip = (cls, text, id = '') => '<span class="chip ' + cls + '" ' + (id ? 'data-lint="' + esc(id) + '" style="cursor:pointer"' : '') + '>' + text + '</span>';
  let chips = chip(pages <= 2 ? 'hit' : 'miss', '共 ' + pages + ' 页' + (pages > 2 ? '（校招建议 1-2 页）' : ''));
  chips += chip(todos ? 'miss' : 'hit', todos ? todos + ' 处【待补充】' : '无待补充标记');
  const byWord = new Map();
  for (const r of risky) { if (!byWord.has(r.w)) byWord.set(r.w, []); byWord.get(r.w).push(r.id); }
  chips += byWord.size
    ? [...byWord].slice(0, 4).map(([w, ids]) => chip('miss', '强表述「' + esc(w) + '」' + (ids.length > 1 ? ' ×' + ids.length : ''), ids.join(','))).join('')
    : chip('hit', '无高风险强表述');
  chips += noNum.length ? noNum.slice(0, 3).map((i) => chip('miss', '缺量化：' + esc((i.title || i.moduleTitle).split(' ｜ ')[0].slice(0, 12)), i.id)).join('') : chip('hit', '经历均有数字支撑');
  if (long.length) chips += chip('', long.length + ' 条超长句');
  return { chips, todos, risky, noNum, long, pages };
}
