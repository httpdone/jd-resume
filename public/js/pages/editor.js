import { icon, esc, el, $, $$, toast, modal, confirmDialog, md, markTodos, copyText, scoreRing, fmtTime, beginInlineEdit } from '../ui.js';
import { get, put, post } from '../api.js';
import { runAgent } from '../agent.js';
import { ResumeDoc, htmlToText, sanitizeHtml } from '../resume-dom.js';
import { diffHtml, changeRatio } from '../diff.js';
import { ensureSettings, llmNotice, state } from '../store.js';
import { exportPdfFlow } from './resumes.js';
import { jdSelectHtml, jdById, thinkingBox, streamHandlers, LEVEL_BADGE, LEVEL_TEXT, loadStories } from './shared.js';
import { translateToEnglish } from './resumes.js';
import { openThemePicker } from '../theme-picker.js';
import { lintLocal } from './lint.js';
import { bindResumeMedia, openMediaModal } from '../media-editor.js';
import { renderStructureTree, bindHoverToolbar, openStoryInsert, afterZoomPaint, highlightOutline } from '../structure-editor.js';
import { chipifyHtml } from '../refs.js';
import { matchStories } from '../story-match.js';
import { lintBullets } from '../bullet-lint.js';

const STYLES = [
  ['polish', '精炼润色', '更清晰简洁，去空话'],
  ['tech', '技术强化', '突出技术栈与难点'],
  ['quant', '量化成果', '突出结果，缺数据标待补充'],
  ['concise', '精简压缩', '压缩约 30% 篇幅'],
  ['star', 'STAR 重构', '背景→行动→结果'],
  ['jd', 'JD 定向', '按目标岗位调整侧重'],
];

let S = null; // 当前编辑器状态

export function isDirty() { return Boolean(S?.dirty); }

export async function leave() {
  if (S?.abort) S.abort.abort();
  if (S?.chatAbort) S.chatAbort.abort();
  if (S?.dirty && !(await confirmDialog('有未保存的修改，确定离开吗？', { ok: '离开（不保存）', danger: true }))) return false;
  document.removeEventListener('keydown', S?.keyHandler);
  window.removeEventListener('resize', S?.resizeHandler);
  S = null;
  return true;
}

export async function render(view, [slug]) {
  if (!slug) { location.hash = '#/resumes'; return; }
  const data = await get('/api/resumes/' + encodeURIComponent(slug));
  S = { slug, meta: data.meta, dirty: false, zoom: Number(localStorage.getItem('rp-zoom')) || 0, tab: 'diag', targets: new Set(), style: 'polish', results: [], chat: loadChat(slug), abort: null };

  view.innerHTML = `<div class="editor">
  <div class="ed-toolbar">
    <a class="btn ghost sm icon" href="#/resumes" title="返回简历库">${icon('left')}</a>
    <div class="ed-title"><b id="ed-name" title="双击重命名这份简历"></b><button class="btn xs ghost icon" id="ed-rename" title="重命名简历">${icon('type')}</button><span class="ed-status" id="ed-status"><i></i><span>已保存</span></span></div>
    <span class="sp"></span>
    <div class="btn-group" id="mode"><button data-m="view" class="active">${icon('eye')}预览</button><button data-m="edit">${icon('edit')}编辑</button></div>
    <div class="zoom"><button class="btn xs ghost icon" data-z="-">${icon('zoomOut')}</button><span id="zoom-v">100%</span><button class="btn xs ghost icon" data-z="+">${icon('zoomIn')}</button><button class="btn xs ghost" data-z="fit">适应</button></div>
    <span class="vsep"></span>
    <button class="btn sm ghost icon" id="b-undo" title="撤销（Ctrl+Z），含结构操作与 AI 写回">${icon('undo')}</button>
    <button class="btn sm ghost icon" id="b-hist" title="历史版本">${icon('history')}</button>
    <button class="btn sm ghost icon" id="b-cmp" title="版本对比">${icon('columns')}</button>
    <button class="btn sm ghost icon" id="b-tpl" title="模板与版式">${icon('layout')}</button>
    <button class="btn sm ghost icon" id="b-media" title="头像与校徽">${icon('image')}</button>
    <button class="btn sm ghost icon" id="b-page" title="一页纸检查">${icon('compress')}</button>
    <button class="btn sm ghost icon" id="b-en" title="翻译成英文版">${icon('globe')}</button>
    <button class="btn sm ghost icon" id="b-ats" title="ATS 纯文本（网申粘贴用）">${icon('copy')}</button>
    <button class="btn sm" id="b-save">${icon('save')}保存</button>
    <button class="btn sm primary" id="b-pdf">${icon('download')}导出 PDF</button>
  </div>
  <div class="ed-body">
    <aside class="outline" id="outline"></aside>
    <section class="stage" id="stage"><div class="stage-tip hide" id="stage-tip"></div><div class="stage-inner"><div class="paper-wrap" id="paper"><iframe id="frame" title="简历预览"></iframe></div></div></section>
    <aside class="agent" id="agent">
      <div class="agent-head"><div class="ai-ico">${icon('sparkles')}</div><div><b>简历 Agent</b><div class="small muted">诊断 · 改写 · 追问 · 对话，不编造经历</div></div></div>
      <div class="tabs" id="tabs"><button data-t="diag">${icon('stethoscope')}诊断</button><button data-t="rewrite">${icon('wand')}改写</button><button data-t="interview">${icon('question')}追问</button><button data-t="chat">${icon('chat')}对话</button></div>
      <div class="agent-body" id="agent-body"></div>
      <div class="agent-foot" id="agent-foot" style="display:none"></div>
    </aside>
  </div></div>`;
  $('#ed-name').textContent = slug;

  const frame = $('#frame');
  S.rd = new ResumeDoc(frame);
  S.rd.onChange = () => markDirty(true);
  S.rd.onLayout = ({ pages }) => { applyZoom(); updatePageBadge(pages); };
  S.rd.onSaveKey = () => save();
  S.rd.onItemClick = (id) => { S.selected = id; highlightOutline($('#outline'), id); if (S.rd.editable) return; S.rd.highlight([id]); if (S.tab === 'rewrite') { S.targets = new Set([id]); renderTab(); } };
  S.rd.onBlankClick = () => { if (!S.rd.editable) S.rd.highlight([]); };
  await S.rd.load('/preview/' + encodeURIComponent(slug) + '?t=' + Date.now());
  hookMedia();
  window.__rpRd = S.rd;
  S.rd.onUndo = () => { markDirty(true); renderOutline(); bindHover(); toast('已撤销'); };

  bindToolbar();
  bindTitleRename();
  renderOutline();
  applyZoom();
  S.keyHandler = (e) => {
    if (e.key === 'Escape' && !S.rd?.editable && !document.querySelector('.modal-mask')) S.rd?.highlight([]);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (S.rd?.undoStack?.length) { e.preventDefault(); if (S.rd.undo()) { markDirty(true); renderOutline(); bindHover(); toast('已撤销'); } }
    }
  };
  document.addEventListener('keydown', S.keyHandler);
  S.resizeHandler = () => { if (!localStorage.getItem('rp-zoom')) applyZoom(); };
  window.addEventListener('resize', S.resizeHandler);
  $$('#tabs button').forEach((b) => { b.onclick = () => { S.tab = b.dataset.t; renderTab(); }; });
  await ensureSettings();
  renderTab();
}

