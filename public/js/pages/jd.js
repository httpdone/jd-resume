import { matchStories } from '../story-match.js';
import { icon, esc, el, $, $$, toast, confirmDialog, markTodos, copyText, scoreRing, fmtTime, modal } from '../ui.js';
import { get, post, put, del } from '../api.js';
import { runAgent } from '../agent.js';
import { ResumeDoc, htmlToText, sanitizeHtml } from '../resume-dom.js';
import { diffHtml } from '../diff.js';
import { ensureSettings, llmNotice, state } from '../store.js';
import { exportPdfFlow } from './resumes.js';
import { thinkingBox, streamHandlers, VERDICT, LEVEL_BADGE, LEVEL_TEXT, loadJds, loadStories } from './shared.js';
import { interviewHtml } from './editor.js';

const STEPS = ['填写 JD', 'JD 解析', '匹配诊断', '生成定制版', '面试追问'];
let P = null;

// 结构化输出里 itemOrder 是 [{moduleId, order}]，提示词回退路径仍可能是 { 模块id: [短编号] }
function itemOrderEntries(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((row) => {
      if (Array.isArray(row) && row.length >= 2) return [row[0], row[1]];
      const mid = row?.moduleId || row?.module || row?.id || '';
      const order = row?.order || row?.ids || row?.items;
      return [mid, order];
    }).filter((x) => x[0] && Array.isArray(x[1]));
  }
  if (typeof raw === 'object') return Object.entries(raw).filter(([, v]) => Array.isArray(v));
  return [];
}


export async function leave() { P?.abort?.abort(); P = null; return true; }

export async function render(view, [jdId]) {
  P = { list: [], jd: null, step: 0, rd: null, rdSlug: '', abort: null, resumes: [] };
  view.innerHTML = `<div class="page" style="max-width:1500px"><div class="page-head"><div><h1>JD 适配</h1><p>粘贴岗位 JD → Agent 解析要求与关键词 → 建立「要求→证据」矩阵 → 一键复制出定制版简历并关联投递记录。全程不编造经历。</p></div><div class="actions"><button class="btn primary" id="jd-new">${icon('plus')}新建 JD</button></div></div>
  <div class="jd-layout"><div class="card jd-list" id="jd-list"></div><div id="jd-main"></div></div></div>`;
  $('#jd-new').onclick = () => { location.hash = '#/jd/new'; };
  await ensureSettings();
  P.resumes = (await get('/api/resumes')).items;
  P.list = await loadJds(true);
  if (jdId && jdId !== 'new') P.jd = P.list.find((j) => j.id === jdId) || null;
  if (!P.jd && jdId !== 'new' && P.list.length) P.jd = P.list[0];
  if (!P.jd) P.jd = { company: '', role: '', link: '', text: '', baseSlug: P.resumes[0]?.slug || '' };
  P.step = P.jd.interview ? 4 : P.jd.tailoredSlug ? 3 : P.jd.match ? 2 : P.jd.analysis ? 1 : 0;
  renderList();
  renderMain();
}

function renderList() {
  const box = $('#jd-list');
  const n = P.list.length;
  const head = '<div class="jd-list-head"><div class="small muted" style="font-weight:600">已保存的 JD（' + n + '）</div>' + (n ? '<div class="row" style="gap:6px"><label class="small muted" style="display:flex;gap:4px;align-items:center"><input type="checkbox" id="jd-all">全选</label><button class="btn xs ghost danger hide" id="jd-batch">' + icon('trash') + '批量删除</button></div>' : '') + '</div>';
  box.innerHTML = head + (n ? P.list.map((j) => '<div class="jd-item' + (P.jd?.id === j.id ? ' active' : '') + '" data-id="' + j.id + '"><label class="jd-check" onclick="event.stopPropagation()"><input type="checkbox" data-check></label><div class="grow jd-item-body"><b>' + esc(j.company || '未填公司') + '</b><span>' + esc(j.role || '未填岗位') + '</span><div class="row" style="gap:4px;margin-top:4px">' + (j.match ? '<span class="badge ' + (j.match.score >= 75 ? 'ok' : j.match.score >= 60 ? 'info' : 'warn') + '">匹配 ' + j.match.score + '</span>' : j.analysis ? '<span class="badge">已解析</span>' : '<span class="badge">草稿</span>') + (j.tailoredSlug ? '<span class="badge primary">已定制</span>' : '') + '<span class="small muted" style="margin-left:auto">' + fmtTime(j.updatedAt) + '</span></div></div><button class="btn xs ghost icon danger jd-del" data-del title="删除">' + icon('trash') + '</button></div>').join('') : '<div class="empty" style="padding:24px 8px">' + icon('target') + '<p class="small">还没有 JD，点右上角「新建 JD」</p></div>');
  const checked = () => [...box.querySelectorAll('[data-check]:checked')].map((x) => x.closest('[data-id]').dataset.id);
  const syncBatch = () => { const b = $('#jd-batch'); if (b) b.classList.toggle('hide', !checked().length); };
  box.onclick = (e) => {
    if (e.target.id === 'jd-all' || e.target.closest('#jd-all')) return;
    if (e.target.closest('#jd-batch')) { e.preventDefault(); e.stopPropagation(); deleteJdsFlow(checked()); return; }
    if (e.target.closest('[data-del]')) { e.preventDefault(); e.stopPropagation(); const id = e.target.closest('[data-id]')?.dataset.id; if (id) deleteJdsFlow([id]); return; }
    if (e.target.closest('[data-check]')) { syncBatch(); return; }
    const it = e.target.closest('[data-id]'); if (it) location.hash = '#/jd/' + it.dataset.id;
  };
  box.querySelector('#jd-all')?.addEventListener('change', (e) => {
    box.querySelectorAll('[data-check]').forEach((c) => { c.checked = e.target.checked; });
    syncBatch();
  });
}

