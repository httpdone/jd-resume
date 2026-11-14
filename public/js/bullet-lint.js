// 简历成稿规范检查（纯函数，浏览器与 Node 测试共用）。和提示词里的「简历成稿规范」一一对应。
export const BULLET_SPEC = { min: 30, ideal: [40, 80], max: 90, count: [2, 5], descMax: 70 };

// 简历计字：汉字/全角标点算 1，连续英文/数字按约 0.5 算
export function cvLen(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const zh = (t.match(/[^\x00-\xff]/g) || []).length;
  const ascii = t.replace(/[^\x00-\xff]/g, '').replace(/\s+/g, '').length;
  return Math.round(zh + ascii * 0.5);
}

function stripTags(h) { return String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim(); }

export function splitHtml(html) {
  const s = String(html || '');
  const bullets = [...s.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => stripTags(m[1]));
  const paras = [...s.replace(/<ul[\s\S]*?<\/ul>|<ol[\s\S]*?<\/ol>/gi, '').matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => stripTags(m[1])).filter(Boolean);
  if (!bullets.length && !paras.length && stripTags(s)) paras.push(stripTags(s));
  return { bullets, paras };
}

// 「多源内容提取：」「<strong>并发控制</strong>：」这类小标题起句
export const LEAD_IN_RE = /^\s*[-•·]?\s*[^，。；：:,.;]{2,14}[：:]\s*\S/;
export function hasLeadIns(html) { return splitHtml(html).bullets.some((b) => LEAD_IN_RE.test(b)); }

export function numbersOf(text) {
  return [...new Set((String(text || '').match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(/,/g, '')))];
}

const FLUFF = ['赋能', '形成闭环', '打造抓手', '沉淀方法论', '横向拉通', '全面助力', '全方位', '深度参与', '极大地', '显著地', '有效地提升', '充分体现'];

// 返回问题列表：[{ level: 'warn'|'info', text }]
export function lintBullets(after, { before = '', sources = '', isProject = true } = {}) {
  const out = [];
  const { bullets, paras } = splitHtml(after);
  bullets.forEach((b, i) => {
    const n = cvLen(b.replace(/【待补充[：:][^】]*】/g, ''));
    if (n > BULLET_SPEC.max) out.push({ level: 'warn', text: '第 ' + (i + 1) + ' 条约 ' + n + ' 字，超过 ' + BULLET_SPEC.max + ' 字上限' });
    else if (n < BULLET_SPEC.min && bullets.length > 1) out.push({ level: 'info', text: '第 ' + (i + 1) + ' 条只有约 ' + n + ' 字，信息偏少' });
  });
  if (isProject && bullets.length > BULLET_SPEC.count[1]) out.push({ level: 'warn', text: bullets.length + ' 条 bullet，建议压到 ' + BULLET_SPEC.count[1] + ' 条以内' });
  if (isProject) paras.forEach((p) => {
    const sentences = p.split(/[。！？!?]/).filter((x) => x.trim()).length;
    if (sentences > 2 || cvLen(p) > BULLET_SPEC.descMax + 20) out.push({ level: 'warn', text: '项目描述偏长（约 ' + cvLen(p) + ' 字），建议 1-2 句' });
  });
  if (!hasLeadIns(before) && hasLeadIns(after)) out.push({ level: 'warn', text: '新增了「xx：」式小标题，原文没有' });
  const known = new Set(numbersOf(before + ' ' + sources));
  const fresh = numbersOf(stripTags(after).replace(/【待补充[：:][^】]*】/g, '')).filter((n) => !known.has(n));
  if (fresh.length) out.push({ level: 'warn', text: '出现原文和素材里都没有的数字：' + fresh.slice(0, 6).join('、') + '，请核对' });
  const fl = FLUFF.filter((w) => stripTags(after).includes(w) && !stripTags(before).includes(w));
  if (fl.length) out.push({ level: 'info', text: '套话：' + fl.join('、') });
  return out;
}
