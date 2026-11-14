// 每个模块里的条目共用同一套「编辑框」结构（rs-* 命名，与模板里已有条目一致）。
// 只替换占位文字，不改成另一套简化 markup，这样新增条目才能和原有条目左右对齐。

export const DASH_TEXT = ' - ';

const RANGE_TYPES = new Set([
  'edus', 'works', 'internships', 'project_experience', 'reasearch_experience',
  'orgs', 'papers', 'campus',
]);
const SINGLE_TYPES = new Set(['honor', 'certificates']);
const BODY_TYPES = new Set(['skill_list', 'personal_summary', 'self_evaluation', 'hobbies', 'languages']);

export function itemKind(type) {
  if (BODY_TYPES.has(type)) return 'body';
  if (SINGLE_TYPES.has(type)) return 'single';
  return 'range';
}

export function itemPlaceholders(type) {
  const table = {
    edus: { org: '【学校名称】', start: '【开始时间】', end: '【结束时间】', role: '【专业 / 学历】', place: '【地点】', body: '【待补充：教育经历要点】' },
    works: { org: '【公司名称】', start: '【开始时间】', end: '【结束时间】', role: '【职位】', place: '【地点】', body: '【待补充：工作内容与结果】' },
    internships: { org: '【公司名称】', start: '【开始时间】', end: '【结束时间】', role: '【职位】', place: '【地点】', body: '【待补充：实习内容与结果】' },
    project_experience: { org: '【项目名称】', start: '【开始时间】', end: '【结束时间】', role: '【角色 / 简介】', place: '【地点】', body: '【待补充：项目要点】' },
    reasearch_experience: { org: '【课题 / 实验室】', start: '【开始时间】', end: '【结束时间】', role: '【角色】', place: '【地点】', body: '【待补充：研究内容与成果】' },
    orgs: { org: '【组织名称】', start: '【开始时间】', end: '【结束时间】', role: '【职务】', place: '【地点】', body: '【待补充：组织经历要点】' },
    honor: { org: '【奖项名称】', start: '【时间】', end: '', role: '', place: '', body: '' },
    certificates: { org: '【证书名称】', start: '【时间】', end: '', role: '', place: '', body: '' },
    skill_list: { org: '', start: '', end: '', role: '', place: '', body: '【待补充：按「后端 / 前端 / AI / 工具」分组的技能】' },
    personal_summary: { org: '', start: '', end: '', role: '', place: '', body: '【待补充：个人总结，点明目标方向与亮点】' },
    self_evaluation: { org: '', start: '', end: '', role: '', place: '', body: '【待补充：自我评价】' },
  };
  return table[type] || { org: '【标题】', start: '【开始时间】', end: '【结束时间】', role: '【角色】', place: '【地点】', body: '【待补充：要点】' };
}

/** 左侧填报卡片的字段标签。经历类用开始/结束两个日期，不再用一个「时间」字符串。 */
export function fieldLabels(type) {
  const kinds = {
    edus: { org: '学校', start: '开始时间', end: '结束时间', role: '专业 / 学历', place: '地点', body: '要点' },
    internships: { org: '公司', start: '开始时间', end: '结束时间', role: '职位', place: '地点', body: '要点' },
    works: { org: '公司', start: '开始时间', end: '结束时间', role: '职位', place: '地点', body: '要点' },
    project_experience: { org: '项目名称', start: '开始时间', end: '结束时间', role: '角色 / 简介', place: '地点', body: '要点' },
    reasearch_experience: { org: '课题 / 实验室', start: '开始时间', end: '结束时间', role: '角色', place: '地点', body: '要点' },
    orgs: { org: '组织', start: '开始时间', end: '结束时间', role: '职务', place: '地点', body: '要点' },
    honor: { org: '奖项名称', start: '时间' },
    certificates: { org: '证书名称', start: '时间' },
    skill_list: { body: '技能' },
    personal_summary: { body: '个人总结' },
    self_evaluation: { body: '自我评价' },
  };
  if (kinds[type]) return kinds[type];
  const k = itemKind(type);
  if (k === 'body') return { body: '内容' };
  if (k === 'single') return { org: '名称', start: '时间' };
  return { org: '名称', start: '开始时间', end: '结束时间', role: '角色', place: '地点', body: '要点' };
}

// 「2020年09月 - 2024年06月」「2024年09月-至今」「2024」
export function parseDateRange(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return { start: '', end: '' };
  const m = t.match(/^(.*?)(?:\s*[-–—~]\s*|\s+至\s+|\s+到\s+)(.+)$/);
  if (m && m[1].trim()) return { start: m[1].trim(), end: m[2].trim() };
  return { start: t, end: '' };
}

