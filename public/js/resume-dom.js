// 操作 iframe 里的简历 DOM：识别模块、同步多页副本、自动分页、写回 AI 改写
// 关键约定：每一页 .main 里都放着整份内容的副本（.content-scroll），靠负 margin-top 显示不同片段，
// 所以任何修改都要同步到所有页；类名一律不动。

import { prefixForModule, ensureItemRefs, shortTitle } from './refs.js';
import { itemKind, parseDateRange, findScopeName, stampScope, ensureItemSkeleton, fillItemPlaceholders, fillItemFields, applyDateSpans, setCellText } from './item-layout.js';

const ALLOWED = { P: 'p', UL: 'ul', OL: 'ol', LI: 'li', STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', BR: 'br' };
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'IMG', 'SVG', 'VIDEO', 'AUDIO', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT']);

export const MODULE_NAMES = {
  personal_summary: '个人总结', edus: '教育经历', works: '工作/实习经历', internships: '实习经历', project_experience: '项目经历',
  skill_list: '专业技能', orgs: '组织经历', reasearch_experience: '研究经历', honor: '荣誉奖项', self_evaluation: '自我评价',
  certificates: '证书', languages: '语言能力', hobbies: '兴趣爱好', papers: '论文', campus: '校园经历',
};

export const ADDABLE_MODULES = [
  ['edus', '教育经历'], ['works', '工作/实习经历'], ['project_experience', '项目经历'],
  ['reasearch_experience', '研究经历'], ['skill_list', '专业技能'], ['honor', '荣誉奖项'],
  ['certificates', '证书'], ['self_evaluation', '自我评价'], ['orgs', '组织经历'],
  ['personal_summary', '个人总结'], ['custom', '自定义模块'],
];

export const CHROME_SEL = '[data-rp-chrome], .rp-media-bar, .rp-add-crest, .rp-add-media, .rp-struct-bar, .edu-crest, .rp-media-ph';

export function cleanClone(el) {
  if (!el) return null;
  const c = el.cloneNode(true);
  c.querySelectorAll(CHROME_SEL + ', button, script, style, object').forEach((n) => n.remove());
  return c;
}

export function isChromeNode(n) {
  if (!n || n.nodeType !== 1) return false;
  return n.matches?.(CHROME_SEL) || n.tagName === 'BUTTON' || n.classList?.contains('edu-crest');
}

// 把模型给的 HTML 清洗成只含安全标签的片段
export function sanitizeHtml(html, doc = document) {
  const tpl = doc.createElement('template');
  tpl.innerHTML = String(html || '').trim();
  const out = doc.createElement('div');
  const walk = (src, dst) => {
    for (const node of [...src.childNodes]) {
      if (node.nodeType === 3) { dst.appendChild(doc.createTextNode(node.textContent)); continue; }
      if (node.nodeType !== 1) continue;
      if (DROP.has(node.tagName)) continue;
      const tag = ALLOWED[node.tagName];
      if (tag) {
        const e = doc.createElement(tag);
        dst.appendChild(e);
        walk(node, e);
      } else {
        walk(node, dst); // 其他标签：去壳保留文字
      }
    }
  };
  walk(tpl.content, out);
  // 纯文本：按行包成 <p>
  if (![...out.childNodes].some((n) => n.nodeType === 1 && n.tagName !== 'STRONG' && n.tagName !== 'EM' && n.tagName !== 'BR')) {
    const text = out.innerHTML.trim();
    if (!text) return '';
    return text.split(/\n+/).map((l) => '<p>' + l.trim() + '</p>').join('');
  }
  return out.innerHTML.replace(/\n{2,}/g, '\n').trim();
}

const norm = (s) => String(s || '').replace(/\u00a0/g, ' ').replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n').trim();

// 把正文 DOM 转成可读文本（列表项前加 •）
export function nodeText(root) {
  let out = '';
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) { out += c.textContent.replace(/[ \t\r\f\v]+/g, ' '); continue; }
      if (c.nodeType !== 1) continue;
      if (isChromeNode(c)) continue;
      const t = c.tagName;
      if (t === 'BR') { out += '\n'; continue; }
      if (t === 'LI') { out += '\n• '; walk(c); out += '\n'; continue; }
      if (t === 'P' || t === 'DIV' || t === 'UL' || t === 'OL' || t === 'H1' || t === 'H2' || t === 'H3' || t === 'SECTION') { out += '\n'; walk(c); out += '\n'; continue; }
      walk(c);
    }
  };
  walk(root);
  return out.split('\n').map((l) => {
    let s = norm(l);
    // 同一 bullet 内用「换行 + - 」分隔的要点，缩进为子条，避免被拼成一段
    if (/^[-－]\s+/.test(s) && !s.startsWith('•')) s = '  - ' + s.replace(/^[-－]\s+/, '');
    return s;
  }).filter(Boolean).join('\n');
}

export function htmlToText(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return nodeText(d);
}

function maskPrivate(text) {
  return text
    .replace(/(?<!\d)(1[3-9]\d)\d{4}(\d{4})(?!\d)/g, '$1****$2')
    .replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '$1***@$2');
}

function lastDeep(n) { while (n.lastChild) n = n.lastChild; return n; }

export class ResumeDoc {
  constructor(iframe) {
    this.iframe = iframe;
    this.doc = null;
    this.onChange = null; // 内容被用户编辑
    this.onLayout = null; // 页数/高度变化
    this.undoStack = [];
    this._syncTimer = null;
    this._pageTimer = null;
    this._editScroll = null;
    this.editable = false;
  }

  load(src) {
    return new Promise((resolve, reject) => {
      const done = async () => {
        this.iframe.removeEventListener('load', done);
        try {
          this.doc = this.iframe.contentDocument;
          if (!this.container()) throw new Error('简历内容里找不到 #cv-container');
          this.stripLegacyChrome();
          try { await Promise.race([this.doc.fonts.ready, new Promise((r) => setTimeout(r, 6000))]); } catch { /* 忽略 */ }
          this._bind();
          // 修复旧版本编辑留下的"竖排"内容（flex 里的混排文字）
          for (const sc of this.scrolls()) this.normalizeFlow(sc);
          this.normalizeAllItems();
          this.paginate();
          this.highlightTodos();
          resolve(this);
        } catch (e) { reject(e); }
      };
      this.iframe.addEventListener('load', done);
      this.iframe.src = src;
    });
  }

