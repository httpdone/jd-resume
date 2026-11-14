import { icon, esc, el, $, $$, toast, modal, confirmDialog, ymd, today, fmtTime } from '../ui.js';
import { get, post, put, del } from '../api.js';
import { loadJds, thinkingBox, streamHandlers } from './shared.js';
import { runAgent } from '../agent.js';
import { llmNotice, ensureSettings, state } from '../store.js';

const CHANNELS = ['官网', 'Boss直聘', '牛客', '实习僧', '内推', 'LinkedIn', '拉勾', '猎聘', '邮件投递', '校园宣讲', '其他'];
const WD = ['一', '二', '三', '四', '五', '六', '日'];
let A = null;

export async function render(view, [sub]) {
  A = { view: sub || localStorage.getItem('rp-apps-view') || 'calendar', month: new Date(), q: '', status: '', data: null, resumes: [], jds: [] };
  A.month.setDate(1);
  view.innerHTML = `<div class="page" style="max-width:1500px"><div class="page-head"><div><h1>投递管理</h1><p>记录每一次投递、笔试和面试；日历看节奏，看板推进度，统计看转化。</p></div>
  <div class="actions"><input class="input" id="q" placeholder="搜索公司 / 岗位" style="width:200px"><div class="btn-group" id="views"><button data-v="calendar">${icon('calendar')}日历</button><button data-v="kanban">${icon('kanban')}看板</button><button data-v="list">${icon('list')}列表</button><button data-v="stats">${icon('chart')}统计</button></div><a class="btn" href="/api/apps/_ics">${icon('download')}导出全部日程</a><button class="btn primary" id="add">${icon('plus')}新增投递</button></div></div><div id="apps-body"></div></div>`;
  $('#add').onclick = () => editApp(null);
  $('#q').oninput = (e) => { A.q = e.target.value.trim().toLowerCase(); draw(); };
  $$('#views button').forEach((b) => b.onclick = () => { A.view = b.dataset.v; localStorage.setItem('rp-apps-view', A.view); draw(); });
  await reload();
}

async function reload() {
  const [data, res, jds] = await Promise.all([get('/api/apps'), get('/api/resumes'), loadJds(true)]);
  A.data = data; A.resumes = res.items; A.jds = jds;
  draw();
}

const statusOf = (name) => A.data.statuses.find((s) => s.name === name) || { name, color: '#64748b', stage: 'active' };
function filtered() {
  return A.data.items.filter((a) => !A.q || (a.company + ' ' + (a.role || '')).toLowerCase().includes(A.q));
}

function draw() {
  $$('#views button').forEach((b) => b.classList.toggle('active', b.dataset.v === A.view));
  const body = $('#apps-body');
  if (!body) return;
  const fn = ({ calendar: drawCalendar, kanban: drawKanban, list: drawList, stats: drawStats })[A.view];
  return fn(body);
}

// 一天里的事件：投递 + 自定义事件 + 截止日期
function eventsByDay(items) {
  const map = {};
  const add = (d, e) => { if (d) (map[d] ||= []).push(e); };
  for (const a of items) {
    const st = statusOf(a.status);
    if (a.appliedAt) add(a.appliedAt, { app: a, type: '投递', color: st.color, label: a.company + (a.role ? ' · ' + a.role : ''), kind: 'apply' });
    if (a.deadline) add(a.deadline, { app: a, type: '截止', color: '#ef4444', label: '截止 ' + a.company, kind: 'deadline' });
    for (const e of a.events || []) add(e.date, { app: a, ev: e, type: e.type, color: /面/.test(e.type) ? '#06b6d4' : /笔试|测评/.test(e.type) ? '#8b5cf6' : /Offer/i.test(e.type) ? '#22c55e' : '#f59e0b', label: (e.time ? e.time + ' ' : '') + e.type + ' · ' + a.company, kind: /面/.test(e.type) ? 'interview' : 'event', done: e.done });
  }
  for (const k in map) map[k].sort((x, y) => (x.ev?.time || '99').localeCompare(y.ev?.time || '99'));
  return map;
}

