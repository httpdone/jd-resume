import { icon, esc, $, ymd, today, fmtTime } from '../ui.js';
import { get, put } from '../api.js';
import { computeStats, editApp } from './apps.js';
import { newResumeDialog } from './resumes.js';
import { ensureSettings } from '../store.js';

const WD = ['日', '一', '二', '三', '四', '五', '六'];

export async function render(view) {
  const s = await ensureSettings();
  const days = s?.remindAfterDays || 7;
  const [apps, res, jds, rem] = await Promise.all([get('/api/apps'), get('/api/resumes'), get('/api/jds'), get('/api/apps/_reminders?days=' + days)]);
  const st = computeStats(apps);
  const t = today();
  const in7 = ymd(Date.now() + 7 * 864e5);
  const upcoming = apps.items.flatMap((a) => (a.events || []).filter((e) => e.date >= t && e.date <= in7 && !e.done).map((e) => ({ a, e }))).sort((x, y) => (x.e.date + (x.e.time || '')).localeCompare(y.e.date + (y.e.time || '')));
  const h = new Date().getHours();
  const hello = h < 6 ? '夜深了' : h < 12 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
  const counts = {};
  for (const a of apps.items) if (a.appliedAt) counts[a.appliedAt] = (counts[a.appliedAt] || 0) + 1;
  const start = new Date(); start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); start.setDate(start.getDate() - 7 * 19);
  const cells = [];
  for (let d = new Date(start); d <= new Date(); d.setDate(d.getDate() + 1)) { const k = ymd(d); const n = counts[k] || 0; cells.push('<i title="' + k + '：' + n + ' 次投递" data-l="' + (n >= 6 ? 4 : n >= 4 ? 3 : n >= 2 ? 2 : n >= 1 ? 1 : 0) + '"></i>'); }
  const recent = [...res.items].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 5);

  view.innerHTML = `<div class="page">
  <div class="hero"><div><h2>${hello}，今天也离 Offer 更近一步 👋</h2><p>${upcoming.length ? '未来 7 天有 <b>' + upcoming.length + '</b> 场笔试/面试，' : ''}已投递 <b>${st.applied}</b> 家，<b>${st.active}</b> 家在推进中。</p></div>
  <div class="quick"><button class="btn" id="q-new">${icon('plus')}新建简历</button><a class="btn" href="#/jd/new">${icon('target')}JD 适配</a><button class="btn primary" id="q-app">${icon('briefcase')}记录投递</button></div></div>
  ${!s?.ready && !s?.mock ? '<div class="callout warn">' + icon('key') + '<div><b>还没有连接大模型</b>：AI 诊断、改写和 JD 适配需要一个 OpenAI 兼容接口（DeepSeek / 通义千问 / Kimi / 智谱等）。<a href="#/settings">去设置 →</a>　也可以先打开「演示模式」体验完整流程。</div></div>' : ''}
  <div class="grid g4">
    <div class="card stat"><div class="ico">${icon('file')}</div><div class="label">简历版本</div><div class="value">${res.items.length}</div><div class="sub">${res.items.filter((r) => r.target).length} 份按 JD 定制</div></div>
    <div class="card stat"><div class="ico">${icon('briefcase')}</div><div class="label">累计投递</div><div class="value">${st.applied}</div><div class="sub">近 7 天 ${st.thisWeek} 家</div></div>
    <div class="card stat"><div class="ico">${icon('chat')}</div><div class="label">面试转化</div><div class="value">${st.rate}%</div><div class="sub">${st.interview} 家进入面试</div></div>
    <div class="card stat"><div class="ico">${icon('trophy')}</div><div class="label">Offer</div><div class="value">${st.offer}</div><div class="sub">继续加油</div></div>
  </div>
  ${remindersHtml(rem, days)}
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><div class="card-head"><h3>${icon('calendar')}未来 7 天日程</h3><div class="row" style="gap:6px"><a class="btn xs ghost" href="/api/apps/_ics">${icon('download')}导出全部日程</a><a class="btn xs ghost" href="#/apps">查看日历</a></div></div><div class="card-body">${upcoming.length ? upcoming.slice(0, 6).map(({ a, e }) => '<div class="list-row" data-app="' + a.id + '" style="cursor:pointer"><div class="when"><b>' + (+e.date.slice(8)) + '</b><span>周' + WD[new Date(e.date + 'T00:00').getDay()] + (e.date === t ? ' · 今天' : '') + '</span></div><div style="min-width:0;flex:1"><div style="font-weight:600">' + esc(e.type) + (e.time ? ' <span class="muted small">' + e.time + '</span>' : '') + '</div><div class="small muted">' + esc(a.company) + (a.role ? ' · ' + esc(a.role) : '') + (e.note ? ' · ' + esc(e.note) : '') + '</div></div></div>').join('') : '<div class="empty" style="padding:26px 0">' + icon('calendar') + '<p class="small">最近没有安排。收到笔试/面试邀请后，在投递记录里加上时间。</p></div>'}</div></div>
    <div class="card"><div class="card-head"><h3>${icon('file')}最近编辑的简历</h3><a class="btn xs ghost" href="#/resumes">全部</a></div><div class="card-body">${recent.map((r) => '<a class="list-row" href="#/editor/' + encodeURIComponent(r.slug) + '" style="color:inherit"><div class="when" style="width:40px;padding:8px 0">' + icon('file2') + '</div><div style="min-width:0;flex:1"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.slug) + '</div><div class="small muted">' + r.pages + ' 页 · ' + fmtTime(r.updatedAt) + (r.target ? ' · <span style="color:var(--primary)">' + esc([r.target.company, r.target.role].filter(Boolean).join(' · ')) + '</span>' : '') + '</div></div>' + icon('right') + '</a>').join('')}</div></div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><div class="card-head"><h3>${icon('flame')}投递热力图 <span class="small muted" style="font-weight:400">近 20 周</span></h3></div><div class="card-body"><div class="heatmap">${cells.join('')}</div><div class="small muted" style="margin-top:6px">保持稳定的投递节奏比集中海投更有效。</div></div></div>
    <div class="card"><div class="card-head"><h3>${icon('target')}最近的 JD 适配</h3><a class="btn xs ghost" href="#/jd">全部</a></div><div class="card-body">${jds.items.slice(0, 4).map((j) => '<a class="list-row" href="#/jd/' + j.id + '" style="color:inherit"><div style="flex:1;min-width:0"><div style="font-weight:600">' + esc(j.company || '未填公司') + ' · ' + esc(j.role || '') + '</div><div class="small muted">' + (j.tailoredSlug ? '定制版：' + esc(j.tailoredSlug) : j.analysis ? '已解析' : '草稿') + '</div></div>' + (j.match ? '<span class="badge ' + (j.match.score >= 75 ? 'ok' : j.match.score >= 60 ? 'info' : 'warn') + '">匹配 ' + j.match.score + '</span>' : '') + '</a>').join('') || '<div class="empty" style="padding:26px 0">' + icon('target') + '<p class="small">粘贴一个 JD，一键生成定制版简历。</p><a class="btn sm soft" href="#/jd/new">开始</a></div>'}</div></div>
  </div></div>`;
  $('#q-new').onclick = async () => { const slug = await newResumeDialog(); if (slug) location.hash = '#/editor/' + encodeURIComponent(slug); };
  $('#q-app').onclick = () => editApp(null, { appliedAt: t, status: '已投递' }, () => render(view));
  view.querySelectorAll('[data-app]').forEach((r) => r.onclick = () => editApp(apps.items.find((a) => a.id === r.dataset.app), {}, () => render(view)));
  $('#btn-notify')?.addEventListener('click', () => enableNotify(s));
  maybeNotify(s, rem);
}