function loadChat(slug) { try { return JSON.parse(localStorage.getItem('rp-chat-' + slug)) || []; } catch { return []; } }
function saveChat() { localStorage.setItem('rp-chat-' + S.slug, JSON.stringify(S.chat.slice(-40))); }
function cacheGet(k) { try { return JSON.parse(localStorage.getItem('rp-' + k + '-' + S.slug)); } catch { return null; } }
function cacheSet(k, v) { localStorage.setItem('rp-' + k + '-' + S.slug, JSON.stringify(v)); }

function markDirty(d) {
  S.dirty = d;
  const st = $('#ed-status');
  if (!st) return;
  st.classList.toggle('dirty', d);
  st.querySelector('span').textContent = d ? '未保存' : '已保存';
}

// ---------- 工具栏 ----------
function bindToolbar() {
  $$('#mode button').forEach((b) => b.onclick = () => {
    $$('#mode button').forEach((x) => x.classList.toggle('active', x === b));
    const edit = b.dataset.m === 'edit';
    S.rd.setEditable(edit);
    S.rd.highlight([]);
    $('#frame')._rpSelectStruct?.(null);
    afterZoomPaint($('#frame'));
    tip(edit ? '编辑模式：直接点击文字修改 · Ctrl+S 保存 · Ctrl+Z 撤销 · 点击条目出现操作栏，Esc 或点空白取消 · 粘贴自动去格式' : '');
  });
  $$('[data-z]').forEach((b) => b.onclick = () => {
    const z = S.zoomValue || 1;
    if (b.dataset.z === 'fit') { localStorage.removeItem('rp-zoom'); S.zoom = 0; }
    else { S.zoom = Math.max(0.4, Math.min(1.6, +(z + (b.dataset.z === '+' ? 0.1 : -0.1)).toFixed(2))); localStorage.setItem('rp-zoom', S.zoom); }
    applyZoom();
  });
  $('#b-save').onclick = () => save();
  $('#b-pdf').onclick = () => exportPdf();
  $('#b-undo').onclick = () => { if (S.rd.undo()) { markDirty(true); renderOutline(); toast('已撤销'); } else toast('没有可撤销的操作', 'warn'); };
  $('#b-ats').onclick = () => {
    const text = S.rd.toPlainText();
    const body = el('<div><p class="muted small" style="margin-top:0">单栏纯文本、标准标题，适合粘贴到网申系统或 ATS。</p><textarea class="input mono" rows="18" style="font-size:12px"></textarea></div>');
    body.querySelector('textarea').value = text;
    modal({ title: 'ATS 纯文本版', body, width: 680, actions: [{ label: '关闭' }, { label: '复制全部', cls: 'primary', icon: 'copy', onClick: () => copyText(body.querySelector('textarea').value) }] });
  };
  $('#b-hist').onclick = showHistory;
  $('#b-cmp').onclick = () => { location.hash = '#/compare/' + encodeURIComponent(S.slug); };
  $('#b-media') && ($('#b-media').onclick = () => {
    const body = el('<div><p class="muted small" style="margin-top:0">点击页眉右上角的校徽占位或头像即可添加。校徽只出现在页眉右上角，教育经历条目不再单独放校徽。</p><div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn" data-k="avatar">' + icon('image') + '编辑头像</button><button class="btn" data-k="school">编辑校徽</button></div></div>');
    const m = modal({ title: '头像与校徽', body, width: 420, actions: [{ label: '关闭' }] });
    body.onclick = (e) => {
      const k = e.target.closest('[data-k]')?.dataset.k;
      if (!k) return;
      m.close();
      openMediaModal({ rd: S.rd, slug: S.slug, kind: k, mode: 'pick', onChange: () => markDirty(true), onSave: () => save({ quiet: true }) });
    };
  });
  $('#b-tpl').onclick = () => openThemePicker(S.slug, { template: S.meta?.template, theme: S.meta?.theme }, async (cur) => {
    S.meta = { ...S.meta, ...cur };
    S.rd.onBlankClick = () => { if (!S.rd.editable) S.rd.highlight([]); };
  await S.rd.load('/preview/' + encodeURIComponent(S.slug) + '?t=' + Date.now());
    hookMedia();
    try { await save({ quiet: true }); } catch { /* 预览已更新，保存失败再手动保存 */ }
  });
  $('#b-page').onclick = () => showOnePage();
  $('#b-en').onclick = async () => {
    if (S.dirty && !(await confirmDialog('有未保存的修改，先保存再翻译英文版？', { ok: '保存并翻译' }))) return;
    if (S.dirty) await save({ quiet: true });
    const btn = $('#b-en'); btn.classList.add('loading');
    try { await translateToEnglish(S.slug); } catch (err) { toast(err.message, 'err'); } finally { btn.classList.remove('loading'); }
  };
}



function hookMedia() {
  if (!S?.rd?.doc) return;
  bindResumeMedia(S.rd, S.slug, { onChange: () => markDirty(true), onSave: () => save({ quiet: true }) });
  bindHover();
}
function bindHover() {
  if (!S?.rd?.doc) return;
  bindHoverToolbar(S.rd, { onChanged: () => { markDirty(true); renderOutline(); }, onSave: () => scheduleStructSave(), onLocate: (id) => scrollToItem(id), onSelect: (id) => { S.selected = id; highlightOutline($('#outline'), id); } });
}
let _structSaveT = 0;
function scheduleStructSave() {
  clearTimeout(_structSaveT);
  _structSaveT = setTimeout(() => save({ quiet: true }), 700);
}

function validateResumeName(v) {
  if (!v) return '名称不能为空';
  if (/[\\/:*?"<>|]/.test(v)) return '名称不能包含 \ / : * ? " < > |';
  if (v.startsWith('.')) return '名称不能以 . 开头';
  if (v.length > 80) return '名称过长（最多 80 个字符）';
  return '';
}

function migrateSlugStorage(from, to) {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.endsWith('-' + from)) keys.push(k);
  }
  for (const k of keys) {
    const nk = k.slice(0, k.length - from.length) + to;
    try { localStorage.setItem(nk, localStorage.getItem(k)); localStorage.removeItem(k); } catch { /* ignore */ }
  }
}

async function renameCurrent(name) {
  if (!name || name === S.slug) return;
  if (S.dirty) await save({ quiet: true });
  const from = S.slug;
  const r = await post('/api/resumes/' + encodeURIComponent(from) + '/rename', { name });
  const to = r.slug;
  migrateSlugStorage(from, to);
  S.slug = to;
  if (S.meta) S.meta.name = to;
  const el = document.getElementById('ed-name');
  if (el) el.textContent = to;
  history.replaceState(null, '', '#/editor/' + encodeURIComponent(to));
  toast('已重命名为「' + to + '」');
}

function bindTitleRename() {
  const nameEl = document.getElementById('ed-name');
  const start = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    beginInlineEdit(nameEl, {
      value: S.slug,
      validate: validateResumeName,
      onCommit: (v) => renameCurrent(v),
    });
  };
  nameEl.ondblclick = start;
  document.getElementById('ed-rename').onclick = start;
}


function tip(text) {
  const t = $('#stage-tip');
  if (!t) return;
  t.textContent = text;
  t.classList.toggle('hide', !text);
}

function applyZoom() {
  const stage = $('#stage');
  const frame = $('#frame');
  if (!stage || !frame) return;
  const fit = Math.min(1.2, Math.max(0.4, (stage.clientWidth - 80) / 794));
  const z = S.zoom || +fit.toFixed(2);
  S.zoomValue = z;
  const h = parseFloat(frame.style.height) || 1123;
  frame.style.transform = 'scale(' + z + ')';
  const wrap = $('#paper');
  wrap.style.width = 794 * z + 'px';
  wrap.style.height = h * z + 'px';
  $('#zoom-v').textContent = Math.round(z * 100) + '%';
  afterZoomPaint(frame);
}