function drawCalendar(body) {
  const items = filtered();
  const map = eventsByDay(items);
  const y = A.month.getFullYear(), m = A.month.getMonth();
  const first = new Date(y, m, 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const days = [];
  for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d); }
  const weeks = days[35].getMonth() !== m ? 5 : 6;
  const t = today();
  const monthItems = items.filter((a) => (a.appliedAt || '').startsWith(ymd(first).slice(0, 7)));
  const upcoming = Object.entries(map).filter(([d]) => d >= t).sort(([a], [b]) => a.localeCompare(b)).flatMap(([d, evs]) => evs.filter((e) => e.kind !== 'apply' && !e.done).map((e) => ({ d, e }))).slice(0, 12);
  body.innerHTML = `<div style="display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px;align-items:start">
  <div class="card cal"><div class="cal-head"><button class="btn sm ghost icon" data-m="-1">${icon('left')}</button><h3>${y} 年 ${m + 1} 月</h3><button class="btn sm ghost icon" data-m="1">${icon('right')}</button><button class="btn sm ghost" data-m="0">今天</button><span class="grow" style="flex:1"></span><span class="small muted">本月投递 <b style="color:var(--text)">${monthItems.length}</b> 家 · 点击日期快速添加</span></div>
  <div class="cal-grid">${WD.map((w) => '<div class="cal-wd">周' + w + '</div>').join('')}${days.slice(0, weeks * 7).map((d) => {
    const k = ymd(d);
    const evs = map[k] || [];
    return '<div class="cal-day' + (d.getMonth() !== m ? ' other' : '') + (k === t ? ' today' : '') + '" data-day="' + k + '"><div class="d"><span>' + d.getDate() + '</span></div>' + evs.slice(0, 4).map((e) => '<div class="ev ' + e.kind + (e.done ? ' done' : '') + '" data-app="' + e.app.id + '" title="' + esc(e.label) + '"><span class="dot" style="background:' + e.color + '"></span>' + esc(e.label) + '</div>').join('') + (evs.length > 4 ? '<div class="more">+' + (evs.length - 4) + ' 项</div>' : '') + '</div>';
  }).join('')}</div></div>
  <div class="card"><div class="card-head"><h3>${icon('flame')}接下来的日程</h3></div><div class="card-body">${upcoming.length ? upcoming.map(({ d, e }) => '<div class="list-row" data-app="' + e.app.id + '" style="cursor:pointer"><div class="when"><b>' + (+d.slice(8)) + '</b><span>' + (+d.slice(5, 7)) + '月 周' + WD[(new Date(d + 'T00:00').getDay() + 6) % 7] + '</span></div><div style="min-width:0"><div style="font-weight:600;font-size:13px"><span class="dot" style="background:' + e.color + ';margin-right:6px"></span>' + esc(e.type) + (e.ev?.time ? ' · ' + e.ev.time : '') + '</div><div class="small muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(e.app.company) + (e.app.role ? ' · ' + esc(e.app.role) : '') + '</div></div></div>').join('') : '<div class="empty" style="padding:20px 0">' + icon('calendar') + '<p class="small">暂无日程。在投递记录里添加笔试/面试时间，会显示在这里和日历上。</p></div>'}
  <hr class="sep"><div class="small muted">图例</div><div style="display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:6px" class="small">${A.data.statuses.map((s) => '<span><span class="dot" style="background:' + s.color + '"></span> ' + esc(s.name) + '</span>').join('')}<span><span class="dot" style="background:#06b6d4"></span> 面试</span><span><span class="dot" style="background:#8b5cf6"></span> 笔试</span></div></div></div></div>`;
  body.onclick = (e) => {
    const mb = e.target.closest('[data-m]');
    if (mb) { const v = +mb.dataset.m; if (v === 0) { A.month = new Date(); A.month.setDate(1); } else A.month.setMonth(A.month.getMonth() + v); return draw(); }
    const ev = e.target.closest('[data-app]');
    if (ev) return editApp(A.data.items.find((a) => a.id === ev.dataset.app));
    const day = e.target.closest('[data-day]');
    if (day) editApp(null, { appliedAt: day.dataset.day, status: day.dataset.day <= t ? '已投递' : A.data.statuses[0].name });
  };
}

