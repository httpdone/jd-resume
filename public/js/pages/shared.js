import { esc, icon } from '../ui.js';
import { get } from '../api.js';

let jdCache = null;
export async function loadJds(force = false) {
  if (!jdCache || force) jdCache = (await get('/api/jds')).items;
  return jdCache;
}

export async function jdSelectHtml(name = 'jd', selected = '') {
  const list = await loadJds(true);
  return '<select class="input sm" name="' + name + '"><option value="">不结合 JD</option>' + list.map((j) => '<option value="' + j.id + '"' + (j.id === selected ? ' selected' : '') + '>' + esc([j.company, j.role].filter(Boolean).join(' · ') || '未命名 JD') + '</option>').join('') + '</select>';
}

export async function jdById(id) {
  if (!id) return null;
  const list = await loadJds();
  const j = list.find((x) => x.id === id);
  return j ? { company: j.company, role: j.role, text: j.text, analysis: j.analysis } : null;
}

export function thinkingBox(label = 'Agent 正在分析…') {
  return '<div class="thinking"><span class="pulse"></span><span class="lbl">' + esc(label) + '</span><span style="margin-left:auto" class="small cnt"></span><button class="btn xs ghost" data-stop>' + icon('stop') + '停止</button></div><div class="ai-stream"></div>';
}

// 把流式输出挂到 thinkingBox 上
export function streamHandlers(box, opts = {}) {
  const pre = box.querySelector('.ai-stream');
  const cnt = box.querySelector('.cnt');
  let n = 0;
  return {
    onDelta: (t, full) => {
      n = full.length;
      if (cnt) cnt.textContent = n + ' 字';
      if (opts.json) { if (pre) pre.textContent = ''; return; }
      if (pre) pre.textContent = full;
    },
    onThinking: (t) => { const l = box.querySelector('.lbl'); if (l) l.textContent = '模型思考中…'; if (opts.json) return; if (pre && !n) pre.textContent += t; },
    onMeta: (m) => { const l = box.querySelector('.lbl'); if (l && m.mock) l.textContent = '演示模式生成中…'; },
  };
}

export const VERDICT = { strong: '高度匹配', weak: '基本匹配', risky: '有风险', not_recommended: '不建议投递' };
export const LEVEL_BADGE = { high: 'bad', medium: 'warn', low: 'info' };
export const LEVEL_TEXT = { high: '高', medium: '中', low: '低' };

export async function loadStories() {
  try { return (await get('/api/stories')).items || []; } catch { return []; }
}