function scrollToItem(id) {
  S.selected = id;
  highlightOutline($('#outline'), id);
  const loc = S.rd.locate(id);
  S.rd.highlight([id]);
  if (!loc) return;
  const stage = $('#stage');
  const wrap = $('#paper');
  const top = stage.scrollTop + (wrap.getBoundingClientRect().top - stage.getBoundingClientRect().top) + loc.top * S.zoomValue - 120;
  stage.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

async function save({ quiet = false } = {}) {
  const btn = $('#b-save');
  btn?.classList.add('loading');
  try {
    S.rd.paginate();
    const html = S.rd.serialize();
    const r = await put('/api/resumes/' + encodeURIComponent(S.slug), { html });
    markDirty(false);
    if (!quiet) toast('已保存 · ' + r.pages + ' 页');
    return r;
  } catch (err) { toast('保存失败：' + err.message, 'err'); throw err; } finally { btn?.classList.remove('loading'); }
}

async function exportPdf() {
  const n = S.rd.countTodos();
  if (n && !(await confirmDialog('简历里还有 ' + n + ' 处【待补充】标记（黄色高亮），导出前建议先填上真实数据或删除。\n仍然导出吗？', { ok: '仍然导出' }))) return;
  const btn = $('#b-pdf');
  btn.classList.add('loading');
  try {
    await save({ quiet: true });
    await exportPdfFlow(S.slug);
  } catch (err) { toast(err.message, 'err'); } finally { btn.classList.remove('loading'); }
}

async function showHistory() {
  const { items } = await get('/api/resumes/' + encodeURIComponent(S.slug) + '/history');
  const body = el('<div>' + (items.length ? '<table class="table"><thead><tr><th>保存时间</th><th>大小</th><th></th></tr></thead><tbody>' + items.map((h) => '<tr data-id="' + h.id + '"><td>' + new Date(h.at).toLocaleString('zh-CN', { hour12: false }) + ' <span class="muted small">' + fmtTime(h.at) + '</span></td><td>' + Math.round(h.bytes / 1024) + ' KB</td><td style="text-align:right;white-space:nowrap"><button class="btn xs ghost" data-a="view">' + icon('eye') + '预览</button> <button class="btn xs ghost" data-a="cmp">' + icon('columns') + '对比</button> <button class="btn xs soft" data-a="restore">' + icon('history') + '恢复</button></td></tr>').join('') + '</tbody></table>' : '<div class="empty">' + icon('history') + '<h4>还没有历史版本</h4><p>每次保存前，旧版本会自动备份到 .history/（保留最近 30 份）</p></div>') + '</div>');
  const m = modal({ title: '历史版本', body, width: 600 });
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const id = b.closest('tr').dataset.id;
    if (b.dataset.a === 'view') window.open('/preview/' + encodeURIComponent(S.slug) + '?history=' + id, '_blank');
    else if (b.dataset.a === 'cmp') { m.close(); location.hash = '#/compare/' + encodeURIComponent(S.slug) + '/' + encodeURIComponent(S.slug) + '//' + encodeURIComponent(id); }
    else if (await confirmDialog('用这个版本覆盖当前简历？当前内容也会先自动备份。', { ok: '恢复' })) {
      await post('/api/resumes/' + encodeURIComponent(S.slug) + '/history/' + id + '/restore');
      m.close();
      S.dirty = false;
      toast('已恢复');
      const slug = S.slug;
      location.hash = '#/resumes';
      setTimeout(() => { location.hash = '#/editor/' + encodeURIComponent(slug); }, 30);
    }
  });
}

// ---------- 大纲 ----------
function renderOutline() {
  const box = $('#outline');
  if (!box || !S.rd) return;
  renderStructureTree(box, S.rd, {
    getSelected: () => S.selected,
    onLocate: (id, all) => { S.selected = id; if (id) scrollToItem(id); if (all) S.rd.highlight(all); },
    onRewriteItem: (id) => openRewrite([id]),
    onRewriteMod: (m) => openRewrite((m?.items || []).filter((i) => i.editable && i.text).map((i) => i.id)),
    onChanged: () => markDirty(true),
    onSave: () => scheduleStructSave(),
    onInsertStory: () => openStoryInsert(S.rd, { onLocate: (id) => { scrollToItem(id); renderOutline(); }, onChanged: () => markDirty(true), onSave: () => scheduleStructSave() }),
  });
}

function openRewrite(ids, instruction = '') {
  S.tab = 'rewrite';
  S.targets = new Set(ids);
  S.instruction = instruction;
  S.rd.highlight(ids);
  if (ids[0]) scrollToItem(ids[0]);
  S.rd.highlight(ids);
  renderTab();
}

// ---------- Agent 面板 ----------
function renderTab() {
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.t === S.tab));
  const body = $('#agent-body');
  const foot = $('#agent-foot');
  foot.style.display = 'none';
  foot.innerHTML = '';
  ({ diag: renderDiag, rewrite: renderRewrite, interview: renderInterview, chat: renderChat })[S.tab](body, foot);
}

function itemLabel(id) {
  const it = S.rd.item(id);
  if (!it) return id;
  return it.moduleTitle + ' · ' + ((it.title || it.text).split(' ｜ ')[0].slice(0, 22) || '正文');
}

async function callAgent(payload, box) {
  S.abort?.abort();
  S.abort = new AbortController();
  box.querySelector('[data-stop]')?.addEventListener('click', () => S.abort.abort());
  try {
    if (!payload.stories) {
      try { payload.stories = await loadStories(); } catch { payload.stories = []; }
    }
    return await runAgent(payload, { ...streamHandlers(box, { json: payload.task && payload.task !== 'chat' }), signal: S.abort.signal });
  } finally { S.abort = null; }
}

function errorBox(err) {
  const raw = err.raw ? '<details style="margin-top:8px"><summary class="small muted">查看模型原始输出</summary><pre class="ai-stream" style="max-height:240px;mask-image:none;overflow:auto"></pre></details>' : '';
  const n = el('<div class="callout warn">' + icon('alert') + '<div><b>没有成功</b><div class="small" style="margin-top:2px"></div>' + (err.code === 'not_configured' ? '<div style="margin-top:8px"><a class="btn xs soft" href="#/settings">去设置</a></div>' : '') + raw + '</div></div>');
  n.querySelector('.small').textContent = err.name === 'AbortError' ? '已停止' : err.message;
  if (err.raw) n.querySelector('pre').textContent = err.raw;
  return n;
}