  container() { return this.doc?.getElementById('cv-container'); }
  pages() { return [...this.container().children].filter((e) => e.classList.contains('main')); }
  scrolls() { return this.pages().map((p) => p.querySelector('.content-scroll')).filter(Boolean); }
  primary() { return this.scrolls()[0]; }

  // ---------- 模块识别 ----------
  modules() {
    const root = this.primary();
    if (!root) return [];
    return [...root.querySelectorAll('.option')].map((opt) => {
      const type = [...opt.classList].find((c) => MODULE_NAMES[c]) || (MODULE_NAMES[opt.id] ? opt.id : '');
      const id = opt.id || type;
      const titleEl = opt.querySelector('.module-title-wrapper .title');
      const title = norm(titleEl ? cleanClone(titleEl).textContent : opt.querySelector('.module-title-wrapper')?.textContent) || MODULE_NAMES[type || id] || id;
      const items = [...opt.querySelectorAll(':scope > .info-content .section-item-container, :scope > .section-item-container')].map((it) => this._item(it, type || id, title));
      return { id, type: type || id, title, el: opt, items, hidden: opt.classList.contains('rp-mod-hidden'), modRef: prefixForModule(type || id) };
    }).filter((m) => m.id);
  }

  _item(it, moduleId, moduleTitle) {
    const content = it.querySelector('.menu-content');
    const titleText = [...it.querySelectorAll('.menu-title')].map((row) => {
      const clone = cleanClone(row);
      return [...(clone?.children || [])].map((c) => norm(c.textContent).replace(/\s*\n\s*/g, ' ')).filter(Boolean).join(' ｜ ');
    }).filter(Boolean).join(' ｜ ');
    const fields = this.itemFields(it);
    return {
      id: it.id, module: moduleId, moduleTitle, el: it,
      title: titleText.replace(/\s+-\s+/g, ' - '),
      contentEl: content,
      html: content ? cleanClone(content).innerHTML.trim() : '',
      text: content ? nodeText(cleanClone(content)) : '',
      editable: Boolean(content),
      fields,
    };
  }

  items() {
    const list = this.modules().flatMap((m) => m.items);
    return ensureItemRefs(list);
  }
  item(id) { return this.items().find((i) => i.id === id || i.ref === id); }

  itemFields(itEl) {
    const rows = [...(itEl?.querySelectorAll?.(':scope > .menu-title') || itEl?.querySelectorAll?.('.menu-title') || [])];
    const read = (el) => norm(cleanClone(el)?.textContent || '');
    const row0 = rows[0], row1 = rows[1];
    const dates = read(row0?.querySelector('.right'));
    const range = parseDateRange(dates);
    const content = itEl?.querySelector?.('.menu-content');
    const bullets = [...(content?.querySelectorAll('li') || [])].map((li) => (li.textContent || '').trim());
    const desc = [...(content?.querySelectorAll('p') || [])].filter((p) => !p.closest('li')).map((p) => (p.textContent || '').trim()).filter(Boolean).join('\n');
    const body = content ? nodeText(cleanClone(content)) : '';
    return {
      org: read(row0?.querySelector('.left')),
      dates,
      start: range.start,
      end: range.end,
      role: read(row1?.querySelector('.left')),
      place: read(row1?.querySelector('.right')),
      desc,
      bullets,
      body,
    };
  }

  profileText() {
    const user = cleanClone(this.primary()?.querySelector('.user'));
    if (!user) return '';
    const lines = [];
    const name = norm(user.querySelector('.user-name')?.textContent);
    if (name) lines.push(name);
    for (const item of user.querySelectorAll('.profile-item')) {
      const label = norm(item.querySelector('.attr-name')?.textContent);
      const span = item.querySelector('span') || item;
      let raw = norm(span.textContent);
      if (label && raw.startsWith(label)) raw = raw.slice(label.length).trim();
      else if (label) raw = raw.replace(label, '').trim();
      if (!raw && !label) continue;
      const lab = label.replace(/[：:]\s*$/, '');
      lines.push((lab ? lab + '：' : '') + raw);
    }
    return maskPrivate(lines.join('\n'));
  }

  candidateName() {
    return norm(this.primary()?.querySelector('.user-name')?.textContent) || '';
  }

  // 给大模型的结构化文本（电话、邮箱打码）
  toLLMText() {
    let s = '# 基本信息\n' + this.profileText() + '\n';
    for (const m of this.modules()) {
      if (m.hidden) continue;
      s += '\n## ' + m.title + '\n';
      const items = ensureItemRefs(m.items);
      for (const it of items) {
        s += '### ' + it.ref + ' ' + (it.title || it.label || m.title) + '\n';
        if (it.text) s += maskPrivate(it.text) + '\n';
      }
    }
    return s.trim();
  }

  payload() {
    const items = this.items();
    return {
      name: this.candidateName(),
      text: this.toLLMText(),
      items: items.map(({ id, ref, label, module, moduleTitle, title, html, text, editable }) => ({
        id, ref, label, module, moduleTitle, title, html, text: maskPrivate(text), editable,
      })),
      modules: this.modules().map((m) => ({ id: m.id, title: m.title, hidden: m.hidden, modRef: m.modRef })),
    };
  }