async function deleteJdsFlow(ids) {
  ids = [...new Set(ids.filter(Boolean))];
  if (!ids.length) return;
  const items = ids.map((id) => P.list.find((j) => j.id === id)).filter(Boolean);
  const tailored = items.filter((j) => j.tailoredSlug);
  const names = items.map((j) => (j.company || '未填公司') + (j.role ? ' · ' + j.role : '')).join('、');
  const body = el('<div><p style="margin:0 0 10px">确定删除 ' + ids.length + ' 条 JD「' + esc(names) + '」？此操作可在几秒内撤销。</p>' + (tailored.length ? '<label class="row" style="gap:8px;align-items:flex-start"><input type="checkbox" data-tailor><span>一并删除由它生成的定制版简历（默认不删）<div class="small muted">' + esc(tailored.map((j) => j.tailoredSlug).join('、')) + '</div></span></label>' : '<p class="muted small" style="margin:0">关联的投递记录只会解除 JD 关联，不会被删除。</p>') + '</div>');
  const ok = await new Promise((resolve) => {
    let done = false;
    modal({
      title: '删除 JD', body, width: 480,
      onClose: () => { if (!done) resolve(null); },
      actions: [
        { label: '取消', onClick: () => { done = true; resolve(null); } },
        { label: '删除', cls: 'danger', onClick: () => { done = true; resolve({ deleteTailored: Boolean(body.querySelector('[data-tailor]')?.checked) }); } },
      ],
    });
  });
  if (!ok) return;
  try {
    const r = await post('/api/jds/_batch', { ids, deleteTailored: ok.deleteTailored });
    const snapshots = r.deleted || [];
    if (P.jd && ids.includes(P.jd.id)) {
      P.jd = { company: '', role: '', link: '', text: '', baseSlug: P.resumes[0]?.slug || '' };
      history.replaceState(null, '', '#/jd/new');
    }
    P.list = await loadJds(true);
    P.resumes = (await get('/api/resumes')).items;
    renderList();
    renderMain();
    toast('已删除 ' + snapshots.length + ' 条 JD', 'ok', 8000, {
      label: '撤销',
      onClick: async () => {
        try {
          await post('/api/jds/_restore', { snapshots });
          P.list = await loadJds(true);
          P.resumes = (await get('/api/resumes')).items;
          renderList();
          renderMain();
          toast('已撤销删除');
        } catch (err) { toast(err.message, 'err'); }
      },
    });
  } catch (err) { toast(err.message, 'err'); }
}


async function saveJd(patch = {}) {
  Object.assign(P.jd, patch);
  const r = await post('/api/jds', P.jd);
  P.jd = r.item;
  P.list = await loadJds(true);
  if (location.hash !== '#/jd/' + P.jd.id) history.replaceState(null, '', '#/jd/' + P.jd.id);
  renderList();
  return P.jd;
}

function stepsBar() {
  const avail = [true, Boolean(P.jd.analysis), Boolean(P.jd.match), Boolean(P.jd.tailoredSlug), Boolean(P.jd.tailoredSlug)];
  const done = [Boolean(P.jd.analysis), Boolean(P.jd.match), Boolean(P.jd.tailoredSlug), Boolean(P.jd.tailoredSlug), Boolean(P.jd.interview)];
  return '<div class="card steps" id="steps">' + STEPS.map((s, i) => '<div class="step ' + (i === P.step ? 'cur' : done[i] ? 'done' : '') + '" data-s="' + i + '" style="cursor:' + (avail[i] ? 'pointer' : 'default') + '"><span class="n">' + (done[i] && i !== P.step ? '✓' : i + 1) + '</span>' + s + '</div>').join('') + '</div>';
}

async function renderMain() {
  const main = $('#jd-main');
  main.innerHTML = stepsBar() + '<div class="tailor-wrap"><div id="jd-step"></div><div><div class="mini-stage" id="mini"><div class="small muted" style="margin:-4px 0 10px;display:flex;align-items:center;gap:6px" id="mini-cap"></div><div class="paper-wrap" id="mini-paper"><iframe id="mini-frame"></iframe></div></div></div></div>';
  main.querySelector('#steps').onclick = (e) => {
    const s = e.target.closest('[data-s]');
    if (!s) return;
    const i = +s.dataset.s;
    const avail = [true, P.jd.analysis, P.jd.match, P.jd.tailoredSlug, P.jd.tailoredSlug];
    if (avail[i]) { P.step = i; renderMain(); }
  };
  const showSlug = P.step >= 3 && P.jd.tailoredSlug && P.resumes.some((r) => r.slug === P.jd.tailoredSlug) ? P.jd.tailoredSlug : P.jd.baseSlug;
  await loadPreview(showSlug);
  const box = main.querySelector('#jd-step');
  [step0, step1, step2, step3, step4][P.step](box);
}