// ===== 诊断 =====
function renderDiag(body) {
  const cached = cacheGet('diag');
  const lint = lintLocal(S.rd);
  body.innerHTML = llmNotice(state.settings);
  body.insertAdjacentHTML('beforeend', `<div class="card card-pad" style="padding:14px 16px;margin-bottom:12px">
    <div class="sec-title" style="margin-top:0">${icon('check')}本地体检 <span class="muted small" style="font-weight:400">（即时、不调用 AI）</span></div>
    <div>${lint.chips}</div>
    <div class="row" style="margin-top:10px"><input class="input sm grow" id="d-target" placeholder="目标方向（可选），如：大模型应用开发实习" value="${esc(cached?.target || S.meta?.target?.role || '')}"><button class="btn sm primary" id="d-run">${icon('sparkles')}${cached ? '重新诊断' : 'AI 全面诊断'}</button></div>
  </div><div id="d-out"></div>`);
  body.querySelectorAll('[data-lint]').forEach((c) => c.onclick = () => {
    const ids = (c.dataset.lint || '').split(',').filter(Boolean);
    if (!ids.length) return;
    const n = Number(c.dataset.n || 0);
    scrollToItem(ids[n % ids.length]);
    c.dataset.n = String(n + 1);
  });
  const out = body.querySelector('#d-out');
  if (cached?.data) showDiag(out, cached.data, cached.at);
  else out.innerHTML = '<div class="empty">' + icon('stethoscope') + '<h4>让 Agent 给简历做一次体检</h4><p class="small">从 ATS、HR 10 秒初筛、面试官追问、可信度四个视角打分，<br>定位到具体条目，并可一键交给 AI 改写。</p></div>';
  body.querySelector('#d-run').onclick = async () => {
    const target = body.querySelector('#d-target').value.trim();
    out.innerHTML = thinkingBox('正在诊断整份简历…');
    try {
      const r = await callAgent({ task: 'diagnose', resume: S.rd.payload(), targetRole: target }, out);
      cacheSet('diag', { data: r.data, at: new Date().toISOString(), target, mock: r.meta?.mock });
      showDiag(out, r.data, new Date().toISOString());
    } catch (err) { out.innerHTML = ''; out.appendChild(errorBox(err)); }
  };
}

function showDiag(out, d, at) {
  const dims = (d.dimensions || []).map((x) => '<div class="dim"><div class="row"><span>' + esc(x.name) + '</span><b>' + Math.round(x.score) + '</b></div><div class="bar"><i style="width:' + Math.max(2, Math.min(100, x.score)) + '%"></i></div>' + (x.comment ? '<p>' + esc(x.comment) + '</p>' : '') + '</div>').join('');
    const refChip = (id) => { const it = S.rd.item(id); const tok = it?.ref || ''; return tok ? chipifyHtml(tok, S.rd.items(), S.rd.modules()) : ''; };
  const issues = (d.issues || []).map((x, i) => '<div class="issue ' + esc(x.level) + '"><div class="t"><span class="badge ' + (LEVEL_BADGE[x.level] || '') + '">' + (LEVEL_TEXT[x.level] || '') + '</span><span>' + chipifyHtml(x.problem, S.rd.items(), S.rd.modules()) + '</span></div>' + (x.suggestion ? '<div class="s">建议：' + markTodos(chipifyHtml(x.suggestion, S.rd.items(), S.rd.modules())) + '</div>' : '') + (x.evidenceNeeded ? '<div class="e">需要你补充：' + esc(x.evidenceNeeded) + '</div>' : '') + '<div class="ops">' + (x.itemId && S.rd.item(x.itemId) ? '<button class="btn xs ghost" data-loc="' + esc(x.itemId) + '">' + icon('eye') + '定位</button>' + (S.rd.item(x.itemId)?.editable ? '<button class="btn xs soft" data-fix="' + i + '">' + icon('wand') + 'AI 按建议改写</button>' : '') : (x.itemId && S.rd.modules().find((m) => m.id === x.itemId) ? '<button class="btn xs soft" data-fixmod="' + i + '">' + icon('wand') + '改写该模块</button>' : '')) + '</div></div>').join('');
  const risky = (d.riskyClaims || []).map((x) => '<div class="issue medium"><div class="t">' + icon('alert') + '<span>「' + esc(x.text) + '」</span></div><div class="s">' + esc(x.risk) + '</div>' + (x.saferWording ? '<div class="s" style="color:var(--ok)">更稳妥：' + esc(x.saferWording) + '</div>' : '') + (x.itemId && S.rd.item(x.itemId) ? '<div class="ops"><button class="btn xs ghost" data-loc="' + esc(x.itemId) + '">' + icon('eye') + '定位</button></div>' : '') + '</div>').join('');
  out.innerHTML = `<div class="diag-top">${scoreRing(d.score || 0, d.level || '')}<div><div style="font-weight:700;font-size:14.5px">${esc(d.verdict || '')}</div>${d.tenSecond ? '<div class="small muted" style="margin-top:6px">HR 10 秒印象：' + esc(d.tenSecond) + '</div>' : ''}<div class="small muted" style="margin-top:6px">${at ? '诊断于 ' + fmtTime(at) : ''}</div></div></div>
  <div class="sec-title">${icon('chart')}分项评分</div>${dims}
  ${(d.highlights || []).length ? '<div class="sec-title">' + icon('trophy') + '亮点</div><ul class="small" style="margin:0;padding-left:18px;color:var(--text-2)">' + d.highlights.map((h) => '<li>' + esc(h) + '</li>').join('') + '</ul>' : ''}
  <div class="sec-title">${icon('alert')}问题与建议 <span class="badge">${(d.issues || []).length}</span><button class="btn xs soft" style="margin-left:auto" id="fix-all">${icon('wand')}按全部建议改写</button></div>${issues || '<p class="muted small">没有发现明显问题</p>'}
  ${risky ? '<div class="sec-title">' + icon('flame') + '可能被追问 / 夸大的表述</div>' + risky : ''}
  ${(d.questions || []).length ? '<div class="sec-title">' + icon('question') + '为避免编造，需要你补充</div>' + d.questions.map((q) => '<div class="issue low"><div class="s" style="margin:0;color:var(--text)">' + esc(q) + '</div><div class="ops"><button class="btn xs ghost" data-ask="' + esc(q) + '">' + icon('chat') + '去对话里回答</button></div></div>').join('') : ''}`;
  out.onclick = (e) => {
    const loc = e.target.closest('[data-loc]');
    if (loc) return scrollToItem(loc.dataset.loc);
    const fix = e.target.closest('[data-fix]');
    if (fix) { const x = d.issues[+fix.dataset.fix]; return openRewrite([x.itemId], '问题：' + x.problem + '\n建议：' + (x.suggestion || '')); }
    const fm = e.target.closest('[data-fixmod]');
    if (fm) { const x = d.issues[+fm.dataset.fixmod]; const m = S.rd.modules().find((mm) => mm.id === x.itemId); return openRewrite(m.items.filter((i) => i.editable && i.text).map((i) => i.id), '问题：' + x.problem + '\n建议：' + (x.suggestion || '')); }
    const ask = e.target.closest('[data-ask]');
    if (ask) { S.tab = 'chat'; S.chatDraft = '关于「' + ask.dataset.ask + '」：'; renderTab(); return; }
    if (e.target.closest('#fix-all')) {
      const byItem = new Map();
      for (const x of d.issues || []) if (x.itemId && S.rd.item(x.itemId)?.editable) byItem.set(x.itemId, (byItem.get(x.itemId) || '') + '- ' + x.problem + '；建议：' + (x.suggestion || '') + '\n');
      if (!byItem.size) return toast('诊断结果里没有可直接改写的条目', 'warn');
      openRewrite([...byItem.keys()], '请逐条落实以下诊断建议：\n' + [...byItem.entries()].map(([id, t]) => '[' + id + ']\n' + t).join(''));
    }
  };
}