  // ATS 纯文本版：标准标题、单栏顺序，便于粘贴到网申表格
  toPlainText() {
    let s = this.profileText() + '\n';
    for (const m of this.modules()) {
      if (m.hidden) continue;
      s += '\n【' + m.title + '】\n';
      for (const it of m.items) {
        if (it.title) s += it.title + '\n';
        if (it.text) s += it.text.replace(/^• /gm, '- ') + '\n';
      }
    }
    return s.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  // ---------- 修改 ----------
  snapshot() {
    this.undoStack.push(this.container().innerHTML);
    if (this.undoStack.length > 40) this.undoStack.shift();
  }

  undo() {
    const html = this.undoStack.pop();
    if (html === undefined) return false;
    this.container().innerHTML = html;
    this.paginate();
    this.highlightTodos();
    return true;
  }

  applyItemHtml(id, html, { flash = true } = {}) {
    const clean = sanitizeHtml(html, this.doc);
    const targets = [...this.doc.querySelectorAll('[id="' + CSS.escape(id) + '"] .menu-content')];
    if (!targets.length) throw new Error('找不到条目 ' + id + ' 的正文区域');
    for (const t of targets) t.innerHTML = clean;
    if (flash) for (const t of targets) { t.classList.remove('rp-flash'); void t.offsetWidth; t.classList.add('rp-flash'); setTimeout(() => t.classList.remove('rp-flash'), 1700); }
    return clean;
  }

  reorderModules(order) {
    const root = this.primary();
    const wrap = root?.querySelector('.section-wrapper');
    if (!wrap || !Array.isArray(order)) return false;
    const current = [...wrap.children].filter((c) => c.classList.contains('option'));
    const byId = new Map(current.map((c) => [c.id, c]));
    const valid = order.filter((id) => byId.has(id));
    if (valid.length < 2) return false;
    const rest = current.filter((c) => !valid.includes(c.id));
    const sequence = [...valid.map((id) => byId.get(id)), ...rest];
    if (sequence.every((c, i) => c === current[i])) return false;
    const anchor = current[current.length - 1].nextSibling;
    for (const c of sequence) wrap.insertBefore(c, anchor);
    this.syncFrom(root);
    return true;
  }

  reorderItems(moduleId, order) {
    const root = this.primary();
    const box = root?.querySelector('[id="' + CSS.escape(moduleId) + '"] .info-content');
    if (!box || !Array.isArray(order)) return false;
    const current = [...box.children].filter((c) => c.classList.contains('section-item-container'));
    const byId = new Map(current.map((c) => [c.id, c]));
    const valid = order.filter((id) => byId.has(id));
    if (valid.length < 2) return false;
    const sequence = [...valid.map((id) => byId.get(id)), ...current.filter((c) => !valid.includes(c.id))];
    if (sequence.every((c, i) => c === current[i])) return false;
    const anchor = current[current.length - 1].nextSibling;
    for (const c of sequence) box.insertBefore(c, anchor);
    this.syncFrom(root);
    return true;
  }

  // 用某一页的内容覆盖其他页副本
  syncFrom(src) {
    for (const s of this.scrolls()) if (s !== src) s.innerHTML = src.innerHTML;
  }

  flushSync() {
    if (this._syncTimer) { clearTimeout(this._syncTimer); this._syncTimer = null; }
    if (this._editScroll && this._editScroll.isConnected) this.syncFrom(this._editScroll);
    this._editScroll = null;
  }

  // ---------- 自动分页 ----------
  paginate() {
    this.flushSync();
    const doc = this.doc;
    const pages = this.pages();
    if (!pages.length) return 0;
    const first = pages[0];
    const scroll0 = first.querySelector('.content-scroll');
    const content0 = first.querySelector('.content');
    if (!scroll0 || !content0) return pages.length;
    scroll0.style.marginTop = '0px';
    first.querySelectorAll('.cover').forEach((c) => { c.style.height = '0px'; });
    pages.slice(1).forEach((p) => p.remove());

    const base = scroll0.getBoundingClientRect().top;
    const lines = this._lines(scroll0, base);
    const total = Math.max(scroll0.scrollHeight, lines.length ? lines[lines.length - 1].bottom : 0);
    const titles = [...scroll0.querySelectorAll('.module-title-wrapper, .menu-title')].map((t) => {
      const r = t.getBoundingClientRect();
      return { top: r.top - base, bottom: r.bottom - base, module: t.classList.contains('module-title-wrapper') };
    });

    const visibleHeight = (page) => {
      const main = page.getBoundingClientRect();
      const content = page.querySelector('.content').getBoundingClientRect();
      const cover = page.querySelector('.cover:not(.rs-cover-clear)');
      const pad = cover ? parseFloat(getComputedStyle(cover).paddingBottom) || 0 : 0;
      return Math.min(content.bottom, main.bottom - pad) - content.top;
    };

    const starts = [0];
    const allPages = [first];
    let k = 0;
    while (k < 12) {
      const page = allPages[k];
      const V = visibleHeight(page);
      const s = starts[k];
      const limit = s + V;
      const cover = page.querySelector('.cover:not(.rs-cover-clear)');
      if (total <= limit + 1) { if (cover) cover.style.height = '0px'; break; }
      const cut = lines.find((l) => l.bottom > limit + 0.5);
      let b = cut ? cut.top : limit;
      if (b <= s + 40) b = limit;
      // 避免模块标题/条目标题孤零零留在页底：若分页点之前紧挨着的只有标题（中间没有正文行），把标题一起推到下一页
      const inTitle = (l) => titles.some((t) => l.top >= t.top - 1 && l.bottom <= t.bottom + 1);
      for (let guard = 0; guard < 4; guard++) {
        const t = titles.filter((x) => x.top < b - 0.5 && x.top > s + 120).sort((x, y) => y.top - x.top)[0];
        if (!t) break;
        const hasBody = lines.some((l) => l.top >= t.bottom - 1 && l.bottom <= b + 0.5 && !inTitle(l));
        if (hasBody) break;
        b = t.top - 2;
      }
      if (cover) {
        // .cover 是 border-box，padding-bottom（页边距）也算在 height 里
        const cs = getComputedStyle(cover);
        const extra = cs.boxSizing === 'border-box' ? (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.paddingTop) || 0) : 0;
        cover.style.height = (Math.max(0, limit - b) + extra) + 'px';
      }
      starts.push(b);
      const clone = this._clonePage(first, k + 1);
      allPages[allPages.length - 1].after(clone);
      allPages.push(clone);
      clone.querySelector('.content-scroll').style.marginTop = (-b) + 'px';
      k++;
    }
    this._afterLayout();
    return allPages.length;
  }

  _clonePage(first, index) {
    const clone = first.cloneNode(true);
    clone.setAttribute('data-resume-page', String(index + 1));
    const content = clone.querySelector('.content');
    if (content) content.setAttribute('data-page', String(index));
    const sc = clone.querySelector('.content-scroll');
    sc.style.position = '';
    clone.querySelectorAll('.cover').forEach((c) => { c.style.height = '0px'; });
    clone.querySelectorAll('[contenteditable]').forEach((e) => e.removeAttribute('contenteditable'));
    return clone;
  }