async function loadPreview(slug) {
  const cap = $('#mini-cap');
  const frame = $('#mini-frame');
  if (!slug || !P.resumes.some((r) => r.slug === slug)) { cap.textContent = '选择一份基础简历后在这里预览'; P.rd = null; return; }
  cap.innerHTML = icon('eye') + '<span>' + (slug === P.jd.tailoredSlug ? '定制版：' : '基础简历：') + '<b>' + esc(slug) + '</b></span>' + (P.jd.analysis ? '<span class="badge primary" style="margin-left:auto">JD 关键词已高亮</span>' : '');
  const z = 0.5;
  P.rd = new ResumeDoc(frame);
  P.rd.onLayout = ({ height }) => {
    frame.style.transform = 'scale(' + z + ')';
    const wrap = $('#mini-paper');
    if (wrap) { wrap.style.width = 794 * z + 'px'; wrap.style.height = height * z + 'px'; wrap.style.margin = '0 auto'; }
  };
  await P.rd.load('/preview/' + encodeURIComponent(slug) + '?t=' + Date.now());
  P.rdSlug = slug;
  P.rd.highlightKeywords(kwWords());
}

function kwWords() {
  const a = P.jd.analysis;
  if (!a) return [];
  return (a.keywords || []).flatMap((k) => [k.word || k, ...(k.synonyms || [])]).filter(Boolean);
}

function coverage() {
  const text = (P.rd?.toLLMText() || '').toLowerCase();
  return (P.jd.analysis?.keywords || []).map((k) => {
    const words = [k.word || k, ...(k.synonyms || [])];
    return { word: k.word || k, weight: k.weight || 'medium', hit: words.some((w) => w && text.includes(String(w).toLowerCase())) };
  });
}

async function agent(payload, box) {
  P.abort?.abort();
  P.abort = new AbortController();
  box.querySelector('[data-stop]')?.addEventListener('click', () => P.abort.abort());
  try {
    if (!payload.stories) {
      try { payload.stories = await loadStories(); } catch { payload.stories = []; }
    }
    return await runAgent(payload, { ...streamHandlers(box), signal: P.abort.signal });
  } finally { P.abort = null; }
}

function errorNode(err) {
  const n = el('<div class="callout warn">' + icon('alert') + '<div><b>没有成功</b><div class="small"></div>' + (err.code === 'not_configured' ? '<div style="margin-top:8px"><a class="btn xs soft" href="#/settings">去设置</a></div>' : '') + '</div></div>');
  n.querySelector('.small').textContent = err.name === 'AbortError' ? '已停止' : err.message;
  return n;
}

// ---------- Step 0：填写 ----------
function step0(box) {
  const j = P.jd;
  box.innerHTML = `${llmNotice(state.settings)}<div class="card card-pad">
    <div class="cols"><div class="field"><label>公司</label><input class="input" name="company" placeholder="如：字节跳动"></div><div class="field"><label>岗位</label><input class="input" name="role" placeholder="如：大模型算法实习生"></div></div>
    <div class="cols"><div class="field"><label>基础简历（在它的副本上定制）</label><select class="input" name="baseSlug">${P.resumes.map((r) => '<option value="' + esc(r.slug) + '">' + esc(r.slug) + '</option>').join('')}</select></div>
    <div class="field"><label>岗位链接</label><div class="row"><input class="input grow" name="link" placeholder="Boss 直聘 / 牛客 / 企业官网等 https://"><button class="btn sm" type="button" id="fetch-jd">${icon('download')}抓取</button></div><div class="hint">很多招聘站需要登录或有反爬，抓取失败时可把整页文字或 HTML 粘贴到下面，再点「从粘贴抽取」。</div></div></div>
    <div class="field"><label>JD 原文</label><textarea class="input" name="text" rows="12" placeholder="把招聘页面上的「岗位职责」「任职要求」「加分项」整段粘贴进来；也可以粘贴整页 HTML"></textarea><div class="row" style="margin-top:6px"><span class="hint" id="jd-len"></span><span class="grow"></span><button class="btn xs ghost" type="button" id="extract-paste">${icon('sparkles')}从粘贴抽取</button></div></div>
    <div id="fetch-msg"></div>
    <div class="row"><button class="btn primary" id="go">${icon('sparkles')}保存并解析 JD</button><button class="btn ghost" id="save-only">仅保存</button>${j.id ? '<button class="btn ghost danger" id="del-jd" style="margin-left:auto">' + icon('trash') + '删除此 JD</button>' : ''}</div>
  </div>`;
  for (const k of ['company', 'role', 'link', 'text', 'baseSlug']) { const f = box.querySelector('[name=' + k + ']'); if (j[k]) f.value = j[k]; }
  const ta = box.querySelector('[name=text]');
  const len = () => { box.querySelector('#jd-len').textContent = ta.value.length + ' 字'; };
  ta.oninput = len; len();
  box.querySelector('#fetch-jd').onclick = () => fetchJd(box, 'url');
  box.querySelector('#extract-paste').onclick = () => fetchJd(box, 'paste');
  box.querySelector('[name=baseSlug]').onchange = (e) => loadPreview(e.target.value);
  const collect = () => Object.fromEntries(['company', 'role', 'link', 'text', 'baseSlug'].map((k) => [k, box.querySelector('[name=' + k + ']').value.trim()]));
  box.querySelector('#save-only').onclick = async () => { await saveJd(collect()); toast('已保存'); };
  box.querySelector('#del-jd')?.addEventListener('click', async () => {
    if (!(await confirmDialog('删除这条 JD 记录？（已生成的定制版简历和投递记录不会删除）', { ok: '删除', danger: true }))) return;
    await del('/api/jds/' + j.id); toast('已删除'); location.hash = '#/jd/new';
  });
  box.querySelector('#go').onclick = async () => {
    const data = collect();
    if (data.text.length < 30) return toast('JD 文本太短，请粘贴完整 JD', 'warn');
    if (!data.baseSlug) return toast('请先在简历库创建一份简历', 'warn');
    await saveJd(data);
    const out = el('<div style="margin-top:14px">' + thinkingBox('正在解析 JD：硬性条件、职责、关键词…') + '</div>');
    box.appendChild(out);
    try {
      const r = await agent({ task: 'jd_analyze', jd: { company: data.company, role: data.role, text: data.text } }, out);
      const a = r.data;
      await saveJd({ analysis: a, company: data.company || a.company || '', role: data.role || a.role || '', match: null });
      P.step = 1;
      renderMain();
    } catch (err) { out.innerHTML = ''; out.appendChild(errorNode(err)); }
  };
}