// ===== 改写 =====
function renderRewrite(body) {
  const mods = S.rd.modules();
  if (!S.targets.size && S.selected) S.targets.add(S.selected);
  body.innerHTML = `${llmNotice(state.settings)}
  <div class="sec-title" style="margin-top:0">${icon('layers')}改写范围 <span class="badge primary" id="tcount"></span><span style="margin-left:auto;display:flex;gap:4px"><button class="btn xs ghost" id="t-all">全选</button><button class="btn xs ghost" id="t-none">清空</button></span></div>
  <div class="target-list" id="tlist">${mods.map((m) => {
    const its = m.items.filter((i) => i.editable && i.text);
    if (!its.length) return '';
    return '<label class="mod check"><input type="checkbox" data-mod="' + esc(m.id) + '"><span>' + esc(m.title) + '</span></label>' + its.map((it) => '<label class="it check"><input type="checkbox" data-id="' + esc(it.id) + '"' + (S.targets.has(it.id) ? ' checked' : '') + '><span>' + esc((it.title || it.text).split(' ｜ ')[0].slice(0, 30)) + '</span></label>').join('');
  }).join('')}</div>
  <div class="sec-title">${icon('wand')}改写风格</div>
  <div class="rw-opts" id="styles">${STYLES.map(([k, t, d]) => '<div class="opt-card' + (S.style === k ? ' active' : '') + '" data-s="' + k + '"><b>' + t + '</b><span>' + d + '</span></div>').join('')}</div>
  <div id="jd-row" style="margin-top:10px;${S.style === 'jd' ? '' : 'display:none'}"></div>
  <div class="sec-title">${icon('layers')}参考素材库 <span class="small muted" style="font-weight:400">只用简历和所选素材里的事实</span></div>
  <div class="btn-group compact" id="st-mode"><button data-sm="auto">自动匹配</button><button data-sm="pick">手动选择</button><button data-sm="off">不使用</button></div>
  <div id="st-list" class="story-pick small" style="margin-top:6px"></div>
  <div class="field" style="margin:12px 0 10px"><textarea class="input" id="rw-ins" rows="3" placeholder="额外要求（可选）：如「突出 RAG 和 Agent 相关工作」「每条不超过 60 字」"></textarea></div>
  <button class="btn primary" style="width:100%" id="rw-run">${icon('sparkles')}开始改写</button>
  <div class="small muted" style="margin-top:8px;line-height:1.6">规则：只改表达、不改事实；数字/公司/时间原样保留；缺数据处写【待补充：…】提示你填真实数据；动词强度不升级。</div>
  <div id="rw-out" style="margin-top:14px"></div>`;
  const ins = body.querySelector('#rw-ins');
  ins.value = S.instruction || '';
  ins.oninput = () => { S.instruction = ins.value; };
  const tlist = body.querySelector('#tlist');
  const sync = () => {
    for (const m of mods) {
      const boxes = [...tlist.querySelectorAll('[data-id]')].filter((b) => m.items.some((i) => i.id === b.dataset.id));
      const mb = tlist.querySelector('[data-mod="' + CSS.escape(m.id) + '"]');
      if (mb && boxes.length) { const n = boxes.filter((b) => b.checked).length; mb.checked = n === boxes.length; mb.indeterminate = n > 0 && n < boxes.length; }
    }
    body.querySelector('#tcount').textContent = S.targets.size + ' 条';
    S.rd.highlight([...S.targets]);
    renderStoryPick();
  };
  // 素材库：自动匹配（按条目来源、标题、组织、技术栈）/ 手动勾选 / 不使用
  S.storyMode = S.storyMode || 'auto';
  S.storyPick = S.storyPick || new Set();
  const stList = body.querySelector('#st-list');
  const renderStoryPick = async () => {
    body.querySelectorAll('#st-mode [data-sm]').forEach((b) => b.classList.toggle('active', b.dataset.sm === S.storyMode));
    if (!S.storiesCache) { try { S.storiesCache = await loadStories(); } catch { S.storiesCache = []; } }
    const all = S.storiesCache;
    if (!all.length) { stList.innerHTML = '<span class="muted">素材库还是空的，可在「经历素材」里从简历导入后再来勾选。</span>'; return; }
    if (S.storyMode === 'off') { stList.innerHTML = '<span class="muted">本次改写不参考素材库。</span>'; return; }
    if (S.storyMode === 'auto') {
      const items = [...S.targets].map((id) => S.rd.payload().items.find((x) => x.id === id)).filter(Boolean);
      const m = matchStories(all, items);
      stList.innerHTML = m.length ? '<span class="muted">将参考：</span>' + m.map((x) => '<span class="badge">' + esc(x.story.title || x.story.org || '素材') + ' → ' + esc(x.items.join('、')) + '</span>').join(' ') : '<span class="muted">没有和所选条目对得上的素材（可切到「手动选择」）。</span>';
      return;
    }
    stList.innerHTML = all.map((st) => '<label class="check"><input type="checkbox" data-sid="' + esc(st.id) + '"' + (S.storyPick.has(st.id) ? ' checked' : '') + '><span>' + esc(st.title || '未命名') + (st.org ? ' · ' + esc(st.org) : '') + '</span></label>').join('');
  };
  body.querySelector('#st-mode').onclick = (e) => { const b = e.target.closest('[data-sm]'); if (!b) return; S.storyMode = b.dataset.sm; renderStoryPick(); };
  stList.onchange = (e) => { const sid = e.target.dataset?.sid; if (!sid) return; e.target.checked ? S.storyPick.add(sid) : S.storyPick.delete(sid); };
  tlist.onchange = (e) => {
    const t = e.target;
    if (t.dataset.mod) {
      const m = mods.find((x) => x.id === t.dataset.mod);
      for (const it of m.items) if (it.editable && it.text) { t.checked ? S.targets.add(it.id) : S.targets.delete(it.id); const b = tlist.querySelector('[data-id="' + CSS.escape(it.id) + '"]'); if (b) b.checked = t.checked; }
    } else if (t.dataset.id) { t.checked ? S.targets.add(t.dataset.id) : S.targets.delete(t.dataset.id); }
    sync();
  };
  body.querySelector('#t-all').onclick = () => { tlist.querySelectorAll('[data-id]').forEach((b) => { b.checked = true; S.targets.add(b.dataset.id); }); sync(); };
  body.querySelector('#t-none').onclick = () => { tlist.querySelectorAll('[data-id]').forEach((b) => { b.checked = false; }); S.targets.clear(); sync(); };
  sync();
  const jdRow = body.querySelector('#jd-row');
  const fillJd = async () => { jdRow.innerHTML = '<div class="row"><span class="small muted" style="white-space:nowrap">目标 JD</span>' + (await jdSelectHtml('jd', S.jdId || '')) + '</div><div class="small muted" style="margin-top:4px">JD 在「JD 适配」页面添加；也可以直接在额外要求里粘贴 JD 要点。</div>'; jdRow.querySelector('select').onchange = (e) => { S.jdId = e.target.value; }; };
  if (S.style === 'jd') fillJd();
  body.querySelector('#styles').onclick = (e) => {
    const c = e.target.closest('[data-s]');
    if (!c) return;
    S.style = c.dataset.s;
    body.querySelectorAll('.opt-card').forEach((x) => x.classList.toggle('active', x === c));
    jdRow.style.display = S.style === 'jd' ? '' : 'none';
    if (S.style === 'jd') fillJd();
  };
  body.querySelector('#rw-run').onclick = () => runRewrite(body.querySelector('#rw-out'));
  if (S.results.length) showResults(body.querySelector('#rw-out'));
}