function remindersHtml(rem, days) {
  const up = rem?.upcoming || [];
  const silent = rem?.silent || [];
  if (!up.length && !silent.length) {
    return '<div class="card card-pad" style="margin-top:16px"><div class="row">' + icon('bell') + '<div class="grow"><b>投递提醒</b><div class="small muted">未来两周暂无笔试/面试；也没有超过 ' + days + ' 天还没有回音的投递。天数可在「设置」里改。</div></div><button class="btn sm ghost" id="btn-notify">开启浏览器通知</button></div></div>';
  }
  return '<div class="grid g2" style="margin-top:16px">'
    + '<div class="card remind-list"><div class="card-head"><h3>' + icon('bell') + '即将到来</h3><button class="btn xs ghost" id="btn-notify">浏览器通知</button></div><div class="card-body">'
    + (up.length ? up.slice(0, 6).map((e) => '<div class="list-row" data-app="' + e.appId + '" style="cursor:pointer"><div class="when"><b>' + (+e.date.slice(8)) + '</b><span>' + e.date.slice(5, 7) + '月</span></div><div class="grow"><div style="font-weight:600">' + esc(e.type) + (e.time ? ' · ' + e.time : '') + '</div><div class="small muted">' + esc(e.company) + (e.role ? ' · ' + esc(e.role) : '') + '</div></div></div>').join('') : '<p class="muted small">未来两周没有安排。</p>')
    + '</div></div>'
    + '<div class="card remind-list"><div class="card-head"><h3>' + icon('alert') + '超过 ' + days + ' 天无回音</h3><a class="btn xs ghost" href="#/apps">去跟进</a></div><div class="card-body">'
    + (silent.length ? silent.slice(0, 6).map((e) => '<div class="list-row" data-app="' + e.appId + '" style="cursor:pointer"><div class="days">' + e.days + '天</div><div class="grow"><div style="font-weight:600">' + esc(e.company) + '</div><div class="small muted">' + esc(e.role || '') + ' · ' + esc(e.status) + ' · 投于 ' + e.appliedAt + '</div></div></div>').join('') : '<p class="muted small">没有超期未回音的投递。</p>')
    + '</div></div></div>';
}

async function enableNotify(s) {
  if (!('Notification' in window)) return alert('当前浏览器不支持通知');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return;
  await put('/api/settings', { notifyEnabled: true });
  if (s) s.notifyEnabled = true;
  try { const n = new Notification('简历工作台', { body: '已开启投递提醒。笔试/面试当天和超期无回音时会通知（需保持工作台打开）。' }); setTimeout(() => n.close(), 5000); } catch { /* 忽略 */ }
}

function maybeNotify(s, rem) {
  if (!s?.notifyEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  const todayStr = new Date().toISOString().slice(0, 10);
  const seen = JSON.parse(localStorage.getItem('rp-notify-seen') || '{}');
  const mark = (key, title, body) => {
    if (seen[key] === todayStr) return;
    seen[key] = todayStr;
    try { new Notification(title, { body }); } catch { /* 忽略 */ }
  };
  for (const e of rem?.upcoming || []) {
    if (e.date === todayStr) mark('up-' + e.appId + e.date + e.type, e.type + ' · ' + e.company, (e.time ? e.time + ' ' : '') + (e.role || ''));
  }
  for (const e of rem?.silent || []) mark('si-' + e.appId, '超过 ' + e.days + ' 天无回音 · ' + e.company, (e.role || '') + ' · 投于 ' + e.appliedAt);
  localStorage.setItem('rp-notify-seen', JSON.stringify(seen));
}