// ---------- Step 1：解析结果 ----------
function step1(box) {
  const a = P.jd.analysis || {};
  const cov = coverage();
  const hit = cov.filter((c) => c.hit).length;
  box.innerHTML = `<div class="card card-pad">
    <div class="row" style="align-items:flex-start"><div class="grow"><div style="font-size:18px;font-weight:700">${esc(P.jd.company)} · ${esc(P.jd.role)}</div><div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">${a.roleType ? '<span class="badge primary">' + esc(a.roleType) + '</span>' : ''}${a.level ? '<span class="badge">' + esc(a.level) + '</span>' : ''}${a.location ? '<span class="badge">' + esc(a.location) + '</span>' : ''}${P.jd.link ? '<a class="badge info" href="' + esc(P.jd.link) + '" target="_blank" rel="noopener">' + icon('link').replace('<svg', '<svg style="width:12px;height:12px"') + '岗位链接</a>' : ''}</div></div><button class="btn sm ghost" id="edit-jd">${icon('edit')}修改 JD</button></div>
    ${a.summary ? '<div class="callout" style="margin:14px 0 0">' + icon('target') + '<div><b>岗位主线</b><div class="small" style="margin-top:2px">' + esc(a.summary) + '</div></div></div>' : ''}
  </div>
  <div class="card" style="margin-top:14px"><div class="card-head"><h3>${icon('key')}ATS 关键词 <span class="badge ${hit / Math.max(1, cov.length) >= 0.6 ? 'ok' : 'warn'}">基础简历覆盖 ${hit}/${cov.length}</span></h3></div><div class="card-body">${cov.map((c) => '<span class="chip ' + (c.hit ? 'hit' : 'miss') + (c.weight === 'high' ? ' high' : '') + '">' + (c.hit ? '✓ ' : '✗ ') + esc(c.word) + (c.weight === 'high' ? ' ★' : '') + '</span>').join('')}<div class="small muted" style="margin-top:4px">绿色 = 简历里已出现；红色 = 未出现（只有真实做过才应补上）；★ = 高权重</div></div></div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><div class="card-head"><h3>${icon('alert')}硬性条件</h3></div><div class="card-body">${(a.hardRequirements || []).map((r) => '<div class="list-row" style="align-items:flex-start"><span class="badge ' + (LEVEL_BADGE[r.weight] || '') + '">' + (LEVEL_TEXT[r.weight] || '') + '</span><div class="small"><div>' + esc(r.text || r) + '</div>' + (r.quote && r.quote !== r.text ? '<div class="muted">原文：' + esc(r.quote) + '</div>' : '') + '</div></div>').join('') || '<p class="muted small">未识别到硬性条件</p>'}</div></div>
    <div class="card"><div class="card-head"><h3>${icon('briefcase')}核心职责</h3></div><div class="card-body"><ol class="small" style="margin:0;padding-left:18px;line-height:1.8">${(a.responsibilities || []).map((r) => '<li>' + esc(r) + '</li>').join('')}</ol></div></div>
    <div class="card"><div class="card-head"><h3>${icon('layers')}技能要求</h3></div><div class="card-body">${(a.skills || []).map((s) => '<span class="chip' + (s.weight === 'high' ? ' high' : '') + '">' + esc(s.name || s) + '</span>').join('')}${(a.bonus || []).length ? '<div class="sec-title">加分项</div><ul class="small" style="margin:0;padding-left:18px">' + a.bonus.map((b) => '<li>' + esc(b) + '</li>').join('') + '</ul>' : ''}</div></div>
    <div class="card"><div class="card-head"><h3>${icon('eye')}隐性考察点 / 淘汰风险</h3></div><div class="card-body"><ul class="small" style="margin:0;padding-left:18px;line-height:1.8">${(a.hiddenTests || []).map((h) => '<li>' + esc(h) + '</li>').join('')}</ul>${(a.riskFlags || []).length ? '<div class="sec-title" style="color:var(--bad)">可能的初筛门槛</div><ul class="small" style="margin:0;padding-left:18px">' + a.riskFlags.map((h) => '<li>' + esc(h) + '</li>').join('') + '</ul>' : ''}</div></div>
  </div>
  <div class="row" style="margin-top:16px"><span class="grow"></span><button class="btn primary" id="go">${icon('sparkles')}下一步：匹配诊断</button></div><div id="out" style="margin-top:12px"></div>`;
  box.querySelector('#edit-jd').onclick = () => { P.step = 0; renderMain(); };
  box.querySelector('#go').onclick = async () => {
    if (!P.rd) return toast('基础简历加载失败', 'err');
    const out = box.querySelector('#out');
    out.innerHTML = thinkingBox('正在逐项比对 JD 要求与简历证据…');
    try {
      const r = await agent({ task: 'jd_match', jd: { company: P.jd.company, role: P.jd.role, text: P.jd.text, analysis: P.jd.analysis }, resume: P.rd.payload() }, out);
      await saveJd({ match: r.data });
      P.step = 2;
      renderMain();
    } catch (err) { out.innerHTML = ''; out.appendChild(errorNode(err)); }
  };
}