// 旧版正文靠组件作用域属性套样式，现在样式只依赖类名；保留这两个函数名以免调用方报错。
export function findScopeName() {
  return '';
}

export function stampScope() {}

function el(doc, tag, className, attrs = {}) {
  const n = doc.createElement(tag);
  if (className) n.className = className;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style') n.setAttribute('style', v);
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  return n;
}

function ensurePoint(right, doc) {
  let p = right.querySelector('.rs-dot');
  if (!p) {
    p = el(doc, 'div', 'rs-dot');
    right.prepend(p);
  }
  return p;
}

function dateSpans(right) {
  return [...right.childNodes].filter((n) => n.nodeType === 1 && n.tagName === 'SPAN');
}

export function applyDateSpans(right, { start = '', end = '' } = {}, { single = false, keepDash = true } = {}) {
  if (!right) return;
  const doc = right.ownerDocument;
  ensurePoint(right, doc);
  if (single) {
    let spans = dateSpans(right);
    if (!spans[0]) {
      const s = el(doc, 'span');
      right.appendChild(s);
      spans = [s];
    }
    spans[0].textContent = start || end || '';
    spans.slice(1).forEach((s) => s.remove());
    return;
  }
  let spans = dateSpans(right);
  while (spans.length < 3) {
    const s = el(doc, 'span');
    right.appendChild(s);
    spans = dateSpans(right);
  }
  spans.slice(3).forEach((s) => s.remove());
  spans = dateSpans(right);
  spans[0].textContent = start;
  const showDash = Boolean(String(start).trim() && String(end).trim());
  if (showDash) {
    if (!keepDash || !String(spans[1].textContent).trim()) spans[1].textContent = DASH_TEXT;
  } else spans[1].textContent = '';
  spans[2].textContent = end;
}

export function setCellText(cell, text, { bold = false } = {}) {
  if (!cell) return;
  const want = text == null ? '' : String(text);
  const boldEl = cell.querySelector('.rs-bold, span.rs-bold');
  if (bold) {
    if (boldEl) { boldEl.textContent = want; return; }
    const span = el(cell.ownerDocument, 'span', 'rs-bold');
    span.textContent = want;
    cell.textContent = '';
    cell.appendChild(span);
    return;
  }
  if (boldEl && cell.childElementCount === 1) { boldEl.textContent = want; return; }
  const span = cell.querySelector('span');
  if (span && cell.childElementCount === 1 && !span.classList.contains('rs-dot')) span.textContent = want;
  else cell.textContent = want;
}

function ensureTitleRow(row, { attr, withBold = false } = {}) {
  const doc = row.ownerDocument;
  let left = row.querySelector(':scope > .left');
  if (!left) {
    left = el(doc, 'div', 'left');
    row.prepend(left);
  }
  if (withBold && !left.querySelector('.rs-bold')) {
    const span = el(doc, 'span', 'rs-bold');
    while (left.firstChild) span.appendChild(left.firstChild);
    left.appendChild(span);
  }
  let right = row.querySelector(':scope > .right');
  if (!right) {
    right = el(doc, 'div', 'right');
    row.appendChild(right);
  }
  if (attr) stampScope(row, attr);
  return { left, right };
}

function ensureContent(item, attr) {
  const doc = item.ownerDocument;
  let wrap = item.querySelector(':scope > .menu-content-wrapper');
  if (!wrap) {
    wrap = el(doc, 'div', 'menu-content-wrapper');
    item.appendChild(wrap);
  }
  let content = wrap.querySelector('.menu-content');
  if (!content) {
    content = el(doc, 'div', 'menu-content');
    wrap.appendChild(content);
  }
  if (attr) stampScope(wrap, attr);
  return content;
}