  _lines(root, base) {
    const doc = this.doc;
    const rects = [];
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
    const range = doc.createRange();
    let n;
    while ((n = walker.nextNode())) {
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.height > 0 && r.width > 0) rects.push({ top: r.top - base, bottom: r.bottom - base });
    }
    for (const img of root.querySelectorAll('img')) {
      const r = img.getBoundingClientRect();
      if (r.height > 0) rects.push({ top: r.top - base, bottom: r.bottom - base });
    }
    rects.sort((a, b) => a.top - b.top);
    const lines = [];
    for (const r of rects) {
      const last = lines[lines.length - 1];
      if (last && r.top < last.bottom - 3) { last.bottom = Math.max(last.bottom, r.bottom); last.top = Math.min(last.top, r.top); }
      else lines.push({ ...r });
    }
    return lines;
  }

  _afterLayout() {
    const h = this.doc.documentElement.scrollHeight;
    this.iframe.style.height = h + 'px';
    if (this.editable) this.setEditable(true);
    this.onLayout?.({ pages: this.pages().length, height: h });
  }

  // ---------- 编辑 ----------
  setEditable(on) {
    this.editable = on;
    this.doc.body.classList.toggle('rp-edit', on);
    for (const s of this.scrolls()) {
      if (on) { s.setAttribute('contenteditable', 'true'); s.setAttribute('spellcheck', 'false'); }
      else { s.removeAttribute('contenteditable'); s.removeAttribute('spellcheck'); }
      s.querySelectorAll('.user-avatar, .user-school, img, object, .rp-mod-hidden').forEach((el) => {
        if (on) el.setAttribute('contenteditable', 'false');
        else el.removeAttribute('contenteditable');
      });
    }
  }

  _bind() {
    const doc = this.doc;
    doc.addEventListener('input', (e) => {
      const sc = e.target.closest?.('.content-scroll') || doc.getSelection()?.anchorNode?.parentElement?.closest('.content-scroll');
      if (!sc) return;
      this._editScroll = sc;
      clearTimeout(this._syncTimer);
      this._syncTimer = setTimeout(() => this.flushSync(), 400);
      clearTimeout(this._pageTimer);
      this._pageTimer = setTimeout(() => { if (sc === this.primary()) this._repaginateKeepCaret(); }, 1500);
      this.onChange?.();
    });
    doc.addEventListener('focusout', () => {
      clearTimeout(this._pageTimer);
      setTimeout(() => { if (!doc.activeElement || !doc.activeElement.closest?.('.content-scroll')) { this.paginate(); this.highlightTodos(); } }, 50);
    });
    // 粘贴只保留纯文本，避免把网页样式带进简历
    doc.addEventListener('paste', (e) => {
      if (!this.editable) return;
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      doc.execCommand('insertText', false, text);
    });
    doc.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.onSaveKey?.(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (this.undoStack.length) { e.preventDefault(); if (this.undo()) this.onChange?.(); this.onUndo?.(); }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); return; }
      if (!this.editable || e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') { if (this._handleEnter(e.shiftKey)) e.preventDefault(); }
      else if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (this._guardMerge(e.key === 'Backspace' ? -1 : 1)) e.preventDefault();
        else { const c = this._caret(); if (c) this._styledBefore = { scroll: c.scroll, set: new Set(c.scroll.querySelectorAll('[style]')) }; }
      }
    });
    // 兜底：任何编辑（含整段选中删除、拖放）之后，把被拆成 flex 子项的文字重新包成一段
    doc.addEventListener('input', (e) => {
      if (!this.editable) return;
      const sc = e.target.closest?.('.content-scroll');
      if (!sc) return;
      // Chrome 合并段落时会给文字套上 style="font-size…" 之类的内联样式，去掉这次新冒出来的
      if (this._styledBefore?.scroll === sc) {
        const before = this._styledBefore.set;
        for (const n of sc.querySelectorAll('strong[style], b[style], em[style], i[style], span[style], font')) {
          if (before.has(n)) continue;
          n.removeAttribute('style');
          if ((n.nodeName === 'SPAN' || n.nodeName === 'FONT') && !n.attributes.length) { while (n.firstChild) n.before(n.firstChild); n.remove(); }
        }
      }
      this._styledBefore = null;
      this.normalizeFlow(sc);
    });
    doc.addEventListener('click', (e) => {
      const it = e.target.closest?.('.section-item-container');
      if (it) this.onItemClick?.(it.id);
      else this.onBlankClick?.();
    });
  }

  // ---------- 回车 / 删除合并的结构保护 ----------
  _caret() {
    const sel = this.doc.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    const root = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    const scroll = root?.closest?.('.content-scroll');
    if (!scroll) return null;
    return { sel, r, scroll, el: root };
  }

  _display(el) { try { return this.doc.defaultView.getComputedStyle(el).display; } catch { return 'block'; } }
  _isBlockish(el) { const d = this._display(el); return !/^inline/.test(d) || d === 'inline-flex' || d === 'inline-grid'; }
  _isFlex(el) { return /flex|grid/.test(this._display(el)); }

  // 离光标最近的"块"（li / p / div 等非行内元素）
  _blockOf(node, scroll) {
    let el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el !== scroll) {
      if (this._isBlockish(el) && !(el.classList.contains('rs-bold') && el.parentElement && this._isFlex(el.parentElement) && !el.closest('li'))) return el;
      el = el.parentElement;
    }
    return scroll;
  }

  // 把 flex 容器里的混排内容包进一个 .rp-flow 块（保留光标）
  _wrapFlow(box) {
    if (!box || box.querySelector(':scope > .rp-flow') && box.children.length === 1) return box.firstElementChild;
    const sel = this.doc.getSelection();
    const saved = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    const pts = saved ? [saved.startContainer, saved.startOffset, saved.endContainer, saved.endOffset] : null;
    const flow = this.doc.createElement('div');
    flow.className = 'rp-flow';
    const nodes = [...box.childNodes];
    // 首尾空白不包进去
    while (nodes.length && nodes[0].nodeType === 3 && !nodes[0].textContent.trim()) nodes.shift();
    while (nodes.length && nodes[nodes.length - 1].nodeType === 3 && !nodes[nodes.length - 1].textContent.trim()) nodes.pop();
    if (!nodes.length) { box.appendChild(flow); return flow; }
    nodes[0].before(flow);
    for (const n of nodes) flow.appendChild(n);
    if (pts && pts[0].isConnected && pts[2].isConnected) {
      try { const r = this.doc.createRange(); r.setStart(pts[0] === box ? flow : pts[0], pts[0] === box ? 0 : pts[1]); r.setEnd(pts[2] === box ? flow : pts[2], pts[2] === box ? 0 : pts[3]); sel.removeAllRanges(); sel.addRange(r); } catch { /* 忽略 */ }
    }
    return flow;
  }

  // 检查一个 flex 容器里是否有多段"裸"内容（文字 + 加粗 + 换行混排）
  _needsFlow(box) {
    const parts = [...box.childNodes].filter((n) => (n.nodeType === 3 ? n.textContent.trim() : n.nodeType === 1));
    if (parts.length <= 1) return false;
    // 单个标题 + 空白是正常结构
    return parts.some((n) => n.nodeType === 3 || n.nodeName === 'BR' || !this._isBlockish(n) || n.nodeName === 'DIV');
  }

  normalizeFlow(scroll) {
    let changed = 0;
    for (const box of scroll.querySelectorAll('.menu-title > .left, .menu-title > .right')) {
      if (this._isFlex(box) && this._needsFlow(box) && !(box.children.length === 1 && box.firstElementChild.classList.contains('rp-flow'))) {
        // 已有 .rp-flow 的，把外面散落的内容并进去
        const flow = box.querySelector(':scope > .rp-flow');
        if (flow) { for (const n of [...box.childNodes]) if (n !== flow && (n.nodeType === 1 || n.textContent.trim())) flow.appendChild(n); }
        else this._wrapFlow(box);
        changed++;
      }
    }
    // Chrome 在 flex 里回车会插入裸 <div>，展开成 <br>
    for (const d of scroll.querySelectorAll('.rp-flow > div:not([class])')) {
      const br = this.doc.createElement('br');
      d.before(br);
      while (d.firstChild) d.before(d.firstChild);
      d.remove();
      changed++;
    }
    return changed;
  }

  // 回车：列表里新起一条；其他地方只插入换行 <br>，绝不在 flex 容器里切出新的块
  _handleEnter(shift) {
    const c = this._caret();
    if (!c) return false;
    const block = this._blockOf(c.r.startContainer, c.scroll);
    const li = c.el.closest('li');
    if (li && !shift && c.scroll.contains(li)) return false; // 浏览器默认：拆成新的一条 bullet
    if (this._isFlex(block) && block !== c.scroll) this._wrapFlow(block);
    if (!c.r.collapsed) this.doc.execCommand('delete');
    this.doc.execCommand('insertLineBreak');
    this.normalizeFlow(c.scroll);
    return true;
  }

  // Backspace 在段首 / Delete 在段尾时，只允许同类段落合并（同一列表的两条 bullet、两个普通段落）；
  // 跨结构（bullet 并进描述行、两条经历合并、并进日期栏）会把 flex 布局搞乱，直接拦下。
  _guardMerge(dir) {
    const c = this._caret();
    if (!c || !c.r.collapsed) return false;
    const block = this._blockOf(c.r.startContainer, c.scroll);
    if (block === c.scroll) return false;
    const probe = this.doc.createRange();
    if (dir < 0) { probe.setStart(block, 0); probe.setEnd(c.r.startContainer, c.r.startOffset); }
    else { probe.setStart(c.r.startContainer, c.r.startOffset); probe.setEnd(block, block.childNodes.length); }
    const frag = probe.cloneContents();
    if (frag.textContent.replace(/\u00a0/g, ' ').trim() || frag.querySelector?.('br, img')) return false; // 不在边界，正常删字
    const other = this._neighborBlock(block, dir, c.scroll);
    if (!other) return true;
    const sameList = block.nodeName === 'LI' && other.nodeName === 'LI' && block.parentElement === other.parentElement;
    const samePara = block.nodeName === other.nodeName && /^(P|DIV)$/.test(block.nodeName) && block.parentElement === other.parentElement && !this._isFlex(block.parentElement) && !block.className && !other.className;
    if (sameList || samePara) return false;
    // 空 bullet：直接删掉这条，光标放到上一条末尾
    if (block.nodeName === 'LI' && !block.textContent.trim() && block.parentElement.children.length > 1) {
      const target = block.previousElementSibling || block.nextElementSibling;
      block.remove();
      const r = this.doc.createRange(); r.selectNodeContents(target); r.collapse(dir < 0 && target === block.previousElementSibling ? false : true);
      c.sel.removeAllRanges(); c.sel.addRange(r);
      this.onChange?.();
    }
    return true;
  }

  _neighborBlock(block, dir, scroll) {
    const w = this.doc.createTreeWalker(scroll, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
    w.currentNode = dir < 0 ? block : (block.lastChild ? lastDeep(block) : block);
    let n = dir < 0 ? w.previousNode() : w.nextNode();
    while (n && block.contains(n)) n = dir < 0 ? w.previousNode() : w.nextNode();
    return n ? this._blockOf(n, scroll) : null;
  }

  _repaginateKeepCaret() {
    // 只在编辑第一页时自动重排（第一页不会被删除，光标不会丢）
    const sel = this.doc.getSelection();
    const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    this.paginate();
    if (range && range.startContainer.isConnected) { sel.removeAllRanges(); sel.addRange(range); }
  }

  // ---------- 高亮 ----------
  highlightTodos() {
    const win = this.iframe.contentWindow;
    if (!win?.CSS?.highlights || !win.Highlight) return 0;
    const ranges = this._findRanges(/【待补充[：:][^】]*】/g);
    win.CSS.highlights.set('rp-todo', new win.Highlight(...ranges));
    return ranges.length;
  }

  highlightKeywords(words) {
    const win = this.iframe.contentWindow;
    if (!win?.CSS?.highlights || !win.Highlight) return;
    const list = (words || []).filter((w) => w && w.length >= 2).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!list.length) { win.CSS.highlights.delete('rp-kw'); return; }
    const re = new RegExp(list.join('|'), 'gi');
    win.CSS.highlights.set('rp-kw', new win.Highlight(...this._findRanges(re)));
  }

  _findRanges(re) {
    const doc = this.doc;
    const ranges = [];
    const walker = doc.createTreeWalker(this.container(), NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = n.textContent;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(t))) {
        if (!m[0]) { re.lastIndex++; continue; }
        const r = doc.createRange();
        r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
        ranges.push(r);
      }
    }
    return ranges;
  }

  countTodos() {
    return (this.primary()?.textContent.match(/【待补充[：:][^】]*】/g) || []).length;
  }

  // 找到条目在哪一页真正可见，返回它在 iframe 文档中的位置
  locate(id) {
    const els = [...this.doc.querySelectorAll('[id="' + CSS.escape(id) + '"]')];
    for (const e of els) {
      const page = e.closest('.main');
      const content = page.querySelector('.content').getBoundingClientRect();
      const cover = page.querySelector('.cover:not(.rs-cover-clear)');
      const coverTop = cover ? cover.getBoundingClientRect().top : content.bottom;
      const r = e.getBoundingClientRect();
      const visTop = Math.max(r.top, content.top);
      const visBottom = Math.min(r.bottom, coverTop, content.bottom);
      if (visBottom - visTop > 8) return { el: e, top: visTop + this.doc.documentElement.scrollTop, height: visBottom - visTop };
    }
    return null;
  }

  highlight(ids) {
    this.doc.querySelectorAll('.rp-hl').forEach((e) => e.classList.remove('rp-hl'));
    for (const id of ids || []) this.doc.querySelectorAll('[id="' + CSS.escape(id) + '"]').forEach((e) => e.classList.add('rp-hl'));
  }

  overflow() {
    this.flushSync();
    const pages = this.pages();
    const first = pages[0];
    if (!first) return { pages: 0, overLines: 0, overPx: 0, onePage: true };
    const scroll0 = this.primary();
    if (!scroll0) return { pages: pages.length, overLines: 0, overPx: 0, onePage: pages.length <= 1 };
    const base = scroll0.getBoundingClientRect().top;
    const lines = this._lines(scroll0, base);
    const content = first.querySelector('.content')?.getBoundingClientRect();
    const cover = first.querySelector('.cover:not(.rs-cover-clear)');
    const pad = cover ? parseFloat(getComputedStyle(cover).paddingBottom) || 0 : 0;
    const main = first.getBoundingClientRect();
    const V = content ? Math.min(content.bottom, main.bottom - pad) - content.top : 1032;
    const over = lines.filter((l) => l.bottom > V + 0.5);
    const last = lines.length ? lines[lines.length - 1].bottom : 0;
    const overPx = Math.max(0, last - V);
    return { pages: pages.length, overLines: over.length, overPx: Math.round(overPx), onePage: pages.length <= 1 && overPx < 8 };
  }

  applyModuleTitle(id, title) {
    const roots = this.doc.querySelectorAll('[id="' + CSS.escape(id) + '"] .module-title-wrapper .title, [id="' + CSS.escape(id) + '"] .module-title-wrapper span.title');
    const list = roots.length ? roots : this.doc.querySelectorAll('[id="' + CSS.escape(id) + '"] .module-title-wrapper span');
    for (const el of list) { if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) el.childNodes[0].textContent = title; else if ([...el.childNodes].every((n) => n.nodeType === 3 || !n.textContent.trim())) el.textContent = title; }
  }

  applyItemTitle(id, parts) {
    // parts: [{from, to}] or a single string for the first significant span
    const items = [...this.doc.querySelectorAll('[id="' + CSS.escape(id) + '"]')];
    for (const it of items) {
      if (typeof parts === 'string') {
        const span = [...it.querySelectorAll('.menu-title span, .menu-title .rs-bold, .menu-title .left')].find((e) => e.textContent.trim());
        if (span) {
          const t = [...span.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()) || span;
          if (t.nodeType === 3) t.textContent = parts; else span.textContent = parts;
        }
      } else if (Array.isArray(parts)) {
        const walker = this.doc.createTreeWalker(it.querySelector('.menu-title') ? it : it, NodeFilter.SHOW_TEXT);
        const nodes = []; let n; while ((n = walker.nextNode())) if (n.textContent.trim()) nodes.push(n);
        for (const { from, to } of parts) {
          for (const node of nodes) if (node.textContent.includes(from)) node.textContent = node.textContent.split(from).join(to);
        }
      }
    }
  }

  replaceInPrimary(replacements) {
    const root = this.primary();
    if (!root || !replacements?.length) return 0;
    const sorted = [...replacements].filter((r) => r.from && r.to && r.from !== r.to).sort((a, b) => b.from.length - a.from.length);
    const walker = this.doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n, count = 0;
    while ((n = walker.nextNode())) {
      let t = n.textContent;
      let changed = false;
      for (const r of sorted) {
        if (t.includes(r.from)) { t = t.split(r.from).join(r.to); changed = true; }
      }
      if (changed) { n.textContent = t; count++; }
    }
    return count;
  }

  applyTranslation(data) {
    const reps = [...(data.profileLabels || []), ...(data.dates || [])];
    if (data.modules) for (const m of data.modules) if (m.id && m.title) this.applyModuleTitle(m.id, m.title);
    this.replaceInPrimary(reps);
    for (const it of data.items || []) {
      if (it.html) this.applyItemHtml(it.id, it.html, { flash: false });
      if (it.title) this.applyItemTitle(it.id, it.title);
    }
    const nameEl = this.primary()?.querySelector('.user-name');
    if (data.name && nameEl) nameEl.textContent = data.name;
    this.syncFrom(this.primary());
    this.paginate();
    this.highlightTodos();
  }


  stripLegacyChrome() {
    if (!this.doc) return;
    this.doc.querySelectorAll(CHROME_SEL).forEach((e) => e.remove());
    this.doc.querySelectorAll('.edu-crest-host').forEach((e) => e.classList.remove('edu-crest-host'));
    const walker = this.doc.createTreeWalker(this.container() || this.doc.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n.textContent.includes('更换编辑删除')) n.textContent = n.textContent.replace(/更换编辑删除/g, '');
    }
  }

  _commitStructure() {
    const src = this.primary();
    if (src) this.syncFrom(src);
    this.paginate();
    this.highlightTodos();
    this.onChange?.();
  }

  _newId(prefix) {
    const used = new Set([...this.doc.querySelectorAll('[id]')].map((e) => e.id));
    let id;
    do { id = prefix + '-' + Math.random().toString(36).slice(2, 10); } while (used.has(id));
    return id;
  }

  setModuleHidden(moduleId, hidden) {
    this.snapshot();
    this.doc.querySelectorAll('[id="' + CSS.escape(moduleId) + '"]').forEach((el) => {
      el.classList.toggle('rp-mod-hidden', hidden);
    });
    this._commitStructure();
  }

  renameModule(moduleId, title) {
    this.snapshot();
    this.applyModuleTitle(moduleId, title);
    this._commitStructure();
  }

  removeModule(moduleId) {
    this.snapshot();
    this.doc.querySelectorAll('[id="' + CSS.escape(moduleId) + '"]').forEach((el) => el.remove());
    this._commitStructure();
  }

  moveModule(moduleId, dir) {
    const mods = this.modules();
    const i = mods.findIndex((m) => m.id === moduleId);
    if (i < 0) return false;
    const j = i + dir;
    if (j < 0 || j >= mods.length) return false;
    const order = mods.map((m) => m.id);
    const [x] = order.splice(i, 1);
    order.splice(j, 0, x);
    this.snapshot();
    const ok = this.reorderModules(order);
    if (!ok) this.undoStack.pop();
    else this._commitStructure();
    return ok;
  }

  emptyItemTemplate(type) {
    const doc = this.doc;
    const id = this._newId(type || 'item');
    const wrap = doc.createElement('div');
    wrap.id = id;
    wrap.className = 'menu section-item-container';
    stampScope(wrap, findScopeName(this.primary?.() || this.container?.(), doc));
    fillItemPlaceholders(wrap, type);
    return wrap;
  }

  _clearItemContent(el, type) {
    // 保留克隆来的类名 / 日期三 span / 圆点，只换占位文字
    fillItemPlaceholders(el, type);
  }

  normalizeAllItems() {
    const root = this.primary();
    if (!root) return;
    for (const mod of this.modules()) {
      const host = mod.el.querySelector('.info-content') || mod.el;
      for (const it of host.querySelectorAll(':scope > .section-item-container')) {
        ensureItemSkeleton(it, mod.type || mod.id);
      }
    }
    this.syncFrom(root);
  }

  _fillItemFromStory(node, story) {
    const type = (this.item(node.id) || {}).module || 'project_experience';
    fillItemFields(node, type, {
      org: story.org || story.title || '',
      start: story.start || '',
      end: story.end || '',
      role: story.role || '',
      place: story.place || story.location || '',
    }, { keepBody: true });
    const content = node.querySelector('.menu-content');
    if (!content) return;
    const parts = [];
    const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (story.background || story.task) parts.push('<p>' + esc([story.background, story.task].filter(Boolean).join(' ')) + '</p>');
    const bullets = [];
    if (story.action) bullets.push(story.action);
    if (story.result) bullets.push(story.result);
    for (const m of story.metrics || []) if (m) bullets.push(m);
    if (story.stack?.length) bullets.push('技术栈：' + story.stack.join('、'));
    if (bullets.length) parts.push('<ul>' + bullets.map((b) => '<li>' + esc(b) + '</li>').join('') + '</ul>');
    if (parts.length) content.innerHTML = parts.join('');
  }

  addItem(moduleId, { fromId, story } = {}) {
    const mod = this.modules().find((m) => m.id === moduleId);
    if (!mod) throw new Error('找不到模块 ' + moduleId);
    this.snapshot();
    const type = mod.type || moduleId;
    const src = fromId ? this.primary().querySelector('[id="' + CSS.escape(fromId) + '"]') : mod.el.querySelector('.section-item-container');
    const node = src ? src.cloneNode(true) : this.emptyItemTemplate(type);
    const newId = this._newId(type);
    node.id = newId;
    node.className = (node.className || '').replace(/(^|\s)section-\d+(?=\s|$)/g, '$1').trim();
    stampScope(node, findScopeName(src || this.primary(), this.doc));
    ensureItemSkeleton(node, type);
    if (!fromId) this._clearItemContent(node, type);
    if (story) this._fillItemFromStory(node, story);
    const primaryMod = this.primary().querySelector('[id="' + CSS.escape(moduleId) + '"]');
    const primaryHost = primaryMod?.querySelector('.info-content') || primaryMod;
    primaryHost.appendChild(node);
    this._commitStructure();
    return newId;
  }

  duplicateItem(itemId) {
    const it = this.item(itemId);
    if (!it) return '';
    return this.addItem(it.module, { fromId: itemId });
  }

  removeItem(itemId) {
    this.snapshot();
    this.doc.querySelectorAll('[id="' + CSS.escape(itemId) + '"]').forEach((e) => e.remove());
    this._commitStructure();
  }

  moveItem(itemId, dir) {
    const it = this.item(itemId);
    if (!it) return false;
    const mod = this.modules().find((m) => m.id === it.module);
    const ids = mod.items.map((x) => x.id);
    const i = ids.indexOf(itemId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return false;
    const [x] = ids.splice(i, 1);
    ids.splice(j, 0, x);
    this.snapshot();
    const ok = this.reorderItems(it.module, ids);
    if (!ok) this.undoStack.pop();
    else this._commitStructure();
    return ok;
  }

  addBullet(itemId, after = -1) {
    const it = this.item(itemId);
    if (!it) return;
    this.snapshot();
    const primaryItem = this.primary().querySelector('[id="' + CSS.escape(itemId) + '"]');
    const content = primaryItem?.querySelector('.menu-content');
    if (!content) return;
    let ul = content.querySelector('ul, ol');
    if (!ul) { ul = this.doc.createElement('ul'); content.appendChild(ul); }
    const li = this.doc.createElement('li');
    li.textContent = '【待补充：要点】';
    const lis = [...ul.children].filter((e) => e.tagName === 'LI');
    if (after >= 0 && lis[after]) lis[after].after(li);
    else ul.appendChild(li);
    this._commitStructure();
  }

  removeBullet(itemId, index) {
    this.snapshot();
    const primaryItem = this.primary().querySelector('[id="' + CSS.escape(itemId) + '"]');
    const lis = [...(primaryItem?.querySelectorAll('.menu-content li') || [])];
    if (lis[index]) lis[index].remove();
    this._commitStructure();
  }

  moveBullet(itemId, index, dir) {
    const j = index + dir;
    this.snapshot();
    const primaryItem = this.primary().querySelector('[id="' + CSS.escape(itemId) + '"]');
    const lis = [...(primaryItem?.querySelectorAll('.menu-content li') || [])];
    if (!lis[index] || !lis[j]) { this.undoStack.pop(); return false; }
    if (dir < 0) lis[j].before(lis[index]);
    else lis[j].after(lis[index]);
    this._commitStructure();
    return true;
  }

  setItemField(itemId, field, value, { hideEmpty = true } = {}) {
    this.snapshot();
    const items = [...this.doc.querySelectorAll('[id="' + CSS.escape(itemId) + '"]')];
    const type = (this.item(itemId) || {}).module;
    const kind = itemKind(type);
    if (field === 'dates' || field === 'start' || field === 'end') {
      for (const it of items) {
        const right = it.querySelectorAll(':scope > .menu-title')[0]?.querySelector('.right')
          || it.querySelector('.menu-title')?.querySelector('.right');
        if (!right) continue;
        const cur = parseDateRange(norm(cleanClone(right)?.textContent || ''));
        const range = field === 'end'
          ? { start: cur.start, end: value }
          : field === 'start'
            ? { start: value, end: kind === 'single' ? '' : cur.end }
            : parseDateRange(value);
        applyDateSpans(right, range, { single: kind === 'single', keepDash: true });
        const row = right.closest('.menu-title');
        if (hideEmpty && row) {
          const left = norm(row.querySelector('.left')?.textContent);
          const rightT = norm(row.querySelector('.right')?.textContent);
          row.classList.toggle('rp-field-hidden', !left && !rightT);
        } else if (row) row.classList.remove('rp-field-hidden');
      }
      this._commitStructure();
      return;
    }
    const map = { org: [0, '.left'], role: [1, '.left'], place: [1, '.right'] };
    const spec = map[field];
    if (!spec) return;
    for (const it of items) {
      const rows = [...it.querySelectorAll(':scope > .menu-title')];
      const cell = rows[spec[0]]?.querySelector(spec[1]);
      if (!cell) continue;
      if (field === 'org') setCellText(cell, value || '', { bold: kind !== 'body' });
      else setCellText(cell, value || '');
      const row = rows[spec[0]];
      if (hideEmpty) {
        const left = norm(row.querySelector('.left')?.textContent);
        const right = norm(row.querySelector('.right')?.textContent);
        row.classList.toggle('rp-field-hidden', !left && !right);
      } else row.classList.remove('rp-field-hidden');
    }
    this._commitStructure();
  }

  setItemDesc(itemId, value) {
    this.snapshot();
    const items = [...this.doc.querySelectorAll('[id="' + CSS.escape(itemId) + '"]')];
    for (const it of items) {
      const content = it.querySelector('.menu-content');
      if (!content) continue;
      let p = [...content.querySelectorAll(':scope > p')][0];
      const ul = content.querySelector(':scope > ul, :scope > ol');
      if (!p) {
        p = this.doc.createElement('p');
        if (ul) ul.before(p); else content.prepend(p);
      }
      const lines = String(value || '').replace(/\r/g, '').split('\n');
      p.textContent = '';
      lines.forEach((line, i) => {
        if (i) p.appendChild(this.doc.createElement('br'));
        p.appendChild(this.doc.createTextNode(line));
      });
      [...content.querySelectorAll(':scope > p')].slice(1).forEach((n) => n.remove());
    }
    this._commitStructure();
  }

  setBulletText(itemId, index, value) {
    this.snapshot();
    const items = [...this.doc.querySelectorAll('[id="' + CSS.escape(itemId) + '"]')];
    for (const it of items) {
      const lis = [...it.querySelectorAll('.menu-content li')];
      if (lis[index]) lis[index].textContent = value;
    }
    this._commitStructure();
  }

  setItemContent(itemId, value) {
    this.snapshot();
    const items = [...this.doc.querySelectorAll('[id="' + CSS.escape(itemId) + '"]')];
    const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    for (const it of items) {
      const content = it.querySelector('.menu-content');
      if (!content) continue;
      const paras = String(value || '').replace(/\r/g, '').split(/\n\n+/);
      content.innerHTML = paras.map((p) => '<p>' + escHtml(p) + '</p>').join('') || '<p></p>';
    }
    this._commitStructure();
  }

  hideEmptyFields(itemId, hide = true) {
    const it = this.primary()?.querySelector('[id="' + CSS.escape(itemId) + '"]');
    if (!it) return;
    this.snapshot();
    for (const row of it.querySelectorAll('.menu-title')) {
      const left = norm(row.querySelector('.left')?.textContent);
      const right = norm(row.querySelector('.right')?.textContent);
      row.classList.toggle('rp-field-hidden', hide && !left && !right);
    }
    this._commitStructure();
  }

  addModule(type, { title } = {}) {
    const known = MODULE_NAMES[type] || (type === 'custom' ? (title || '自定义模块') : '');
    if (!known && type !== 'custom') throw new Error('未知模块类型');
    this.snapshot();
    const srcType = type === 'custom' ? 'honor' : type;
    const existing = this.primary()?.querySelector('.option.' + CSS.escape(srcType)) || this.primary()?.querySelector('[id="' + srcType + '"]');
    const wrap = this.primary()?.querySelector('.section-wrapper');
    if (!wrap) throw new Error('找不到模块容器');
    let node;
    if (existing) node = existing.cloneNode(true);
    else {
      node = this.doc.createElement('div');
      node.className = 'option ' + srcType;
      node.innerHTML = '<div class="module-title-wrapper"><div class="rs-heading"><div class="rs-heading-inner" type="' + (type === 'custom' ? 'custom' : srcType) + '"><span class="title">' + (title || known) + '</span></div></div></div><div class="info-content"></div>';
    }
    const id = (type === 'custom') ? this._newId('custom') : (this.modules().some((m) => m.id === type) ? this._newId(type) : type);
    node.id = id;
    if (type === 'custom') {
      node.classList.add('custom');
      const titleEl = node.querySelector('.module-title-wrapper .title');
      if (titleEl) titleEl.textContent = title || '自定义模块';
    } else if (title) {
      const titleEl = node.querySelector('.module-title-wrapper .title');
      if (titleEl) titleEl.textContent = title;
    }
    node.classList.remove('rp-mod-hidden');
    const host = node.querySelector('.info-content') || node;
    host.querySelectorAll('.section-item-container').forEach((e) => e.remove());
    const item = this.emptyItemTemplate(srcType === 'custom' ? 'honor' : srcType);
    stampScope(item, findScopeName(node, this.doc));
    host.appendChild(item);
    wrap.appendChild(node);
    this._commitStructure();
    return id;
  }

  // ---------- 序列化 ----------
  serialize() {
    this.flushSync();
    const node = this.container().cloneNode(true);
    node.querySelectorAll('[contenteditable]').forEach((e) => { e.removeAttribute('contenteditable'); e.removeAttribute('spellcheck'); });
    node.removeAttribute('contenteditable'); node.removeAttribute('spellcheck');
    node.removeAttribute('data-rp-theme');
    node.querySelectorAll(CHROME_SEL).forEach((e) => e.remove());
    node.querySelectorAll('.edu-crest-host').forEach((e) => e.classList.remove('edu-crest-host'));
    const walker = this.doc.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let tn;
    while ((tn = walker.nextNode())) {
      if (tn.textContent.includes('更换编辑删除')) tn.textContent = tn.textContent.replace(/更换编辑删除/g, '');
    }
    node.querySelectorAll('.rp-hl, .rp-flash').forEach((e) => { e.classList.remove('rp-hl', 'rp-flash'); });
    node.querySelectorAll('img[data-rp-asset]').forEach((img) => {
      const name = img.getAttribute('data-rp-asset');
      if (name && !/[\\/]/.test(name)) img.setAttribute('src', 'assets/' + name);
    });
    return node.outerHTML;
  }
}