// ---------- Step 2：匹配 ----------
const TYPE = { direct: ['原岗实做', 'ok'], adjacent: ['能力相近', 'info'], weak: ['仅有提及', 'warn'], none: ['材料未见', 'bad'] };
const STATUS = { '材料充分': 'ok', '已覆盖': 'ok', '表述偏弱': 'warn', '弱覆盖': 'warn', '尚未体现': 'bad', '未覆盖': 'bad', '待向你确认': 'info', '可补充': 'info', '不宜牵强写入': '', '不建议硬凑': '' };

function step2(box) {
  const m = P.jd.match || {};
  const base = P.jd.baseSlug || '';
  const defName = [base.split('-')[0] || base, P.jd.company, P.jd.role].filter(Boolean).join('-').replace(/[\\/:*?"<>|]/g, '').slice(0, 60);
  box.innerHTML = `<div class="card card-pad"><div class="row" style="gap:18px;align-items:center">${scoreRing(m.score || 0, '匹配度')}<div class="grow"><span class="verdict ${esc(m.verdict || '')}">${esc(VERDICT[m.verdict] || m.verdict || '')}</span><div style="font-weight:600;margin-top:8px">${esc(m.verdictText || '')}</div>${m.eliminationRisk ? '<div class="small" style="color:var(--bad);margin-top:6px">⚠ ' + esc(m.eliminationRisk) + '</div>' : ''}<div class="small muted" style="margin-top:6px">分数只是材料匹配诊断，不是录用概率。</div></div></div>
    <div class="grid g2" style="margin-top:12px;gap:4px 24px">${(m.dimensions || []).map((d) => '<div class="dim"><div class="row"><span>' + esc(d.name) + '</span><b>' + d.score + '/' + d.max + '</b></div><div class="bar"><i style="width:' + Math.round(100 * d.score / Math.max(1, d.max)) + '%"></i></div>' + (d.comment ? '<p>' + esc(d.comment) + '</p>' : '') + '</div>').join('')}</div></div>
  <div class="card" style="margin-top:14px"><div class="card-head"><h3>${icon('list')}岗位条件对照表</h3></div><div class="card-body" style="overflow:auto"><table class="req-table"><thead><tr><th>JD 要求</th><th>简历证据</th><th>证据</th><th>状态</th><th>建议动作</th></tr></thead><tbody>${(m.matrix || []).map((r) => '<tr><td><span class="badge ' + (LEVEL_BADGE[r.weight] || '') + '" style="margin-right:4px">' + (LEVEL_TEXT[r.weight] || '') + '</span>' + esc(r.requirement) + '</td><td class="small" style="color:var(--text-2)">' + (esc(r.evidence) || '<span class="muted">—</span>') + '</td><td><span class="badge ' + (TYPE[r.type]?.[1] || '') + '">' + (TYPE[r.type]?.[0] || esc(r.type)) + '</span></td><td><span class="badge ' + (STATUS[r.status] ?? '') + '">' + esc(r.status) + '</span></td><td class="small">' + esc(r.action) + '</td></tr>').join('')}</tbody></table></div></div>
  <div class="grid g3" style="margin-top:14px">
    <div class="card"><div class="card-head"><h3 style="color:var(--ok)">${icon('trophy')}优势</h3></div><div class="card-body"><ul class="small" style="margin:0;padding-left:18px;line-height:1.8">${(m.strengths || []).map((x) => '<li>' + esc(x) + '</li>').join('')}</ul></div></div>
    <div class="card"><div class="card-head"><h3 style="color:var(--bad)">${icon('alert')}关键缺口</h3></div><div class="card-body"><ul class="small" style="margin:0;padding-left:18px;line-height:1.8">${(m.gaps || []).map((x) => '<li>' + esc(x) + '</li>').join('')}</ul></div></div>
    <div class="card"><div class="card-head"><h3>${icon('x')}不宜牵强写入</h3></div><div class="card-body"><ul class="small" style="margin:0;padding-left:18px;line-height:1.8">${(m.doNotForce || []).map((x) => '<li>' + esc(x) + '</li>').join('') || '<li class="muted">无</li>'}</ul></div></div>
  </div>
  ${m.strategy ? '<div class="callout" style="margin-top:14px">' + icon('sparkles') + '<div><b>定制策略</b><div class="small">' + esc(m.strategy) + '</div></div></div>' : ''}
  ${(m.questions || []).length ? '<div class="card" style="margin-top:14px"><div class="card-head"><h3>' + icon('question') + '为避免编造，建议你先补充</h3></div><div class="card-body"><ul class="small" style="margin:0;padding-left:18px;line-height:1.9">' + m.questions.map((q) => '<li>' + esc(q) + '</li>').join('') + '</ul><div class="small muted">有真实答案的话，写进下面的「补充说明」，Agent 会据此改写。</div></div></div>' : ''}
  <div class="card card-pad" style="margin-top:14px"><h3 style="margin:0 0 12px;font-size:15px;display:flex;gap:8px;align-items:center">${icon('wand')}一键生成定制版</h3>
    <div class="cols"><div class="field"><label>定制版名称</label><input class="input" name="name"></div><div class="field"><label>基础简历</label><input class="input" value="${esc(base)}" disabled></div></div>
    <div class="field"><label>补充说明 / 额外要求（可选）</label><textarea class="input" name="ins" rows="3" placeholder="例如：我在实习中也用过 Kafka 做异步解耦（真实）；希望突出 RAG 项目"></textarea></div>
    <div class="field" id="story-pick" style="margin-top:4px"></div>
    <div class="row" style="flex-wrap:wrap;gap:10px"><label class="check"><input type="checkbox" name="mkapp" checked>同时创建投递记录（状态：待投递）</label><label class="check"><input type="checkbox" name="en">生成英文定制版（结构不变，适合英文 JD）</label><span class="grow"></span><button class="btn primary" id="go">${icon('sparkles')}生成定制版简历</button></div>
    <div id="out" style="margin-top:12px"></div></div>`;
  box.querySelector('[name=name]').value = defName;
  const looksEn = /[A-Za-z]/.test((P.jd.text || '').slice(0, 400)) && !/[一-鿿]/.test((P.jd.text || '').slice(0, 200));
  if (looksEn) box.querySelector('[name=en]').checked = true;
  fillStoryPick(box);
  box.querySelector('[name=en]').onchange = () => {
    const inp = box.querySelector('[name=name]');
    if (box.querySelector('[name=en]').checked && !/-EN$/i.test(inp.value)) inp.value = inp.value.replace(/-EN$/i, '') + '-EN';
    if (!box.querySelector('[name=en]').checked) inp.value = inp.value.replace(/-EN$/i, '');
  };
  if (looksEn) box.querySelector('[name=en]').onchange();
  box.querySelector('#go').onclick = () => runTailor(box);
}

async function runTailor(box) {
  const out = box.querySelector('#out');
  const name = box.querySelector('[name=name]').value.trim();
  if (!name) return toast('请填写定制版名称', 'warn');
  if (!P.rd || P.rdSlug !== P.jd.baseSlug) await loadPreview(P.jd.baseSlug);
  const resume = P.rd.payload();
  const modules = P.rd.modules().map((m) => ({ id: m.id, title: m.title }));
  const items = resume.items.filter((i) => i.editable && i.text);
  out.innerHTML = thinkingBox('正在生成定制方案：调整侧重、措辞与顺序…');
  let r;
  try {
    const picked = [...box.querySelectorAll('[name=story]:checked')].map((x) => x.value);
    const allStories = await loadStories();
    const chosen = picked.length ? allStories.filter((st) => picked.includes(st.id)) : allStories;
    // 标出每条素材对应哪段经历，避免模型把 A 项目的事实挪到 B 项目
    const matched = matchStories(chosen, items, { max: 50, min: 24 });
    const stories = chosen.map(({ id, sourceSlug, sourceItemId, evidence, createdAt, updatedAt, ...rest }) => ({ ...rest, forItems: matched.find((m) => m.story.id === id)?.items || [] }));
    r = await agent({ task: 'tailor', jd: { company: P.jd.company, role: P.jd.role, text: P.jd.text, analysis: P.jd.analysis }, match: P.jd.match, resume, modules, items, instruction: box.querySelector('[name=ins]').value.trim(), stories }, out);
  } catch (err) { out.innerHTML = ''; out.appendChild(errorNode(err)); return; }
  out.innerHTML = '<div class="thinking"><span class="pulse"></span>正在复制简历并写回修改…</div>';
  try {
    const t = r.data;
    const wantEn = Boolean(box.querySelector('[name=en]')?.checked);
    const created = await post('/api/resumes', { name, from: P.jd.baseSlug, unique: true, meta: { target: { company: P.jd.company, role: P.jd.role, jdId: P.jd.id }, lang: wantEn ? 'en' : undefined } });
    const slug = created.slug;
    P.resumes = (await get('/api/resumes')).items;
    await loadPreview(slug);
    const changes = [];
    if (t.moduleOrder && P.rd.reorderModules(t.moduleOrder)) changes.push({ kind: 'order', text: '模块顺序调整为：' + t.moduleOrder.map((id) => P.rd.modules().find((m) => m.id === id)?.title).filter(Boolean).join(' → ') });
    for (const [mid, order] of itemOrderEntries(t.itemOrder)) if (P.rd.reorderItems(mid, order)) changes.push({ kind: 'order', text: (P.rd.modules().find((m) => m.id === mid)?.title || mid) + '：相关经历前置' });
    for (const it of t.items || []) {
      const orig = items.find((x) => x.id === it.id);
      if (!orig || !it.html) continue;
      const clean = P.rd.applyItemHtml(it.id, it.html, { flash: false });
      changes.push({ kind: 'item', id: it.id, label: [orig.moduleTitle, (orig.title || '').split(' ｜ ')[0]].filter(Boolean).join(' · '), before: orig.html, after: clean, reason: it.reason, jdRequirement: it.jdRequirement, todos: it.todos || [] });
    }
    if (wantEn) {
      out.innerHTML = thinkingBox('正在把定制版译为英文…');
      const resume2 = P.rd.payload();
      const tr = await agent({ task: 'translate', resume: resume2, items: resume2.items, modules: P.rd.modules().map((m) => ({ id: m.id, title: m.title })), profileText: P.rd.profileText() }, out);
      P.rd.applyTranslation(tr.data || {});
    }
    P.rd.paginate();
    await put('/api/resumes/' + encodeURIComponent(slug), { html: P.rd.serialize() });
    P.rd.highlightTodos();
    P.rd.highlightKeywords(kwWords());
    let appId = P.jd.appId;
    if (box.querySelector('[name=mkapp]').checked) {
      const app = await post('/api/apps', { company: P.jd.company, role: P.jd.role, link: P.jd.link, resumeSlug: slug, jdId: P.jd.id, status: '待投递', notes: '由 JD 适配自动创建' });
      appId = app.item.id;
    }
    await saveJd({ tailoredSlug: slug, tailor: { ...t, changes, at: new Date().toISOString(), mock: r.meta?.mock }, appId, interview: null });
    toast('定制版「' + slug + '」已生成');
    P.step = 3;
    renderMain();
  } catch (err) { out.innerHTML = ''; out.appendChild(errorNode(err)); }
}

// ---------- Step 3：定制结果 ----------
function step3(box) {
  const t = P.jd.tailor || {};
  const slug = P.jd.tailoredSlug;
  const exists = P.resumes.some((r) => r.slug === slug);
  const changes = t.changes || [];
  box.innerHTML = `<div class="card card-pad"><div class="row" style="flex-wrap:wrap"><div class="grow"><div class="small muted">定制版简历</div><div style="font-size:17px;font-weight:700">${esc(slug)}</div>${exists ? '' : '<div class="small" style="color:var(--bad)">该简历已被删除或改名</div>'}</div>
    ${exists ? '<a class="btn sm" href="#/editor/' + encodeURIComponent(slug) + '">' + icon('edit') + '在编辑器中打开</a><button class="btn sm" id="pdf">' + icon('download') + '导出 PDF</button>' : ''}${P.jd.appId ? '<a class="btn sm soft" href="#/apps">' + icon('calendar') + '查看投递记录</a>' : ''}</div>
    ${t.summary ? '<div class="small" style="margin-top:10px;color:var(--text-2)">' + esc(t.summary) + '</div>' : ''}</div>
  ${t.bossGreeting ? '<div class="card" style="margin-top:14px"><div class="card-head"><h3>' + icon('chat') + 'Boss 直聘开场白</h3><button class="btn xs ghost" id="copy-boss">' + icon('copy') + '复制</button></div><div class="card-body small" style="line-height:1.8">' + markTodos(esc(t.bossGreeting)) + '</div></div>' : ''}
  <div class="sec-title" style="margin-top:18px">${icon('wand')}本次修改 <span class="badge">${changes.length}</span><span class="small muted" style="font-weight:400">（已写入定制版；可逐条恢复原文）</span></div>
  ${changes.map((c, i) => c.kind === 'order' ? '<div class="diff-card"><div class="diff-head">' + icon('layers') + '<b>' + esc(c.text) + '</b></div></div>' : '<div class="diff-card' + (c.reverted ? ' rejected' : '') + '" data-i="' + i + '"><div class="diff-head"><b>' + esc(c.label) + '</b>' + (c.jdRequirement ? '<span class="badge primary" title="对应 JD 要求">' + esc(String(c.jdRequirement).slice(0, 16)) + '</span>' : '') + (c.reverted ? '<span class="badge">已恢复原文</span>' : '') + '</div><div class="diff-body"><div class="diff-view">' + diffHtml(htmlToText(c.before), htmlToText(c.after)) + '</div>' + (c.reason ? '<div class="reason">' + esc(c.reason) + '</div>' : '') + ((c.todos || []).length ? '<div class="risk">需要你补充：' + c.todos.map((x) => '<span class="todo-mark">' + esc(x) + '</span>').join(' ') + '</div>' : '') + '</div>' + (exists ? '<div class="diff-ops">' + (c.reverted ? '<button class="btn xs soft" data-a="redo">重新应用</button>' : '<button class="btn xs ghost" data-a="revert">' + icon('undo') + '恢复原文</button>') + '<button class="btn xs ghost" data-a="loc">' + icon('eye') + '定位</button></div>' : '') + '</div>').join('') || '<p class="muted small">Agent 认为无需修改正文。</p>'}
  ${(t.gaps || []).length ? '<div class="callout warn" style="margin-top:14px">' + icon('alert') + '<div><b>JD 要求但简历没有证据（未写入）</b><ul class="small" style="margin:4px 0 0;padding-left:18px">' + t.gaps.map((g) => '<li>' + esc(g) + '</li>').join('') + '</ul><div class="small muted" style="margin-top:4px">如果你确实有相关经历，到编辑器里补充；没有就别硬凑，面试会露馅。</div></div></div>' : ''}
  <div class="row" style="margin-top:16px"><button class="btn ghost" id="regen">${icon('refresh')}重新生成</button><span class="grow"></span><button class="btn primary" id="go">${icon('question')}下一步：面试追问</button></div>`;
  box.querySelector('#copy-boss')?.addEventListener('click', () => copyText(t.bossGreeting));
  box.querySelector('#pdf')?.addEventListener('click', async (e) => { const b = e.currentTarget; b.classList.add('loading'); try { await exportPdfFlow(slug); } catch (err) { toast(err.message, 'err'); } finally { b.classList.remove('loading'); } });
  box.querySelector('#regen').onclick = () => { P.step = 2; renderMain(); };
  box.querySelector('#go').onclick = () => { P.step = 4; renderMain(); };
  box.onclick = async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const c = changes[+b.closest('[data-i]').dataset.i];
    if (b.dataset.a === 'loc') { P.rd.highlight([c.id]); const loc = P.rd.locate(c.id); if (loc) $('#mini').scrollTo({ top: loc.top * 0.5 - 40, behavior: 'smooth' }); return; }
    try {
      P.rd.applyItemHtml(c.id, b.dataset.a === 'revert' ? c.before : c.after);
      c.reverted = b.dataset.a === 'revert';
      P.rd.paginate();
      await put('/api/resumes/' + encodeURIComponent(slug), { html: P.rd.serialize() });
      await saveJd({ tailor: t });
      toast(c.reverted ? '已恢复原文' : '已重新应用');
      step3(box);
    } catch (err) { toast(err.message, 'err'); }
  };
}

// ---------- Step 4：面试追问 ----------
function step4(box) {
  const d = P.jd.interview;
  box.innerHTML = `<div class="card card-pad"><div class="row"><div class="grow small" style="color:var(--text-2)">基于<b>定制版简历</b>和 JD 生成面试官视角的追问：优先攻击强动词、数字和与 JD 相关的表述，并给出回答应覆盖的事实。</div><button class="btn sm primary" id="go">${icon('sparkles')}${d ? '重新生成' : '生成面试追问'}</button></div></div><div id="out" style="margin-top:12px"></div>`;
  const out = box.querySelector('#out');
  const show = (data) => { out.innerHTML = interviewHtml(data, (id) => Boolean(P.rd?.item(id))); out.onclick = (e) => { if (e.target.closest('[data-copy-intro]')) copyText(data.selfIntro); const l = e.target.closest('[data-loc]'); if (l) { P.rd.highlight([l.dataset.loc]); const loc = P.rd.locate(l.dataset.loc); if (loc) $('#mini').scrollTo({ top: loc.top * 0.5 - 40, behavior: 'smooth' }); } }; };
  if (d) show(d);
  box.querySelector('#go').onclick = async () => {
    if (!P.rd) return toast('简历未加载', 'err');
    out.innerHTML = thinkingBox('面试官正在读你的简历…');
    try {
      const r = await agent({ task: 'interview', jd: { company: P.jd.company, role: P.jd.role, text: P.jd.text, analysis: P.jd.analysis }, resume: P.rd.payload() }, out);
      await saveJd({ interview: r.data });
      show(r.data);
    } catch (err) { out.innerHTML = ''; out.appendChild(errorNode(err)); }
  };
}


async function fillStoryPick(box) {
  const host = box.querySelector('#story-pick');
  if (!host) return;
  const stories = await loadStories();
  if (!stories.length) {
    host.innerHTML = '<div class="hint">还没有素材库记录。可在「素材库」从简历导入，定制时会作为证据来源（仍然不编造）。</div>';
    return;
  }
  host.innerHTML = '<label>从素材库选用经历（作为证据，不会编造）</label><div class="story-pick">' + stories.map((st) => '<label class="check"><input type="checkbox" name="story" value="' + esc(st.id) + '" checked><span>' + esc(st.title || '未命名') + (st.org ? ' · ' + esc(st.org) : '') + '</span></label>').join('') + '</div>';
}

async function fetchJd(box, mode) {
  const msg = box.querySelector('#fetch-msg');
  const link = box.querySelector('[name=link]').value.trim();
  const text = box.querySelector('[name=text]').value.trim();
  const looksHtml = /<\/[a-z]+>/i.test(text);
  if (mode === 'url' && !link) return toast('请先填写岗位链接', 'warn');
  if (mode === 'paste' && text.length < 40) return toast('请先把岗位页全文或 HTML 粘贴到「JD 原文」', 'warn');
  msg.innerHTML = '<div class="thinking"><span class="pulse"></span>正在' + (mode === 'url' ? '抓取并抽取 JD' : '从粘贴内容抽取') + '…</div>';
  try {
    const body = mode === 'url'
      ? { url: link, text: text || undefined, html: looksHtml ? text : undefined, useLlm: true }
      : { text: looksHtml ? undefined : text, html: looksHtml ? text : undefined, url: link || undefined, useLlm: true };
    const r = await post('/api/jds/fetch', body);
    if (r.company && !box.querySelector('[name=company]').value) box.querySelector('[name=company]').value = r.company;
    else if (r.company) box.querySelector('[name=company]').value = r.company;
    if (r.role) box.querySelector('[name=role]').value = r.role;
    if (r.text) {
      box.querySelector('[name=text]').value = r.text;
      box.querySelector('#jd-len').textContent = r.text.length + ' 字';
    }
    const warn = (r.warnings || []).filter(Boolean).join('；');
    if (r.ok) {
      msg.innerHTML = '<div class="callout">' + icon('check') + '<div>已抽取' + (r.company || r.role ? '：' + [r.company, r.role].filter(Boolean).join(' · ') : '') + (r.mock ? '（演示规则/模型）' : '') + (r.source ? ' · 来源 ' + r.source : '') + (warn ? '<div class="small muted">' + esc(warn) + '</div>' : '') + '</div></div>';
      toast('已填入抽取结果');
    } else {
      msg.innerHTML = '<div class="callout warn">' + icon('alert') + '<div><b>' + esc(r.hint || r.error || '没能稳定抽出完整 JD') + '</b>' + (warn ? '<div class="small" style="margin-top:4px">' + esc(warn) + '</div>' : '') + '<div class="small muted" style="margin-top:4px">Boss 直聘、牛客等多数岗位页需要登录或有反爬，可以直接复制整页文字或「查看源代码」后的 HTML 粘贴到上面，再点「从粘贴抽取」。</div></div></div>';
    }
  } catch (err) {
    msg.innerHTML = '<div class="callout warn">' + icon('alert') + '<div><b>' + esc(err.message) + '</b><div class="small muted" style="margin-top:4px">自动抓取失败时，请粘贴岗位页全文或 HTML，再点「从粘贴抽取」。</div></div></div>';
  }
}
