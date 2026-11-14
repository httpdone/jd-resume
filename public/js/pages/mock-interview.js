import { icon, esc, el, $, $$, toast, confirmDialog, md, fmtTime, scoreRing } from '../ui.js';
import { get, post, put, del } from '../api.js';
import { runAgent } from '../agent.js';
import { llmNotice, ensureSettings, state } from '../store.js';
import { thinkingBox, streamHandlers, jdSelectHtml, jdById, loadJds } from './shared.js';

const TYPES = [{ id: 'tech', name: '技术一面', desc: '架构、数字口径、排障与技术选型' }, { id: 'project', name: '项目深挖', desc: '分工边界、决策、复盘与贡献' }, { id: 'hr', name: 'HR 面', desc: '动机、到岗、协作与自我介绍' }];
const hasSpeech = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

export async function render(view, [id]) {
  await ensureSettings();
  if (id === 'wrong') return renderWrong(view);
  if (id) return renderSession(view, id);
  return renderHome(view);
}

async function renderHome(view) {
  const [list, resumes, apps, jds] = await Promise.all([get('/api/interviews'), get('/api/resumes'), get('/api/apps'), loadJds(true)]);
  view.innerHTML = `<div class="page"><div class="page-head"><div><h1>模拟面试</h1><p>选一份简历和目标 JD，Agent 扮演面试官多轮一问一答；结束后给复盘打分。薄弱题会进入错题本，可以重练。</p></div>
    <div class="actions"><a class="btn" href="#/mock/wrong">${icon('flag')}错题本（${list.wrong.length}）</a></div></div>
    ${llmNotice(state.settings)}
    <div class="card card-pad">
      <div class="sec-title" style="margin-top:0">${icon('speech')}开始一场新面试</div>
      <div class="mi-setup">
        <div class="field"><label>简历</label><select class="input" name="resume">${resumes.items.map((r) => '<option value="' + esc(r.slug) + '">' + esc(r.slug) + '</option>').join('')}</select></div>
        <div class="field"><label>关联投递（可选，会带上公司和岗位）</label><select class="input" name="app"><option value="">不关联</option>${apps.items.map((a) => '<option value="' + a.id + '">' + esc(a.company + ' · ' + (a.role || '') + ' · ' + a.status) + '</option>').join('')}</select></div>
        <div class="field"><label>目标 JD（可选）</label><div id="jd-box"></div></div>
        <div class="field"><label>轮数</label><input class="input" name="rounds" type="number" min="3" max="12" value="6"></div>
      </div>
      <div class="grid g3" style="margin-top:14px" id="types">${TYPES.map((t) => '<div class="opt-card' + (t.id === 'tech' ? ' active' : '') + '" data-t="' + t.id + '"><b>' + t.name + '</b><span>' + t.desc + '</span></div>').join('')}</div>
      <div class="row" style="margin-top:16px"><button class="btn primary" id="start">${icon('sparkles')}开始模拟面试</button></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>${icon('history')}历史会话</h3></div><div class="card-body">
      ${list.sessions.length ? '<table class="table"><thead><tr><th>时间</th><th>类型</th><th>简历</th><th>岗位</th><th>进度</th><th></th></tr></thead><tbody>' + list.sessions.map((s) => '<tr data-id="' + s.id + '"><td>' + fmtTime(s.updatedAt) + '</td><td>' + esc(s.typeName) + '</td><td>' + esc(s.resumeSlug) + '</td><td>' + esc([s.company, s.role].filter(Boolean).join(' · ')) + '</td><td>' + (s.status === 'done' ? '<span class="badge ok">已复盘 ' + (s.score ?? '') + '</span>' : '<span class="badge">' + s.turns + '/' + s.rounds + '</span>') + '</td><td><button class="btn xs soft" data-a="open">继续</button> <button class="btn xs ghost danger" data-a="del">删除</button></td></tr>').join('') + '</tbody></table>' : '<div class="empty">' + icon('speech') + '<p class="small">还没有模拟面试记录。</p></div>'}
    </div></div></div>`;
  const jdBox = $('#jd-box');
  jdBox.innerHTML = await jdSelectHtml('jd', '');
  let typ = 'tech';
  $$('#types [data-t]').forEach((c) => c.onclick = () => { typ = c.dataset.t; $$('#types [data-t]').forEach((x) => x.classList.toggle('active', x === c)); });
  view.querySelector('[name=app]').onchange = (e) => {
    const a = apps.items.find((x) => x.id === e.target.value);
    if (a?.jdId) { const sel = jdBox.querySelector('select'); if (sel) sel.value = a.jdId; }
    if (a?.resumeSlug) view.querySelector('[name=resume]').value = a.resumeSlug;
  };
  $('#start').onclick = async () => {
    const resumeSlug = view.querySelector('[name=resume]').value;
    if (!resumeSlug) return toast('请先有一份简历', 'warn');
    const appId = view.querySelector('[name=app]').value;
    const app = apps.items.find((x) => x.id === appId);
    const jdId = jdBox.querySelector('select')?.value || '';
    const jd = jdId ? jds.find((j) => j.id === jdId) : null;
    const r = await post('/api/interviews', { resumeSlug, type: typ, rounds: +view.querySelector('[name=rounds]').value, appId, jdId, company: app?.company || jd?.company || '', role: app?.role || jd?.role || '' });
    location.hash = '#/mock/' + r.item.id;
  };
  view.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'del') { e.stopPropagation(); if (!(await confirmDialog('删除这场模拟面试？', { ok: '删除', danger: true }))) return; await del('/api/interviews/' + tr.dataset.id); renderHome(view); return; }
    location.hash = '#/mock/' + tr.dataset.id;
  });
}

