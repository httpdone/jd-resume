// 通用 UI 工具：图标、DOM 构建、toast、弹窗、Markdown
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  file: '<path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8zM5 2l.6 1.4L7 4l-1.4.6L5 6l-.6-1.4L3 4l1.4-.6z"/>',
  wand: '<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  stethoscope: '<path d="M5 3v6a5 5 0 0 0 10 0V3"/><path d="M10 14v2a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="12" r="2"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  save: '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8M7 21v-7h10v7"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  monitor: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  kanban: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  up: '<path d="m18 15-6-6-6 6"/>', downX: '<path d="m6 9 6 6 6-6"/>',
  eyeOff: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>',
  left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>', down: '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>', check: '<path d="M20 6 9 17l-5-5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  external: '<path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M2 13h20"/>',
  flame: '<path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-5 5-5 8-1-1-2-2-2-4-2 2-2 5-2 8 0 4 3 7 7 7z"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14 9l2 2"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  file2: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  pages: '<rect x="4" y="2" width="12" height="16" rx="2"/><path d="M8 22h10a2 2 0 0 0 2-2V6"/>',
  type: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  mic: '<path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10a7 7 0 0 1-14 0M12 17v5M8 22h8"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  compress: '<path d="M8 3v3H5M16 3v3h3M8 21v-3H5M16 21v-3h3"/><path d="M9 9 5 5M15 9l4-4M9 15l-4 4M15 15l4 4"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22V15"/>',
  speech: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-4.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.8"/><path d="m21 16-5.2-5.2-8.8 8"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.2"/>',
};


export function icon(name, cls = '') {
  return '<svg viewBox="0 0 24 24" class="' + cls + '">' + (P[name] || P.info) + '</svg>';
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 把【待补充：…】高亮
export function markTodos(htmlEscaped) {
  return String(htmlEscaped).replace(/【待补充[：:][^】]*】|\[待确认[：:][^\]]*\]/g, (m) => '<span class="todo-mark">' + m + '</span>');
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function toast(msg, type = 'ok', ms = 2600, action) {
  const box = document.getElementById('toasts');
  const n = el('<div class="toast ' + type + '">' + icon(type === 'ok' ? 'check' : type === 'err' ? 'alert' : 'info') + '<span></span></div>');
  n.querySelector('span').textContent = msg;
  if (action && action.label) {
    const b = el('<button class="btn xs ghost toast-action"></button>');
    b.textContent = action.label;
    b.onclick = (e) => { e.stopPropagation(); n.remove(); action.onClick?.(); };
    n.appendChild(b);
    if (action.ms) ms = action.ms;
  }
  box.appendChild(n);
  const wait = type === 'err' ? Math.max(ms, 5000) : (action ? Math.max(ms, 7000) : ms);
  setTimeout(() => { if (!n.isConnected) return; n.style.transition = 'opacity .3s'; n.style.opacity = '0'; setTimeout(() => n.remove(), 300); }, wait);
  return n;
}

export function beginInlineEdit(el, { value, onCommit, onCancel, validate } = {}) {
  if (!el || el.dataset.rpEditing === '1') return;
  el.dataset.rpEditing = '1';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input inline-rename';
  input.value = value != null ? value : (el.textContent || '').trim();
  const display = el.style.display;
  el.style.display = 'none';
  el.after(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (ok) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    document.removeEventListener('keydown', onKey, true);
    input.remove();
    el.style.display = display;
    delete el.dataset.rpEditing;
    if (!ok) { onCancel?.(); return; }
    if (validate) {
      const err = validate(v);
      if (err) { toast(err, 'warn'); onCancel?.(); return; }
    }
    try { await onCommit?.(v); } catch (err) { toast(err.message, 'err'); onCancel?.(); }
  };
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  };
  document.addEventListener('keydown', onKey, true);
  input.addEventListener('blur', () => finish(true));
  return input;
}

export function modal({ title, body = '', width = 520, actions = [], onClose } = {}) {
  const mask = el('<div class="modal-mask"><div class="modal" style="width:' + width + 'px"><div class="modal-head"><h3></h3><button class="btn ghost sm icon" data-x>' + icon('x') + '</button></div><div class="modal-body"></div><div class="modal-foot"></div></div></div>');
  mask.querySelector('h3').textContent = title || '';
  const bodyEl = mask.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  const foot = mask.querySelector('.modal-foot');
  const close = () => { mask.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  for (const a of actions) {
    const b = el('<button class="btn ' + (a.cls || '') + '">' + (a.icon ? icon(a.icon) : '') + '<span></span></button>');
    b.querySelector('span').textContent = a.label;
    b.addEventListener('click', async () => {
      if (!a.onClick) return close();
      b.classList.add('loading');
      try { const r = await a.onClick({ close, body: bodyEl, button: b }); if (r !== false) close(); } catch (err) { toast(err.message, 'err'); } finally { b.classList.remove('loading'); }
    });
    foot.appendChild(b);
  }
  if (!actions.length) foot.remove();
  mask.querySelector('[data-x]').onclick = close;
  mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(); });
  document.body.appendChild(mask);
  setTimeout(() => bodyEl.querySelector('input, textarea, select')?.focus(), 30);
  return { close, body: bodyEl, el: mask };
}