// 本批改写要带给模型的素材（附带它对应的条目短编号）
async function rewriteStories(items) {
  if (S.storyMode === 'off') return [];
  if (!S.storiesCache) { try { S.storiesCache = await loadStories(); } catch { S.storiesCache = []; } }
  const all = S.storiesCache;
  const matched = matchStories(all, items, { max: 6 });
  const forOf = (id) => matched.find((m) => m.story.id === id)?.items || [];
  const strip = ({ id, sourceSlug, sourceItemId, evidence, createdAt, updatedAt, ...rest }) => rest;
  if (S.storyMode === 'pick') return all.filter((st) => S.storyPick.has(st.id)).map((st) => ({ ...strip(st), forItems: forOf(st.id) }));
  return matched.map((m) => ({ ...strip(m.story), forItems: m.items }));
}

async function runRewrite(out) {
  const ids = [...S.targets].filter((id) => S.rd.item(id)?.editable);
  if (!ids.length) return toast('先勾选要改写的条目（或在左侧大纲点 ✨）', 'warn');
  const jd = S.style === 'jd' ? await jdById(S.jdId) : null;
  if (S.style === 'jd' && !jd && !S.instruction) return toast('JD 定向需要选择一个 JD，或在额外要求里写明岗位要求', 'warn');
  const btn = $('#rw-run');
  btn.disabled = true;
  S.results = [];
  out.innerHTML = '';
  const resume = S.rd.payload();
  const batches = [];
  for (let i = 0; i < ids.length; i += 5) batches.push(ids.slice(i, i + 5));
  try {
    for (let bi = 0; bi < batches.length; bi++) {
      const items = batches[bi].map((id) => resume.items.find((x) => x.id === id));
      const box = el('<div>' + thinkingBox(batches.length > 1 ? '改写中（第 ' + (bi + 1) + '/' + batches.length + ' 批）…' : '正在改写 ' + items.length + ' 条…') + '</div>');
      out.prepend(box);
      try {
        const stories = await rewriteStories(items);
        const r = await callAgent({ task: 'rewrite', resume, items, style: S.style, instruction: S.instruction || '', jd, stories }, box);
        box.remove();
        for (const x of r.data.items || []) {
          const orig = items.find((i) => i.id === x.id);
          if (!orig || !x.html) continue;
          const clean = sanitizeHtml(x.html);
          const used = (x.usedStories || []).map((ref) => stories[Number(String(ref).replace(/\D/g, '')) - 1]).filter(Boolean);
          const sources = [resume.text || '', ...used.map((st) => JSON.stringify(st))].join('\n');
          const lint = lintBullets(clean, { before: orig.html, sources: sources + '\n' + (S.instruction || ''), isProject: !/技能|证书|奖|评价|总结/.test(orig.moduleTitle || '') });
          S.results.push({ id: x.id, before: orig.html, beforeText: htmlToText(orig.html), after: clean, afterText: htmlToText(clean), reason: x.reason, todos: x.todos || [], risk: x.risk, used: used.map((st) => st.title || st.org || '素材'), lint, state: 'pending', mock: r.meta?.mock });
        }
        if (r.data.summary) S.resultSummary = r.data.summary;
        showResults(out);
      } catch (err) { box.remove(); out.prepend(errorBox(err)); if (err.name === 'AbortError' || err.code === 'not_configured') break; }
    }
  } finally { btn.disabled = false; }
}

function showResults(out) {
  const pending = S.results.filter((r) => r.state === 'pending' && r.afterText !== r.beforeText);
  out.innerHTML = (S.results.length ? '<div class="row" style="margin-bottom:10px"><div class="grow small muted">' + esc(S.resultSummary || '') + '</div>' + (pending.length > 1 ? '<button class="btn sm ok" id="acc-all">' + icon('check') + '全部采纳（' + pending.length + '）</button>' : '') + '</div>' : '') + S.results.map((r, i) => {
    const same = r.afterText === r.beforeText;
    const ratio = Math.round(changeRatio(r.beforeText, r.afterText) * 100);
    const lenDiff = r.afterText.length - r.beforeText.length;
    return '<div class="diff-card ' + (r.state === 'applied' ? 'applied' : r.state === 'rejected' ? 'rejected' : '') + '" data-i="' + i + '"><div class="diff-head"><b title="' + esc(itemLabel(r.id)) + '">' + esc(itemLabel(r.id)) + '</b>' + (same ? '<span class="badge">无需修改</span>' : '<span class="badge">' + ratio + '% 改动</span><span class="badge ' + (Math.abs(lenDiff) > r.beforeText.length * 0.25 ? 'warn' : '') + '">' + (lenDiff >= 0 ? '+' : '') + lenDiff + ' 字</span>') + (r.state === 'applied' ? '<span class="badge ok">已采纳</span>' : r.state === 'rejected' ? '<span class="badge">已放弃</span>' : '') + '<button class="btn xs ghost icon" data-a="loc" title="定位">' + icon('eye') + '</button></div><div class="diff-body"><div class="diff-view">' + (r.view === 'side' ? '<div class="side-by-side"><div><h5>原文</h5>' + markTodos(esc(r.beforeText)).replace(/\n/g, '<br>') + '</div><div><h5>改写后</h5>' + markTodos(esc(r.afterText)).replace(/\n/g, '<br>') + '</div></div>' : diffHtml(r.beforeText, r.afterText)) + '</div>' + (r.reason ? '<div class="reason">' + icon('info').replace('<svg', '<svg style="width:13px;height:13px;vertical-align:-2px"') + ' ' + esc(r.reason) + '</div>' : '') + (r.todos.length ? '<div class="risk">需要你补充真实数据：' + r.todos.map((t) => '<span class="todo-mark">' + esc(t) + '</span>').join(' ') + '</div>' : '') + ((r.used || []).length ? '<div class="reason">引用素材：' + r.used.map((t) => '<span class="badge">' + esc(t) + '</span>').join(' ') + '</div>' : '') + ((r.lint || []).length ? '<div class="risk">成稿检查：' + r.lint.map((l) => '<span class="badge ' + (l.level === 'warn' ? 'warn' : '') + '">' + esc(l.text) + '</span>').join(' ') + '</div>' : '') + (r.risk ? '<div class="risk">' + icon('alert').replace('<svg', '<svg style="width:13px;height:13px;vertical-align:-2px"') + ' ' + esc(r.risk) + '</div>' : '') + '</div>' + (r.state === 'pending' && !same ? '<div class="diff-ops"><button class="btn xs ok" data-a="acc">' + icon('check') + '采纳</button><button class="btn xs" data-a="tweak">' + icon('edit') + '微调后采纳</button><button class="btn xs ghost" data-a="view">' + (r.view === 'side' ? '对比视图' : '左右视图') + '</button><button class="btn xs ghost danger" data-a="rej" style="margin-left:auto">放弃</button></div>' : '') + '</div>';
  }).join('');
  out.onclick = (e) => {
    if (e.target.closest('#acc-all')) { S.rd.snapshot(); for (const r of S.results) if (r.state === 'pending' && r.afterText !== r.beforeText) applyResult(r, false); afterApply(); showResults(out); return; }
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const r = S.results[+b.closest('[data-i]').dataset.i];
    const a = b.dataset.a;
    if (a === 'loc') scrollToItem(r.id);
    if (a === 'acc') { S.rd.snapshot(); applyResult(r); afterApply(); showResults(out); }
    if (a === 'rej') { r.state = 'rejected'; showResults(out); }
    if (a === 'view') { r.view = r.view === 'side' ? 'diff' : 'side'; showResults(out); }
    if (a === 'tweak') tweak(r, out);
  };
}

function applyResult(r) {
  S.rd.applyItemHtml(r.id, r.after);
  r.state = 'applied';
}