async function renderSession(view, id) {
  const sess = (await get('/api/interviews/' + id)).item;
  const resume = await get('/api/resumes/' + encodeURIComponent(sess.resumeSlug));
  // lightweight payload from text extraction on server? We'll send items via a simple parse later; for now send html-stripped isn't available. Use resume.html length... Agent needs resume.text. Fetch preview? Easier: call a tiny client parse by loading iframe is heavy.
  // We'll build a rough text from resume? The editor ResumeDoc isn't loaded. Send { text: '（见条目）', name } is weak.
  // Use hidden iframe? Slow. Instead include html and let backend? Prompts use resume.text.
  // I'll get items by injecting a DOMParser on the body html.
  const parsed = parseResumeText(resume.html, resume.slug);
  const jd = sess.jdId ? await jdById(sess.jdId) : null;
  const stories = (await get('/api/stories')).items.filter((s) => !s.sourceSlug || s.sourceSlug === sess.resumeSlug).slice(0, 20);

  view.innerHTML = `<div class="page" style="max-width:900px"><div class="page-head"><div><a class="btn xs ghost" href="#/mock">${icon('left')}全部会话</a>
    <h1 style="margin-top:8px">${esc((TYPES.find((t) => t.id === sess.type) || {}).name || '')} · ${esc(sess.resumeSlug)}</h1>
    <p>${esc([sess.company, sess.role].filter(Boolean).join(' · ') || '未绑定岗位')} · 计划 ${sess.rounds} 轮</p></div>
    <div class="actions">${sess.status === 'done' ? '<button class="btn" id="again">' + icon('refresh') + '基于复盘再开一场</button>' : '<button class="btn" id="finish">' + icon('flag') + '结束并复盘</button>'}</div></div>
    ${llmNotice(state.settings)}
    <div id="log" class="mi-chat"></div>
    <div id="review"></div>
    ${sess.status === 'done' ? '' : `<div class="mi-input"><textarea class="input grow" id="ans" rows="3" placeholder="回答这一题… Enter 发送，Shift+Enter 换行"></textarea>${hasSpeech ? '<button class="btn icon" id="mic" title="语音输入">' + icon('mic') + '</button>' : ''}<button class="btn primary" id="send">${icon('send')}发送</button></div>`}
    </div>`;

  const drawLog = () => {
    $('#log').innerHTML = (sess.messages || []).map((m) => '<div class="mi-turn ' + (m.role === 'user' ? 'me' : '') + '"><div class="av">' + (m.role === 'user' ? '我' : '面') + '</div><div class="bubble">' + (m.role === 'user' ? esc(m.content).replace(/\n/g, '<br>') : md(m.content)) + (m.tip ? '<div class="tiny" style="margin-top:6px">提示：' + esc(m.tip) + '</div>' : '') + '</div></div>').join('')
      || '<div class="empty">' + icon('speech') + '<p class="small">点击下方发送，或直接按「发送」让面试官先开口。</p></div>';
    $('#log').scrollTop = 99999;
  };
  const drawReview = () => {
    const r = sess.review;
    if (!r) { $('#review').innerHTML = ''; return; }
    $('#review').innerHTML = `<div class="card card-pad" style="margin-top:18px">
      <div class="row" style="align-items:center;gap:18px">${scoreRing(r.score || 0, r.level || '')}<div class="grow"><b>${esc(r.summary || '')}</b></div></div>
      <div class="grid g2" style="margin-top:12px">${(r.dimensions || []).map((d) => '<div class="dim"><div class="row"><span>' + esc(d.name) + '</span><b>' + d.score + '</b></div><div class="bar"><i style="width:' + d.score + '%"></i></div><p>' + esc(d.comment || '') + '</p></div>').join('')}</div>
      ${(r.turns || []).map((t) => '<div class="qa" style="margin-top:10px"><div class="q">' + (t.weak ? '<span class="badge warn">薄弱</span>' : '<span class="badge ok">尚可</span>') + '<span>' + esc(t.question) + '</span></div><div class="w">' + esc(t.comment || '') + '</div>' + (t.reference ? '<div class="small">参考答法：' + markSafe(t.reference) + '</div>' : '') + (t.weak ? '<div style="margin-top:6px"><button class="btn xs soft" data-wrong="' + esc(t.question) + '">' + icon('flag') + '加入错题本</button></div>' : '') + '</div>').join('')}
      ${(r.next || []).length ? '<div class="sec-title">接下来准备</div><ul class="small">' + r.next.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : ''}
    </div>`;
    $('#review').querySelectorAll('[data-wrong]').forEach((b) => b.onclick = async () => {
      const t = (r.turns || []).find((x) => x.question === b.dataset.wrong);
      await post('/api/interviews/_wrong', { question: t.question, comment: t.comment, reference: t.reference, type: sess.type, sessionId: sess.id, resumeSlug: sess.resumeSlug });
      toast('已加入错题本');
    });
  };
  drawLog(); drawReview();

  const payloadBase = { resume: parsed, jd, stories, interviewType: sess.type, rounds: sess.rounds };

  async function ask(action, userText) {
    if (userText) sess.messages.push({ role: 'user', content: userText });
    const box = el('<div>' + thinkingBox('面试官正在想下一问…') + '</div>');
    $('#log').appendChild(box);
    try {
      const r = await runAgent({ task: 'mock_interview', action, messages: sess.messages, turn: sess.messages.filter((m) => m.role === 'assistant').length, ...payloadBase }, { ...streamHandlers(box) });
      const d = r.data || {};
      if (d.question) sess.messages.push({ role: 'assistant', content: d.question, tip: d.tip, why: d.why });
      await put('/api/interviews/' + sess.id, { messages: sess.messages, status: d.done ? 'active' : 'active' });
      drawLog();
      if (d.done) await finish();
    } catch (e) { box.innerHTML = '<div class="callout warn">' + icon('alert') + '<div>' + esc(e.message) + '</div></div>'; }
  }

  async function finish() {
    const box = el('<div>' + thinkingBox('正在复盘整场面试…') + '</div>');
    $('#log').appendChild(box);
    try {
      const r = await runAgent({ task: 'mock_interview', action: 'review', messages: sess.messages, ...payloadBase }, { ...streamHandlers(box) });
      sess.review = r.data; sess.status = 'done';
      await put('/api/interviews/' + sess.id, { messages: sess.messages, review: sess.review, status: 'done' });
      for (const q of (sess.review.weak || [])) {
        const t = (sess.review.turns || []).find((x) => x.question === q);
        try { await post('/api/interviews/_wrong', { question: q, comment: t?.comment, reference: t?.reference, type: sess.type, sessionId: sess.id, resumeSlug: sess.resumeSlug }); } catch { /* 忽略重复 */ }
      }
      box.remove();
      drawLog(); drawReview();
      $('.mi-input')?.remove();
      toast('复盘完成，薄弱题已记入错题本');
    } catch (e) { box.innerHTML = '<div class="callout warn">' + icon('alert') + '<div>' + esc(e.message) + '</div></div>'; }
  }

  if (!(sess.messages || []).length) ask('start');
  $('#send')?.addEventListener('click', () => { const v = $('#ans').value.trim(); if (!v) return; $('#ans').value = ''; ask('reply', v); });
  $('#ans')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#send').click(); } });
  $('#finish')?.addEventListener('click', finish);
  $('#again')?.addEventListener('click', async () => {
    const r = await post('/api/interviews', { resumeSlug: sess.resumeSlug, type: sess.type, rounds: sess.rounds, jdId: sess.jdId, appId: sess.appId, company: sess.company, role: sess.role });
    location.hash = '#/mock/' + r.item.id;
  });
  if (hasSpeech && $('#mic')) bindMic($('#mic'), $('#ans'));
}