export function confirmDialog(text, { title = '请确认', ok = '确定', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title, body: '<p style="margin:0;white-space:pre-wrap">' + esc(text) + '</p>', width: 440,
      onClose: () => { if (!done) resolve(false); },
      actions: [
        { label: '取消', onClick: () => { done = true; resolve(false); } },
        { label: ok, cls: danger ? 'danger' : 'primary', onClick: () => { done = true; resolve(true); } },
      ],
    });
  });
}

export function promptDialog(title, { label = '', value = '', placeholder = '', ok = '确定', hint = '' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const body = el('<div><div class="field"><label></label><input class="input"><div class="hint"></div></div></div>');
    body.querySelector('label').textContent = label;
    body.querySelector('.hint').textContent = hint;
    const input = body.querySelector('input');
    input.value = value; input.placeholder = placeholder;
    const m = modal({
      title, body, width: 460, onClose: () => { if (!done) resolve(null); },
      actions: [
        { label: '取消', onClick: () => { done = true; resolve(null); } },
        { label: ok, cls: 'primary', onClick: () => { const v = input.value.trim(); if (!v) { toast('不能为空', 'warn'); return false; } done = true; resolve(v); } },
      ],
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') m.el.querySelector('.modal-foot .primary').click(); });
    setTimeout(() => input.select(), 40);
  });
}

export function drawer({ title, body }) {
  const mask = el('<div class="drawer-mask"></div>');
  const d = el('<div class="drawer"><div class="drawer-head"><h3></h3><button class="btn ghost sm icon">' + icon('x') + '</button></div><div class="drawer-body"></div></div>');
  d.querySelector('h3').textContent = title;
  const b = d.querySelector('.drawer-body');
  if (typeof body === 'string') b.innerHTML = body; else b.appendChild(body);
  const close = () => { mask.remove(); d.remove(); };
  mask.onclick = close; d.querySelector('.drawer-head button').onclick = close;
  document.body.append(mask, d);
  return { close, body: b, el: d };
}

// 极简 Markdown（先转义，安全）
export function md(src) {
  const lines = esc(src || '').split('\n');
  let out = '';
  let list = null;
  let inCode = false;
  const inline = (s) => markTodos(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  const closeList = () => { if (list) { out += '</' + list + '>'; list = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line.startsWith('```')) { closeList(); out += inCode ? '</pre>' : '<pre>'; inCode = !inCode; continue; }
    if (inCode) { out += line + '\n'; continue; }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) { closeList(); out += '<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>'; continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { closeList(); out += '<ul>'; list = 'ul'; } out += '<li>' + inline(m[1]) + '</li>'; continue; }
    if ((m = line.match(/^\s*\d+[.、)]\s+(.*)/))) { if (list !== 'ol') { closeList(); out += '<ol>'; list = 'ol'; } out += '<li>' + inline(m[1]) + '</li>'; continue; }
    if ((m = line.match(/^&gt;\s?(.*)/))) { closeList(); out += '<blockquote>' + inline(m[1]) + '</blockquote>'; continue; }
    if (!line.trim()) { closeList(); continue; }
    closeList();
    out += '<p>' + inline(line) + '</p>';
  }
  closeList();
  if (inCode) out += '</pre>';
  return out;
}

export function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' 天前';
  return d.toLocaleDateString('zh-CN');
}

export const ymd = (d) => { if (typeof d === 'string' && /^\d{4}-\d\d-\d\d$/.test(d)) return d; const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
export const today = () => ymd(new Date());

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => toast('已复制到剪贴板'));
  const ta = document.createElement('textarea');
  ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  toast('已复制到剪贴板');
  return Promise.resolve();
}

export function scoreColor(s) { return s >= 85 ? 'var(--ok)' : s >= 70 ? 'var(--primary)' : s >= 55 ? 'var(--warn)' : 'var(--bad)'; }

export function scoreRing(score, label = '') {
  const r = 38, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(100, score)) / 100);
  return '<div class="score-ring"><svg viewBox="0 0 92 92"><circle class="bg" cx="46" cy="46" r="' + r + '"/><circle class="fg" cx="46" cy="46" r="' + r + '" stroke="' + scoreColor(score) + '" stroke-dasharray="' + c + '" stroke-dashoffset="' + off + '"/></svg><div class="num"><div>' + Math.round(score) + '<small>' + esc(label) + '</small></div></div></div>';
}