function afterApply() {
  S.rd.paginate();
  S.rd.highlightTodos();
  markDirty(true);
  renderOutline();
  toast('已写回简历（记得保存 · 可点 ↶ 撤销）');
}

function tweak(r, out) {
  const body = el('<div><p class="small muted" style="margin-top:0">直接修改下方内容（保留列表结构即可），确认后写回。</p><div class="card" contenteditable="true" style="padding:12px 14px 12px 28px;min-height:120px;outline:none;line-height:1.75;font-size:13.5px"></div></div>');
  const box = body.querySelector('[contenteditable]');
  box.innerHTML = r.after;
  modal({ title: '微调改写结果 · ' + itemLabel(r.id), body, width: 640, actions: [
    { label: '取消' },
    { label: '写回简历', cls: 'primary', onClick: () => { r.after = sanitizeHtml(box.innerHTML); r.afterText = htmlToText(r.after); S.rd.snapshot(); applyResult(r); afterApply(); showResults(out); } },
  ] });
}

// ===== 面试追问 =====
async function renderInterview(body) {
  const cached = cacheGet('interview');
  body.innerHTML = `<div class="card card-pad" style="padding:14px 16px;margin-bottom:12px"><div class="small" style="margin-bottom:8px;color:var(--text-2)">Agent 扮演面试官，专挑最显眼、最容易被追问的句子发问（口径与边界 → 方案与权衡 → 岗位对齐 → 临场情境）。</div><div class="row"><div class="grow" id="iv-jd"></div><button class="btn sm primary" id="iv-run">${icon('sparkles')}${cached ? '重新生成' : '生成追问'}</button></div></div><div id="iv-out"></div>`;
  const jdBox = body.querySelector('#iv-jd');
  jdBox.innerHTML = '<select class="input sm" name="jd"><option value="">不结合 JD</option></select>';
  jdSelectHtml('jd', cached?.jdId || '').then((h) => { if (jdBox.isConnected) jdBox.innerHTML = h; });
  const out = body.querySelector('#iv-out');
  if (cached?.data) showInterview(out, cached.data);
  else out.innerHTML = '<div class="empty">' + icon('question') + '<h4>面试前先被 Agent 拷打一遍</h4><p class="small">每个问题都附「回答应覆盖的事实」，不替你编答案。</p></div>';
  body.querySelector('#iv-run').onclick = async () => {
    const jdId = body.querySelector('[name=jd]').value;
    out.innerHTML = thinkingBox('正在生成面试追问…');
    try {
      const r = await callAgent({ task: 'interview', resume: S.rd.payload(), jd: await jdById(jdId) }, out);
      cacheSet('interview', { data: r.data, jdId });
      showInterview(out, r.data);
    } catch (err) { out.innerHTML = ''; out.appendChild(errorBox(err)); }
  };
}

export function interviewHtml(d, locatable = () => false) {
  const rounds = {};
  for (const q of d.questions || []) (rounds[q.round || '其他'] ||= []).push(q);
  return Object.entries(rounds).map(([round, qs]) => '<div class="sec-title">' + esc(round) + ' <span class="badge">' + qs.length + '</span></div>' + qs.map((q) => '<div class="qa"><div class="q"><span class="badge ' + (LEVEL_BADGE[q.risk] || '') + '">' + (LEVEL_TEXT[q.risk] || '') + '</span><span>' + esc(q.question) + '</span></div>' + (q.target ? '<div class="w">针对：「' + esc(q.target) + '」</div>' : '') + (q.why ? '<div class="w">为什么问：' + esc(q.why) + '</div>' : '') + ((q.mustCover || []).length ? '<ul>' + q.mustCover.map((m) => '<li>' + esc(m) + '</li>').join('') + '</ul>' : '') + (q.itemId && locatable(q.itemId) ? '<div style="margin-top:6px"><button class="btn xs ghost" data-loc="' + esc(q.itemId) + '">' + icon('eye') + '定位</button></div>' : '') + '</div>').join('')).join('') +
    (d.selfIntro ? '<div class="sec-title">' + icon('chat') + '1 分钟自我介绍草稿 <button class="btn xs ghost" style="margin-left:auto" data-copy-intro>' + icon('copy') + '复制</button></div><div class="card card-pad small" style="line-height:1.8">' + markTodos(esc(d.selfIntro)) + '</div>' : '') +
    ((d.prepare || []).length ? '<div class="sec-title">' + icon('check') + '面试前准备</div><ul class="small" style="margin:0;padding-left:18px;color:var(--text-2)">' + d.prepare.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul>' : '');
}

function showInterview(out, d) {
  out.innerHTML = interviewHtml(d, (id) => Boolean(S.rd.item(id)));
  out.onclick = (e) => {
    const l = e.target.closest('[data-loc]');
    if (l) scrollToItem(l.dataset.loc);
    if (e.target.closest('[data-copy-intro]')) copyText(d.selfIntro);
  };
}

// ===== 对话 =====
async function renderChat(body, foot) {
  body.innerHTML = '<div class="chat" id="chat"></div>';
  foot.style.display = '';
  foot.innerHTML = `<div class="suggests" id="sugg">${['哪段经历最弱？怎么补强', '这份简历适合投哪些岗位？', '帮我写一段针对大模型应用开发的个人总结', '实习经历第一条面试会怎么问？'].map((s) => '<button>' + s + '</button>').join('')}</div>
  <div class="row" style="margin-bottom:8px"><span class="small muted">结合 JD</span><div class="grow" id="chat-jd"></div><button class="btn xs ghost" id="chat-clear" title="清空对话">${icon('trash')}</button></div>
  <div class="chat-input"><textarea class="input" id="chat-in" rows="1" placeholder="问问 Agent，比如「项目经历第二条怎么写更有说服力？」 Enter 发送，Shift+Enter 换行"></textarea><button class="btn primary icon" id="chat-send">${icon('send')}</button></div>`;
  const jdBox = foot.querySelector('#chat-jd');
  jdBox.onchange = (e) => { if (e.target.name === 'jd') S.chatJd = e.target.value; };
  jdSelectHtml('jd', S.chatJd || '').then((h) => { if (jdBox.isConnected) jdBox.innerHTML = h; });
  const input = foot.querySelector('#chat-in');
  if (S.chatDraft) { input.value = S.chatDraft; S.chatDraft = ''; setTimeout(() => input.focus(), 50); }
  const autoGrow = () => { input.style.height = 'auto'; input.style.height = Math.min(140, input.scrollHeight) + 'px'; };
  input.oninput = autoGrow;
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } };
  foot.querySelector('#chat-send').onclick = () => (S.chatAbort ? S.chatAbort.abort() : send());
  foot.querySelector('#sugg').onclick = (e) => { const b = e.target.closest('button'); if (b) { input.value = b.textContent; send(); } };
  foot.querySelector('#chat-clear').onclick = async () => { if (await confirmDialog('清空与这份简历的对话记录？')) { S.chat = []; saveChat(); drawChat(); } };
  drawChat();

  async function send() {
    const text = input.value.trim();
    if (!text || S.chatAbort) return;
    input.value = ''; autoGrow();
    S.chat.push({ role: 'user', content: text });
    const ai = { role: 'assistant', content: '', pending: true };
    S.chat.push(ai);
    drawChat();
    const sendBtn = foot.querySelector('#chat-send');
    sendBtn.innerHTML = icon('stop');
    S.chatAbort = new AbortController();
    try {
      const r = await runAgent({ task: 'chat', resume: S.rd.payload(), jd: await jdById(S.chatJd), stories: await loadStories(), messages: S.chat.filter((m) => !m.pending && !m.error).map(({ role, content }) => ({ role, content })) }, {
        signal: S.chatAbort.signal,
        onDelta: (t, full) => { ai.content = full; updateLast(); },
      });
      ai.content = r.text || ai.content;
    } catch (err) {
      ai.content = (ai.content ? ai.content + '\n\n' : '') + '⚠️ ' + (err.name === 'AbortError' ? '已停止' : err.message);
      ai.error = !ai.content || err.name !== 'AbortError';
    } finally {
      ai.pending = false;
      S.chatAbort = null;
      if (sendBtn.isConnected) sendBtn.innerHTML = icon('send');
      saveChat();
      drawChat();
    }
  }
}