// 给条目补齐与模板一致的骨架（类名、日期三 span、圆点、两行标题），不改已有文字。
export function ensureItemSkeleton(item, type, { scope } = {}) {
  if (!item) return item;
  const doc = item.ownerDocument;
  const attr = scope || findScopeName(item, doc);
  const kind = itemKind(type);
  item.classList.add('menu', 'section-item-container');
  stampScope(item, attr);

  if (kind === 'body') { ensureContent(item, attr); return item; }

  let rows = [...item.querySelectorAll(':scope > .menu-title')];
  if (!rows[0]) {
    const row = el(doc, 'div', 'menu-title');
    const content = item.querySelector(':scope > .menu-content-wrapper');
    if (content) content.before(row); else item.appendChild(row);
    rows = [...item.querySelectorAll(':scope > .menu-title')];
  }
  const first = ensureTitleRow(rows[0], { attr, withBold: kind === 'range' || type === 'honor' || type === 'certificates' });
  if (kind === 'single') {
    applyDateSpans(first.right, { start: dateSpans(first.right)[0]?.textContent || '' }, { single: true, keepDash: true });
  } else {
    ensurePoint(first.right, doc);
    const existing = dateSpans(first.right);
    if (existing.length === 0) {
      // 原来没有日期文字：只保留圆点，不要凭空画出「 - 」
    } else if (existing.length === 1 && !parseDateRange(existing[0].textContent).end) {
      applyDateSpans(first.right, { start: existing[0].textContent.trim(), end: '' }, { single: false, keepDash: true });
    } else {
      const cur = parseDateRange(first.right.textContent);
      applyDateSpans(first.right, cur, { single: false, keepDash: true });
    }
  }

  if (kind === 'range') {
    rows = [...item.querySelectorAll(':scope > .menu-title')];
    if (!rows[1]) {
      const row = el(doc, 'div', 'menu-title');
      rows[0].after(row);
      rows = [...item.querySelectorAll(':scope > .menu-title')];
    }
    ensureTitleRow(rows[1], { attr, withBold: false });
    const left = (rows[1].querySelector('.left')?.textContent || '').trim();
    const right = (rows[1].querySelector('.right')?.textContent || '').trim();
    rows[1].classList.toggle('rp-field-hidden', !left && !right);
  }
  ensureContent(item, attr);
  return item;
}

export function fillItemPlaceholders(item, type) {
  const kind = itemKind(type);
  const ph = itemPlaceholders(type);
  ensureItemSkeleton(item, type);
  if (kind === 'body') {
    const content = item.querySelector('.menu-content');
    if (content && ph.body) content.innerHTML = '<p>' + ph.body + '</p>';
    return;
  }
  const rows = [...item.querySelectorAll(':scope > .menu-title')];
  setCellText(rows[0]?.querySelector('.left'), ph.org, { bold: kind === 'range' || kind === 'single' });
  applyDateSpans(rows[0]?.querySelector('.right'), { start: ph.start, end: ph.end }, { single: kind === 'single', keepDash: false });
  if (kind === 'range' && rows[1]) {
    setCellText(rows[1].querySelector('.left'), ph.role);
    setCellText(rows[1].querySelector('.right'), ph.place);
    rows[1].classList.remove('rp-field-hidden'); // 新增条目把第二行亮出来，方便填写
  }
  const content = item.querySelector('.menu-content');
  if (!content) return;
  if (!ph.body) content.innerHTML = '';
  else if (type === 'skill_list' || type === 'personal_summary' || type === 'self_evaluation') content.innerHTML = '<p>' + ph.body + '</p>';
  else content.innerHTML = '<ul><li>' + ph.body + '</li></ul>';
}

export function fillItemFields(item, type, fields = {}, { bodyHtml, keepBody = true } = {}) {
  const kind = itemKind(type);
  ensureItemSkeleton(item, type);
  if (kind === 'body') {
    if (bodyHtml != null && !keepBody) item.querySelector('.menu-content').innerHTML = bodyHtml;
    return;
  }
  const rows = [...item.querySelectorAll(':scope > .menu-title')];
  if (fields.org != null) setCellText(rows[0]?.querySelector('.left'), fields.org, { bold: kind === 'range' || kind === 'single' });
  if (fields.dates != null || fields.start != null || fields.end != null) {
    const range = fields.start != null || fields.end != null
      ? { start: fields.start || '', end: fields.end || '' }
      : parseDateRange(fields.dates);
    applyDateSpans(rows[0]?.querySelector('.right'), range, { single: kind === 'single', keepDash: true });
  }
  if (kind === 'range' && rows[1]) {
    if (fields.role != null) setCellText(rows[1].querySelector('.left'), fields.role);
    if (fields.place != null) setCellText(rows[1].querySelector('.right'), fields.place);
    const left = (rows[1].querySelector('.left')?.textContent || '').trim();
    const right = (rows[1].querySelector('.right')?.textContent || '').trim();
    rows[1].classList.toggle('rp-field-hidden', !left && !right);
  }
  if (bodyHtml != null && !keepBody) {
    const content = item.querySelector('.menu-content');
    if (content) content.innerHTML = bodyHtml;
  }
}

// 条目是否已是规范编辑框（供测试与自检）
export function inspectItem(item, type) {
  const kind = itemKind(type);
  const row0 = item.querySelector(':scope > .menu-title');
  const right = row0?.querySelector('.right');
  return {
    kind,
    scoped: hasScope(item) && (!row0 || hasScope(row0)),
    hasPoint: !!item.querySelector('.rs-dot'),
    dateSpans: right ? dateSpans(right).length : 0,
    rows: item.querySelectorAll(':scope > .menu-title').length,
    hasContent: !!item.querySelector('.menu-content'),
    boxStyle: (item.getAttribute('style') || '').includes('border-color'),
    titleDisplayHint: 'flex',
  };
}