function markSafe(s) { return esc(s).replace(/【待补充[：:][^】]*】/g, (m) => '<span class="todo-mark">' + m + '</span>'); }

function bindMic(btn, input) {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new Rec(); rec.lang = 'zh-CN'; rec.continuous = false; rec.interimResults = true;
  let on = false;
  rec.onresult = (e) => {
    let t = '';
    for (const r of e.results) t += r[0].transcript;
    input.value = (input.value + (input.value && !input.value.endsWith(' ') ? ' ' : '') + t).trim();
  };
  rec.onend = () => { on = false; btn.classList.remove('primary'); };
  rec.onerror = () => toast('语音识别没成功，请改用键盘', 'warn');
  btn.onclick = () => { if (on) { rec.stop(); return; } try { rec.start(); on = true; btn.classList.add('primary'); } catch { toast('无法启动语音识别', 'warn'); } };
}

async function renderWrong(view) {
  const data = await get('/api/interviews/_wrong');
  view.innerHTML = `<div class="page"><div class="page-head"><div><a class="btn xs ghost" href="#/mock">${icon('left')}模拟面试</a><h1 style="margin-top:8px">错题本</h1><p>复盘里标记为薄弱的问题会自动出现在这里，可以针对某一题再开一场练习。</p></div></div>
    ${data.items.length ? data.items.map((w) => '<div class="card card-pad" style="margin-bottom:12px"><div class="row"><span class="badge">' + esc((TYPES.find((t) => t.id === w.type) || {}).name || w.type) + '</span><span class="muted small" style="margin-left:auto">练过 ' + w.times + ' 次 · ' + fmtTime(w.lastAt) + '</span></div><div style="font-weight:600;margin:8px 0">' + esc(w.question) + '</div>' + (w.comment ? '<div class="small">' + esc(w.comment) + '</div>' : '') + (w.reference ? '<div class="small muted">参考：' + esc(w.reference) + '</div>' : '') + '<div class="row" style="margin-top:8px"><span class="tiny">' + esc(w.resumeSlug || '') + '</span><span class="grow"></span><button class="btn xs ghost danger" data-del="' + w.id + '">移除</button></div></div>').join('') : '<div class="empty">' + icon('flag') + '<p class="small">还没有错题。完成一场模拟面试并复盘后，薄弱题会出现在这里。</p></div>'}
  </div>`;
  view.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { await del('/api/interviews/_wrong/' + b.dataset.del); renderWrong(view); });
}

function parseResumeText(html, name) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.querySelector('.content-scroll') || doc.body;
  const items = [];
  for (const it of root.querySelectorAll('.section-item-container')) {
    const content = it.querySelector('.menu-content');
    const title = [...it.querySelectorAll('.menu-title')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ｜ ');
    const mod = it.closest('.option')?.id || '';
    items.push({ id: it.id, module: mod, moduleTitle: mod, title, html: content ? content.innerHTML.trim() : '', text: (content?.textContent || '').replace(/\s+/g, ' ').trim(), editable: Boolean(content) });
  }
  let text = '# ' + (name || '') + '\n';
  for (const it of items) text += '\n### [' + it.id + '] ' + it.title + '\n' + it.text + '\n';
  return { name, text, items };
}