function drawChat() {
  const box = $('#chat');
  if (!box) return;
  if (!S.chat.length) {
    box.innerHTML = '<div class="empty">' + icon('chat') + '<h4>针对这份简历随便问</h4><p class="small">Agent 能看到整份简历（电话邮箱已打码）。<br>要它编造经历或数据时，它会拒绝并给出真实的替代写法。</p></div>';
    return;
  }
  box.innerHTML = S.chat.map((m, i) => '<div class="msg ' + (m.role === 'user' ? 'user' : 'ai') + '" data-i="' + i + '"><div class="av">' + (m.role === 'user' ? '我' : 'AI') + '</div><div class="bubble">' + (m.role === 'user' ? esc(m.content) : (m.content ? md(m.content) : '<span class="muted">思考中…</span>')) + '</div></div>').join('');
  const body = $('#agent-body');
  body.scrollTop = body.scrollHeight;
}

function updateLast() {
  const box = $('#chat');
  if (!box) return;
  const last = box.lastElementChild?.querySelector('.bubble');
  const m = S.chat[S.chat.length - 1];
  if (last && m) last.innerHTML = md(m.content);
  const body = $('#agent-body');
  body.scrollTop = body.scrollHeight;
}


function pageBadgeHtml() {
  if (!S?.rd) return '<span class="badge">—</span>';
  let ov;
  try { ov = S.rd.overflow(); } catch { ov = { pages: S.rd.pages().length, overLines: 0, onePage: S.rd.pages().length <= 1 }; }
  const pages = ov.pages || S.rd.pages().length;
  if (ov.onePage || pages <= 1) return '<span class="badge page-badge" id="pg-badge">' + pages + ' 页</span>';
  return '<span class="badge page-badge warn" id="pg-badge" title="超出约 ' + ov.overLines + ' 行">' + pages + ' 页 · 超出 ' + ov.overLines + ' 行</span>';
}

function updatePageBadge(pages) {
  const b = document.querySelector('#outline h4 .badge, #pg-badge');
  if (!b) return;
  const html = pageBadgeHtml();
  const tmp = document.createElement('div'); tmp.innerHTML = html;
  b.replaceWith(tmp.firstChild);
}

async function showOnePage() {
  S.rd.paginate();
  const ov = S.rd.overflow();
  const body = el('<div><div class="callout ' + (ov.onePage ? 'ok' : 'warn') + '">' + icon(ov.onePage ? 'check' : 'alert') + '<div><b>' + (ov.onePage ? '已经在一页以内' : '当前 ' + ov.pages + ' 页，大约超出 ' + ov.overLines + ' 行（' + ov.overPx + ' px）') + '</b><div class="small muted" style="margin-top:4px">目标是刚好一页。Agent 会给出各条删减建议，由你逐条采纳，不会直接覆盖未确认的内容。</div></div></div><div id="page-out" style="margin-top:12px"></div></div>');
  const m = modal({
    title: '一页纸检查', body, width: 720,
    actions: ov.onePage
      ? [{ label: '关闭' }]
      : [{ label: '关闭' }, { label: '让 Agent 压缩', cls: 'primary', icon: 'compress', onClick: async () => { await runCompress(body.querySelector('#page-out'), ov); return false; } }],
  });
}

async function runCompress(out, ov) {
  out.innerHTML = thinkingBox('正在按超出行数生成压缩方案…');
  const resume = S.rd.payload();
  const items = resume.items.filter((i) => i.editable && i.text);
  try {
    const r = await callAgent({ task: 'compress', resume, items, pages: ov.pages, overLines: ov.overLines, overPx: ov.overPx }, out);
    const plan = r.data || {};
    const results = (plan.items || []).map((it) => {
      const orig = S.rd.item(it.id);
      return { id: it.id, label: orig ? itemLabel(it.id) : it.id, before: orig?.html || '', after: it.html || '', reason: it.reason || '', savedLines: it.savedLines || 0, state: 'pending' };
    }).filter((x) => x.after && x.after !== x.before);
    if (!results.length) { out.innerHTML = '<p class="muted small">没有给出可应用的删减。可以先手动缩短较长条目再检查。</p>'; return; }
    const paint = () => {
      out.innerHTML = (plan.plan ? '<div class="callout" style="margin-bottom:10px">' + icon('sparkles') + '<div>' + esc(plan.plan) + '</div></div>' : '')
        + results.map((r, i) => '<div class="diff-card ' + (r.state === 'applied' ? 'applied' : r.state === 'rejected' ? 'rejected' : '') + '" data-i="' + i + '"><div class="diff-head"><b>' + esc(r.label) + '</b><span class="badge">约省 ' + r.savedLines + ' 行</span>' + (r.state === 'applied' ? '<span class="badge ok">已采纳</span>' : r.state === 'rejected' ? '<span class="badge">已放弃</span>' : '') + '</div><div class="diff-body"><div class="diff-view">' + diffHtml(htmlToText(r.before), htmlToText(r.after)) + '</div>' + (r.reason ? '<div class="reason">' + esc(r.reason) + '</div>' : '') + '</div>' + (r.state === 'pending' ? '<div class="diff-ops"><button class="btn xs ok" data-a="acc">采纳</button><button class="btn xs ghost danger" data-a="rej" style="margin-left:auto">放弃</button></div>' : '') + '</div>').join('')
        + '<div class="row" style="margin-top:12px"><button class="btn sm primary" id="acc-all">全部采纳并复查页数</button><span class="muted small" id="pg-after"></span></div>';
      out.onclick = (e) => {
        const card = e.target.closest('.diff-card');
        const act = e.target.closest('[data-a]')?.dataset.a;
        if (card && act) {
          const item = results[+card.dataset.i];
          if (act === 'acc') { S.rd.snapshot(); S.rd.applyItemHtml(item.id, item.after, { flash: true }); item.state = 'applied'; markDirty(true); S.rd.paginate(); }
          if (act === 'rej') item.state = 'rejected';
          paint();
        }
      };
      out.querySelector('#acc-all').onclick = () => {
        S.rd.snapshot();
        for (const item of results) if (item.state === 'pending') { S.rd.applyItemHtml(item.id, item.after, { flash: false }); item.state = 'applied'; }
        markDirty(true);
        S.rd.paginate();
        const now = S.rd.overflow();
        paint();
        const tip = out.querySelector('#pg-after');
        if (tip) tip.textContent = now.onePage ? '现在刚好在一页内。记得保存。' : ('还超出约 ' + now.overLines + ' 行，可再跑一次或手动删减。');
        updatePageBadge(now.pages);
        toast(now.onePage ? '已压进一页' : '已采纳，仍超出约 ' + now.overLines + ' 行');
      };
    };
    paint();
  } catch (err) { out.innerHTML = ''; out.appendChild(errorBox(err)); }
}