function cardHtml(a) {
  const evs = (a.events || []).filter((e) => e.date >= today() && !e.done).sort((x, y) => x.date.localeCompare(y.date));
  return '<div class="kcard" draggable="true" data-id="' + a.id + '"><b>' + (a.priority ? '⭐ ' : '') + esc(a.company) + '</b><div class="r">' + esc(a.role || '') + '</div><div class="f">' + (a.appliedAt ? '<span>' + icon('calendar').replace('<svg', '<svg style="width:12px;height:12px"') + ' ' + a.appliedAt.slice(5) + '</span>' : '') + (a.channel ? '<span class="badge">' + esc(a.channel) + '</span>' : '') + (evs[0] ? '<span class="badge info">' + esc(evs[0].type) + ' ' + evs[0].date.slice(5) + '</span>' : '') + (a.resumeSlug ? '<span title="使用的简历">' + icon('file').replace('<svg', '<svg style="width:12px;height:12px"') + ' ' + esc(a.resumeSlug.slice(0, 14)) + '</span>' : '') + '</div></div>';
}

function drawKanban(body) {
  const items = filtered();
  body.innerHTML = '<div class="kanban">' + A.data.statuses.map((s) => {
    const its = items.filter((a) => a.status === s.name).sort((x, y) => (y.updatedAt || '').localeCompare(x.updatedAt || ''));
    return '<div class="kcol"><div class="kcol-head"><span class="dot" style="background:' + s.color + '"></span>' + esc(s.name) + '<span class="n">' + its.length + '</span></div><div class="kcol-body" data-status="' + esc(s.name) + '">' + its.map(cardHtml).join('') + '</div></div>';
  }).join('') + '</div><div class="small muted">拖动卡片即可更新状态；点击卡片编辑详情。</div>';
  let dragId = null;
  body.querySelectorAll('.kcard').forEach((c) => {
    c.addEventListener('dragstart', (e) => { dragId = c.dataset.id; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
    c.addEventListener('dragend', () => c.classList.remove('dragging'));
    c.addEventListener('click', () => editApp(A.data.items.find((a) => a.id === c.dataset.id)));
  });
  body.querySelectorAll('.kcol').forEach((wrap) => {
    const col = wrap.querySelector('.kcol-body');
    wrap.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
    wrap.addEventListener('dragleave', (e) => { if (!wrap.contains(e.relatedTarget)) col.classList.remove('over'); });
    wrap.addEventListener('drop', async (e) => {
      e.preventDefault(); col.classList.remove('over');
      const id = dragId || e.dataTransfer.getData('text/plain');
      const a = A.data.items.find((x) => x.id === id);
      if (!a || a.status === col.dataset.status) return;
      try { await put('/api/apps/' + id, { status: col.dataset.status }); toast(a.company + ' → ' + col.dataset.status); await reload(); } catch (err) { toast(err.message, 'err'); }
    });
  });
}

function drawList(body) {
  const items = filtered().filter((a) => !A.status || a.status === A.status).sort((x, y) => (y.appliedAt || y.createdAt || '').localeCompare(x.appliedAt || x.createdAt || ''));
  body.innerHTML = `<div class="card"><div class="card-head" style="padding-bottom:12px"><div class="row"><select class="input sm" id="st" style="width:150px"><option value="">全部状态</option>${A.data.statuses.map((s) => '<option' + (A.status === s.name ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('')}</select><span class="small muted">${items.length} 条记录</span></div></div>
  <div style="overflow:auto"><table class="table"><thead><tr><th>公司</th><th>岗位</th><th>状态</th><th>投递日期</th><th>渠道</th><th>使用简历</th><th>下一步</th><th>更新</th></tr></thead><tbody>${items.map((a) => {
    const s = statusOf(a.status);
    const next = (a.events || []).filter((e) => e.date >= today() && !e.done).sort((x, y) => x.date.localeCompare(y.date))[0];
    return '<tr data-id="' + a.id + '"><td><b>' + (a.priority ? '⭐ ' : '') + esc(a.company) + '</b></td><td>' + esc(a.role || '') + '</td><td><span class="badge" style="background:' + s.color + '22;color:' + s.color + '"><span class="dot" style="background:' + s.color + '"></span>' + esc(a.status) + '</span></td><td>' + (a.appliedAt || '<span class="muted">—</span>') + '</td><td>' + esc(a.channel || '') + '</td><td class="small">' + (a.resumeSlug ? '<a href="#/editor/' + encodeURIComponent(a.resumeSlug) + '" data-stop>' + esc(a.resumeSlug) + '</a>' : '') + '</td><td class="small">' + (next ? esc(next.type) + ' ' + next.date.slice(5) + (next.time ? ' ' + next.time : '') : '') + '</td><td class="small muted">' + fmtTime(a.updatedAt) + '</td></tr>';
  }).join('') || '<tr><td colspan="8"><div class="empty">' + icon('briefcase') + '<h4>还没有投递记录</h4><p class="small">点右上角「新增投递」，或在 JD 适配里生成定制版时自动创建。</p></div></td></tr>'}</tbody></table></div></div>`;
  body.querySelector('#st').onchange = (e) => { A.status = e.target.value; draw(); };
  body.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', (e) => { if (e.target.closest('[data-stop]')) return; editApp(A.data.items.find((a) => a.id === tr.dataset.id)); }));
}

export function computeStats(data) {
  const items = data.items;
  const stageOf = (name) => (data.statuses.find((s) => s.name === name) || {}).stage || 'active';
  const reached = (a, pred) => (a.history || [{ status: a.status }]).some((h) => pred(h.status)) || pred(a.status);
  const applied = items.filter((a) => reached(a, (s) => stageOf(s) !== 'todo') || a.appliedAt);
  const written = applied.filter((a) => reached(a, (s) => /笔试|测评/.test(s)) || (a.events || []).some((e) => /笔试|测评/.test(e.type)));
  const interview = applied.filter((a) => reached(a, (s) => ['interview', 'offer'].includes(stageOf(s))) || (a.events || []).some((e) => /面/.test(e.type)));
  const offer = applied.filter((a) => reached(a, (s) => stageOf(s) === 'offer'));
  const active = items.filter((a) => ['active', 'interview'].includes(stageOf(a.status)));
  const weekAgo = ymd(Date.now() - 6 * 864e5);
  const thisWeek = items.filter((a) => a.appliedAt && a.appliedAt >= weekAgo).length;
  return { total: items.length, applied: applied.length, written: written.length, interview: interview.length, offer: offer.length, active: active.length, thisWeek, rate: applied.length ? Math.round(100 * interview.length / applied.length) : 0 };
}

async function drawStats(body) {
  const data = A.data;
  const st = computeStats(data);
  const byStatus = data.statuses.map((s) => ({ ...s, n: data.items.filter((a) => a.status === s.name).length }));
  const maxS = Math.max(1, ...byStatus.map((s) => s.n));
  const channels = {};
  for (const a of data.items) channels[a.channel || '未填'] = (channels[a.channel || '未填'] || 0) + 1;
  const chList = Object.entries(channels).sort((a, b) => b[1] - a[1]);
  const maxC = Math.max(1, ...chList.map((c) => c[1]));
  const weeks = [];
  for (let i = 11; i >= 0; i--) {
    const end = new Date(); end.setDate(end.getDate() - i * 7);
    const startD = new Date(end); startD.setDate(end.getDate() - 6);
    const s0 = ymd(startD), e = ymd(end);
    weeks.push({ label: s0.slice(5), n: data.items.filter((a) => a.appliedAt && a.appliedAt >= s0 && a.appliedAt <= e).length });
  }
  const maxW = Math.max(1, ...weeks.map((w) => w.n));
  const funnel = [['投递', st.applied], ['笔试/测评', st.written], ['面试', st.interview], ['Offer', st.offer]];
  body.innerHTML = `<div class="grid g4">
    <div class="card stat"><div class="ico">${icon('briefcase')}</div><div class="label">累计投递</div><div class="value">${st.applied}</div><div class="sub">记录 ${st.total} 条 · 近 7 天 ${st.thisWeek}</div></div>
    <div class="card stat"><div class="ico">${icon('flame')}</div><div class="label">进行中</div><div class="value">${st.active}</div><div class="sub">已投递 / 笔试 / 面试中</div></div>
    <div class="card stat"><div class="ico">${icon('chat')}</div><div class="label">面试转化率</div><div class="value">${st.rate}%</div><div class="sub">${st.interview} 家进入面试</div></div>
    <div class="card stat"><div class="ico">${icon('trophy')}</div><div class="label">Offer</div><div class="value">${st.offer}</div><div class="sub">${st.applied ? Math.round(100 * st.offer / st.applied) : 0}% 投递→Offer</div></div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><div class="card-head"><h3>${icon('chart')}转化漏斗</h3></div><div class="card-body">${funnel.map(([n, v], i) => '<div class="funnel-row"><span>' + n + '</span><div class="bar"><i style="width:' + (st.applied ? Math.max(3, 100 * v / st.applied) : 0) + '%;opacity:' + (1 - i * 0.15) + '"></i></div><span class="small">' + v + (i ? ' · ' + (st.applied ? Math.round(100 * v / st.applied) : 0) + '%' : '') + '</span></div>').join('')}<div class="small muted">按历史状态统计：曾经到达过该阶段即计入（含后来被拒的）；百分比 = 占已投递总数。</div></div></div>
    <div class="card"><div class="card-head"><h3>${icon('layers')}当前状态分布</h3></div><div class="card-body">${byStatus.map((s) => '<div class="funnel-row"><span><span class="dot" style="background:' + s.color + '"></span> ' + esc(s.name) + '</span><div class="bar" style="height:14px"><i style="width:' + (100 * s.n / maxS) + '%;background:' + s.color + '"></i></div><span class="small">' + s.n + '</span></div>').join('')}</div></div>
    <div class="card"><div class="card-head"><h3>${icon('calendar')}近 12 周投递</h3></div><div class="card-body"><div style="display:flex;align-items:flex-end;gap:6px;height:150px">${weeks.map((w) => '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end"><span class="small muted">' + (w.n || '') + '</span><div style="width:100%;border-radius:6px 6px 2px 2px;background:linear-gradient(180deg,var(--primary-2),var(--primary));height:' + (100 * w.n / maxW) + '%;min-height:' + (w.n ? 4 : 2) + 'px;opacity:' + (w.n ? 1 : .25) + '"></div><span style="font-size:10.5px" class="muted">' + w.label + '</span></div>').join('')}</div></div></div>
    <div class="card"><div class="card-head"><h3>${icon('link')}投递渠道</h3></div><div class="card-body">${chList.map(([c, n]) => '<div class="funnel-row"><span>' + esc(c) + '</span><div class="bar" style="height:14px"><i style="width:' + (100 * n / maxC) + '%"></i></div><span class="small">' + n + '</span></div>').join('') || '<p class="muted small">暂无数据</p>'}</div></div>
  </div>
  <div id="insights" style="margin-top:16px"><div class="muted small">正在计算复盘数据…</div></div>`;
  try {
    const ins = await get('/api/apps/_insights');
    renderInsights(body.querySelector('#insights'), ins);
  } catch (err) {
    const el0 = body.querySelector('#insights');
    if (el0) el0.innerHTML = '<div class="callout warn">' + esc(err.message) + '</div>';
  }
}

function rateCell(r) {
  return '<td>' + r.applied + '</td><td>' + r.replyRate + '%' + (r.unreliable ? '<span class="muted">*</span>' : '') + '</td><td>' + r.interviewRate + '%</td><td>' + (r.avgReplyDays == null ? '—' : r.avgReplyDays) + '</td>';
}

function insightTable(title, rows) {
  if (!rows?.length) return '<p class="muted small">暂无数据</p>';
  return '<table class="insight-table"><thead><tr><th>' + title + '</th><th>已投</th><th>回复率</th><th>进面率</th><th>平均回复天数</th></tr></thead><tbody>'
    + rows.map((r) => '<tr><td>' + esc(r.name) + '</td>' + rateCell(r) + '</tr>').join('') + '</tbody></table>';
}

function renderInsights(host, ins) {
  if (!host) return;
  const warn = ins.unreliable || ins.note
    ? '<div class="callout warn" style="margin-bottom:14px">' + icon('alert') + '<div>' + esc(ins.note || '样本量较小，比例仅供参考。') + '</div></div>'
    : '';
  const f = ins.funnel || {};
  const applied = f.applied || 0;
  const funnel2 = [['已投递', f.applied || 0], ['有回复', f.replied || 0], ['进面', f.interview || 0], ['Offer', f.offer || 0]];
  host.innerHTML = warn + `
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h3>${icon('flag')}投递复盘漏斗</h3><span class="muted small">回复 / 进面 / Offer</span></div>
    <div class="card-body">${funnel2.map(([n, v], i) => '<div class="funnel-row"><span>' + n + '</span><div class="bar"><i style="width:' + (applied ? Math.max(3, 100 * v / applied) : 0) + '%;opacity:' + (1 - i * 0.15) + '"></i></div><span class="small">' + v + (i && applied ? ' · ' + Math.round(100 * v / applied) + '%' : '') + '</span></div>').join('')}
    <div class="small muted">回复指状态已离开「待投递/已投递」，或已有笔试/面试/拒绝记录。平均回复天数只统计已产生回复的记录。</div></div></div>
    <div class="grid g2">
      <div class="card"><div class="card-head"><h3>按岗位类型</h3></div><div class="card-body">${insightTable('岗位类型', ins.byRoleType)}</div></div>
      <div class="card"><div class="card-head"><h3>按渠道</h3></div><div class="card-body">${insightTable('渠道', ins.byChannel)}</div></div>
      <div class="card"><div class="card-head"><h3>按简历版本</h3></div><div class="card-body">${insightTable('简历', ins.byResume)}</div></div>
      <div class="card"><div class="card-head"><h3>按公司类型</h3></div><div class="card-body">${insightTable('公司类型', ins.byCompanyType)}</div></div>
    </div>
    <div class="card card-pad" style="margin-top:16px">
      <div class="row"><div class="grow"><b>${icon('sparkles')}投递策略建议</b><div class="small muted">基于上面的统计，由 Agent 给出下一步该把精力放在哪。样本少时会明确说明结论不可靠。</div></div>
      <button class="btn sm primary" id="btn-strategy">${icon('sparkles')}生成建议</button></div>
      <div id="strategy-out" style="margin-top:12px"></div>
    </div>`;
  host.querySelector('#btn-strategy').onclick = () => runStrategy(host.querySelector('#strategy-out'), ins);
}

async function runStrategy(out, ins) {
  await ensureSettings();
  out.innerHTML = thinkingBox('正在根据投递数据给出策略建议…');
  try {
    const r = await runAgent({ task: 'strategy', insights: ins }, streamHandlers(out));
    const d = r.data || {};
    out.innerHTML = (d.unreliable || ins.unreliable ? '<div class="callout warn">' + icon('alert') + '<div>' + esc(d.headline || '样本量较小，以下只是观察，不是结论。') + '</div></div>' : '<div class="callout">' + icon('sparkles') + '<div>' + esc(d.headline || '') + '</div></div>')
      + ((d.findings || []).length ? '<div class="sec-title">观察</div><ul class="small" style="padding-left:18px">' + d.findings.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '')
      + ((d.actions || []).length ? '<div class="sec-title">建议行动</div><ul class="small" style="padding-left:18px">' + d.actions.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '')
      + ((d.watch || []).length ? '<div class="small muted" style="margin-top:8px">留意：' + d.watch.map(esc).join('；') + '</div>' : '');
  } catch (err) {
    out.innerHTML = '<div class="callout warn">' + esc(err.message) + '</div>';
  }
}


// ---------- 新增 / 编辑 ----------
export async function editApp(app, defaults = {}, onSaved) {
  if (!A?.data) { A = A || {}; A.data = await get('/api/apps'); A.resumes = (await get('/api/resumes')).items; A.jds = await loadJds(true); }
  const isNew = !app;
  const a = app ? JSON.parse(JSON.stringify(app)) : { company: '', role: '', status: A.data.statuses[0].name, appliedAt: '', events: [], ...defaults };
  const body = el(`<div>
    <div class="cols"><div class="field"><label>公司 *</label><input class="input" name="company" placeholder="如：字节跳动"></div><div class="field"><label>岗位</label><input class="input" name="role" placeholder="如：后端开发实习生"></div></div>
    <div class="cols"><div class="field"><label>状态</label><select class="input" name="status">${A.data.statuses.map((s) => '<option>' + esc(s.name) + '</option>').join('')}</select></div><div class="field"><label>投递日期</label><input class="input" type="date" name="appliedAt"></div></div>
    <div class="cols"><div class="field"><label>渠道</label><input class="input" name="channel" list="ch-list" placeholder="官网 / Boss直聘 / 内推…"><datalist id="ch-list">${CHANNELS.map((c) => '<option value="' + c + '">').join('')}</datalist></div><div class="field"><label>使用的简历版本</label><select class="input" name="resumeSlug"><option value="">未指定</option>${A.resumes.map((r) => '<option value="' + esc(r.slug) + '">' + esc(r.slug) + '</option>').join('')}</select></div></div>
    <div class="cols"><div class="field"><label>工作地点</label><input class="input" name="location"></div><div class="field"><label>薪资 / 日薪</label><input class="input" name="salary" placeholder="如：300/天"></div></div>
    <div class="cols"><div class="field"><label>岗位链接</label><input class="input" name="link" placeholder="https://"></div><div class="field"><label>投递截止</label><input class="input" type="date" name="deadline"></div></div>
    <div class="cols"><div class="field"><label>关联 JD</label><select class="input" name="jdId"><option value="">无</option>${A.jds.map((j) => '<option value="' + j.id + '">' + esc([j.company, j.role].filter(Boolean).join(' · ')) + '</option>').join('')}</select></div><div class="field"><label>联系人 / 内推人</label><input class="input" name="contact"></div></div>
    <div class="field"><label>备注</label><textarea class="input" name="notes" rows="2" placeholder="面经、沟通记录、注意事项…"></textarea></div>
    <label class="check" style="margin-bottom:12px"><input type="checkbox" name="priority">⭐ 重点关注</label>
    <div class="sec-title" style="margin-top:4px">${icon('calendar')}日程（笔试、面试等，会显示在日历上）<button class="btn xs soft" style="margin-left:auto" id="add-ev">${icon('plus')}添加</button></div>
    <div id="evs"></div>
    ${!isNew && (a.history || []).length ? '<div class="sec-title">' + icon('history') + '状态变化</div><div class="small muted">' + a.history.map((h) => esc(h.status) + ' <span style="opacity:.7">(' + new Date(h.at).toLocaleDateString('zh-CN') + ')</span>').join(' → ') + '</div>' : ''}
  </div>`);
  for (const k of ['company', 'role', 'status', 'appliedAt', 'channel', 'resumeSlug', 'location', 'salary', 'link', 'deadline', 'jdId', 'contact', 'notes']) { const f = body.querySelector('[name=' + k + ']'); if (f && a[k]) f.value = a[k]; }
  body.querySelector('[name=priority]').checked = Boolean(a.priority);
  const evBox = body.querySelector('#evs');
  const types = A.data.eventTypes || ['笔试', '一面', '二面', 'HR面', '其他'];
  const drawEvs = () => {
    evBox.innerHTML = a.events.length ? a.events.map((e, i) => '<div class="ev-row" data-i="' + i + '"><select class="input sm" data-k="type">' + types.map((t) => '<option' + (t === e.type ? ' selected' : '') + '>' + t + '</option>').join('') + '</select><input class="input sm" type="date" data-k="date" value="' + esc(e.date) + '"><input class="input sm" type="time" data-k="time" value="' + esc(e.time || '') + '"><input class="input sm" data-k="note" placeholder="备注（会议链接/地点）" value="' + esc(e.note || '') + '">' + (app && e.date ? '<a class="btn xs ghost icon" href="/api/apps/' + app.id + '/ics?event=' + encodeURIComponent(e.id || (app.id + '-' + (e.date || '') + '-' + (e.type || ''))) + '" title="导出此事件" download>' + icon('download') + '</a>' : '') + '<button class="btn xs ghost icon danger" data-del title="删除">' + icon('trash') + '</button></div>').join('') : '<div class="small muted" style="margin-bottom:8px">还没有日程</div>';
  };
  drawEvs();
  evBox.oninput = (e) => { const row = e.target.closest('[data-i]'); if (row && e.target.dataset.k) a.events[+row.dataset.i][e.target.dataset.k] = e.target.value; };
  evBox.onclick = (e) => { if (e.target.closest('[data-del]')) { a.events.splice(+e.target.closest('[data-i]').dataset.i, 1); drawEvs(); } };
  body.querySelector('#add-ev').onclick = () => { const st = body.querySelector('[name=status]').value; a.events.push({ id: 'ev-' + Date.now().toString(36), type: /面/.test(st) ? st.replace('/终面', '').replace('三面', '三面') : '一面', date: today(), time: '14:00', note: '' }); drawEvs(); };
  const actions = [];
  if (!isNew) {
    actions.push({ label: '导出日程', icon: 'download', onClick: () => { location.href = '/api/apps/' + a.id + '/ics'; return false; } });
    actions.push({ label: '删除', cls: 'danger left', icon: 'trash', onClick: async () => { if (!(await confirmDialog('删除「' + a.company + '」的投递记录？', { ok: '删除', danger: true }))) return false; await del('/api/apps/' + a.id); toast('已删除'); await afterSave(); } });
  }
  actions.push({ label: '取消' });
  actions.push({ label: isNew ? '添加' : '保存', cls: 'primary', onClick: async () => {
    const payload = { events: a.events.filter((e) => e.date).map((e) => ({ ...e, id: e.id || ('ev-' + Math.random().toString(36).slice(2, 10)) })) };
    for (const k of ['company', 'role', 'status', 'appliedAt', 'channel', 'resumeSlug', 'location', 'salary', 'link', 'deadline', 'jdId', 'contact', 'notes']) payload[k] = body.querySelector('[name=' + k + ']').value;
    payload.priority = body.querySelector('[name=priority]').checked;
    if (!payload.company.trim()) { toast('请填写公司', 'warn'); return false; }
    if (isNew) await post('/api/apps', payload); else await put('/api/apps/' + a.id, payload);
    toast(isNew ? '已添加' : '已保存');
    await afterSave();
  } });
  async function afterSave() { if (onSaved) await onSaved(); else if ($('#apps-body')) await reload(); }
  modal({ title: isNew ? '新增投递' : '编辑投递 · ' + a.company, body, width: 680, actions });
}
