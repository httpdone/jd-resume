import { icon, esc, el, $, $$, toast, modal, confirmDialog, fmtTime, markTodos } from '../ui.js';
import { get, post, put, del } from '../api.js';
import { runAgent } from '../agent.js';
import { llmNotice, ensureSettings, state } from '../store.js';
import { thinkingBox, streamHandlers } from './shared.js';
import { lintBullets } from '../bullet-lint.js';
import { sanitizeHtml } from '../resume-dom.js';

const TYPE_NAME = { internship: '实习', project: '项目', research: '科研', competition: '竞赛', org: '组织/社团', award: '奖项', other: '其他' };

export async function render(view, [id]) {
  await ensureSettings();
  const data = await get('/api/stories');
  const resumes = (await get('/api/resumes')).items;
  if (id && id !== 'new') return renderEdit(view, data.items.find((s) => s.id === id), data, resumes);
  if (id === 'new') return renderEdit(view, null, data, resumes);
  renderList(view, data, resumes);
}

function renderList(view, data, resumes) {
  const items = data.items || [];
  view.innerHTML = `<div class="page"><div class="page-head"><div><h1>经历素材库</h1><p>把项目 / 实习的完整 STAR（背景、任务、行动、结果、数据、证据）存在这里。JD 适配和改写会把它当作证据来源，仍然不会编造。</p></div>
    <div class="actions"><button class="btn" id="imp">${icon('download')}从简历导入</button><a class="btn primary" href="#/stories/new">${icon('plus')}新建经历</a></div></div>
    ${llmNotice(state.settings)}
    <div class="row" style="margin-bottom:14px;gap:8px;flex-wrap:wrap"><input class="input sm" id="q" placeholder="搜索标题 / 技术 / 标签" style="width:240px">${['', ...Object.keys(TYPE_NAME)].map((t) => '<button class="btn xs ' + (t ? 'ghost' : 'soft') + '" data-t="' + t + '">' + (t ? TYPE_NAME[t] : '全部') + '</button>').join('')}<label class="small muted" style="display:flex;gap:4px;align-items:center;margin-left:8px"><input type="checkbox" id="st-all">全选</label><button class="btn xs ghost danger" id="st-batch" style="display:none"></button><span class="muted small" style="margin-left:auto">${items.length} 条</span></div>
    <div class="story-grid" id="grid"></div></div>`;
  const selected = new Set();
  const syncBatch = () => {
    const btn = $('#st-batch');
    btn.style.display = selected.size ? '' : 'none';
    btn.innerHTML = icon('trash') + '批量删除' + (selected.size ? '（' + selected.size + '）' : '');
    const boxes = [...view.querySelectorAll('#grid [data-check]')];
    const on = boxes.filter((c) => c.checked).length;
    const all = $('#st-all');
    all.checked = boxes.length > 0 && on === boxes.length;
    all.indeterminate = on > 0 && on < boxes.length;
  };
  const draw = () => {
    const q = ($('#q')?.value || '').trim().toLowerCase();
    const typ = view.querySelector('[data-t].soft, [data-t].primary')?.dataset.t || view.querySelector('.btn.soft[data-t]')?.dataset.t;
    const active = [...view.querySelectorAll('[data-t]')].find((b) => b.classList.contains('soft'))?.dataset.t || '';
    const list = items.filter((s) => {
      if (active && s.type !== active) return false;
      const bag = [s.title, s.org, s.role, s.action, s.result, ...(s.stack || []), ...(s.tags || [])].join(' ').toLowerCase();
      return !q || bag.includes(q);
    });
    $('#grid').innerHTML = list.map((s) => `<div class="card story-card" data-id="${s.id}">
      <div class="row"><label class="story-check" onclick="event.stopPropagation()"><input type="checkbox" data-check></label><span class="badge info">${esc(TYPE_NAME[s.type] || s.type)}</span><span class="muted small" style="margin-left:auto">${esc([s.start, s.end].filter(Boolean).join(' – '))}</span></div>
      <h4>${esc(s.title || '未命名')}</h4>
      <div class="small muted">${esc([s.org, s.role].filter(Boolean).join(' · '))}</div>
      <div class="star">${s.background ? '<div><b>背景</b>' + esc(s.background).slice(0, 80) + '</div>' : ''}${s.result ? '<div><b>结果</b>' + esc(s.result).slice(0, 80) + '</div>' : ''}</div>
      <div class="chip-row">${(s.stack || []).slice(0, 6).map((t) => '<span class="chip">' + esc(t) + '</span>').join('')}${(s.tags || []).slice(0, 4).map((t) => '<span class="chip">' + esc(t) + '</span>').join('')}</div>
      <div class="tiny">${s.sourceSlug ? '来自简历「' + esc(s.sourceSlug) + '」' : ''} · ${fmtTime(s.updatedAt || s.createdAt)}</div>
    </div>`).join('') || '<div class="empty" style="grid-column:1/-1">' + icon('book') + '<h4>还没有素材</h4><p class="small">从已有简历导入，或新建一条，再用 Agent 追问把事实补全。</p></div>';
    $$('#grid [data-id]').forEach((c) => c.onclick = () => location.hash = '#/stories/' + c.dataset.id);
    $$('#grid [data-check]').forEach((c) => { c.checked = selected.has(c.closest('[data-id]').dataset.id); });
    syncBatch();
  };
  $$('[data-t]').forEach((b) => b.onclick = () => { $$('[data-t]').forEach((x) => { x.classList.remove('soft'); x.classList.add('ghost'); }); b.classList.remove('ghost'); b.classList.add('soft'); draw(); });
  $('#q').oninput = draw;
  $('#grid').onchange = (e) => {
    const c = e.target.closest('[data-check]');
    if (!c) return;
    const id = c.closest('[data-id]').dataset.id;
    if (c.checked) selected.add(id); else selected.delete(id);
    syncBatch();
  };
  $('#st-all').onchange = (e) => {
    const on = e.target.checked;
    for (const c of view.querySelectorAll('#grid [data-check]')) {
      c.checked = on;
      const id = c.closest('[data-id]').dataset.id;
      if (on) selected.add(id); else selected.delete(id);
    }
    syncBatch();
  };
  $('#st-batch').onclick = () => deleteStoriesFlow([...selected], () => render(view, []));
  draw();
  $('#imp').onclick = () => importDialog(resumes, () => render(view, []));
}

function importDialog(resumes, onDone) {
  const body = el('<div><div class="field"><label>从哪份简历导入条目</label><select class="input" name="slug">' + resumes.map((r) => '<option value="' + esc(r.slug) + '">' + esc(r.slug) + '</option>').join('') + '</select></div><p class="muted small">只会导入实习 / 项目 / 组织 / 研究 / 奖项中尚未导入过的条目（按条目 id 去重）。导入后再用 Agent 深挖补全 STAR。</p></div>');
  modal({
    title: '从简历导入', body, width: 480,
    actions: [
      { label: '取消' },
      { label: '开始导入', cls: 'primary', onClick: async () => {
        const slug = body.querySelector('[name=slug]').value;
        const r = await post('/api/stories/_import', { slug });
        toast('导入 ' + r.added + ' 条' + (r.skipped ? '，跳过 ' + r.skipped + ' 条已存在' : ''));
        onDone?.();
      } },
    ],
  });
}

async function deleteStoriesFlow(ids, onDone) {
  ids = [...new Set(ids.filter(Boolean))];
  if (!ids.length) return;
  if (!(await confirmDialog('删除选中的 ' + ids.length + ' 条素材？不会改已经写进简历的内容，删除后可在几秒内撤销。', { ok: '删除', danger: true }))) return;
  try {
    const r = await post('/api/stories/_batch', { ids });
    const snapshots = r.deleted || [];
    toast('已删除 ' + snapshots.length + ' 条素材', 'ok', 8000, {
      label: '撤销',
      onClick: async () => {
        try { await post('/api/stories/_restore', { snapshots }); toast('已撤销删除'); onDone?.(); }
        catch (err) { toast(err.message, 'err'); }
      },
    });
    onDone?.();
  } catch (err) { toast(err.message, 'err'); }
}

function field(name, label, value, tag = 'input', extra = '') {
  return '<div class="field"><label>' + label + '</label><' + tag + ' class="input" name="' + name + '"' + (tag === 'input' ? ' value="' + esc(value || '') + '"' : '') + ' ' + extra + '>' + (tag === 'textarea' ? esc(value || '') + '</textarea>' : '') + (tag === 'input' ? '' : '') + '</div>';
}

async function renderEdit(view, story, data, resumes) {
  const s = story || { type: 'project', metrics: [], stack: [], tags: [], evidence: [] };
  view.innerHTML = `<div class="page" style="max-width:1100px"><div class="page-head"><div><a class="btn xs ghost" href="#/stories">${icon('left')}返回</a><h1 style="margin-top:8px">${s.id ? '编辑经历' : '新建经历'}</h1></div>
    <div class="actions">${s.id ? '<button class="btn ghost danger" id="del">' + icon('trash') + '删除</button>' : ''}<button class="btn" id="write">${icon('wand')}写成简历条目</button><button class="btn primary" id="save">${icon('save')}保存</button></div></div>
    ${llmNotice(state.settings)}
    <div class="grid g2">
      <div class="card card-pad">
        <div class="cols"><div class="field"><label>类型</label><select class="input" name="type">${Object.entries(TYPE_NAME).map(([k, v]) => '<option value="' + k + '"' + (s.type === k ? ' selected' : '') + '>' + v + '</option>').join('')}</select></div>${field('title', '标题', s.title, 'input', 'placeholder="如：园区访客智助系统")')}</div>
        <div class="cols">${field('org', '组织 / 公司', s.org)}${field('role', '角色', s.role)}</div>
        <div class="cols">${field('start', '开始', s.start, 'input', 'placeholder="2024-06"')}${field('end', '结束', s.end, 'input', 'placeholder="至今或 2025-01"')}${field('location', '地点', s.location)}</div>
        ${field('background', '背景（面向谁、要解决什么）', s.background, 'textarea', 'rows="3"')}
        ${field('task', '任务（你负责什么、成功标准）', s.task, 'textarea', 'rows="3"')}
        ${field('action', '行动（怎么做的、关键决策与难点）', s.action, 'textarea', 'rows="5"')}
        ${field('result', '结果（可验证的产出）', s.result, 'textarea', 'rows="3"')}
        <div class="field"><label>数据（逗号分隔）</label><input class="input" name="metrics" value="${esc((s.metrics || []).join('，'))}" placeholder="如：18 张表，12 线峰值"></div>
        <div class="field"><label>技术栈（逗号分隔）</label><input class="input" name="stack" value="${esc((s.stack || []).join('，'))}"></div>
        <div class="field"><label>标签</label><input class="input" name="tags" value="${esc((s.tags || []).join('，'))}" placeholder="如：RAG, 后端, 实习"></div>
        <div class="field"><label>证据链接（每行：说明 | URL）</label><textarea class="input" name="evidence" rows="3">${esc((s.evidence || []).map((e) => [e.label, e.url, e.note].filter(Boolean).join(' | ')).join('\n'))}</textarea></div>
      </div>
      <div>
        <div class="card card-pad">
          <div class="sec-title" style="margin-top:0">${icon('chat')}Agent 引导式深挖</div>
          <p class="muted small">Agent 一次问 1-2 个问题，只补事实。你的回答会合并进左侧字段，不会凭空写数字。</p>
          <div id="probe-log"></div>
          <div id="probe-q"></div>
          <div class="row" style="margin-top:10px"><textarea class="input grow" id="probe-a" rows="3" placeholder="用事实回答，没有数据就直说没有"></textarea></div>
          <div class="row" style="margin-top:8px"><button class="btn primary" id="probe">${icon('sparkles')}${s.id ? '开始 / 继续追问' : '请先保存再追问'}</button></div>
        </div>
        <div id="write-out" style="margin-top:14px"></div>
      </div>
    </div></div>`;

  const collect = () => {
    const g = (n) => view.querySelector('[name=' + n + ']').value.trim();
    const split = (s) => s.split(/[,，、;；]/).map((x) => x.trim()).filter(Boolean);
    const ev = g('evidence').split('\n').map((line) => {
      const [label, url, note] = line.split('|').map((x) => (x || '').trim());
      return { label, url, note };
    }).filter((e) => e.label || e.url);
    return { type: g('type'), title: g('title'), org: g('org'), role: g('role'), start: g('start'), end: g('end'), location: g('location'), background: g('background'), task: g('task'), action: g('action'), result: g('result'), metrics: split(g('metrics')), stack: split(g('stack')), tags: split(g('tags')), evidence: ev, sourceSlug: s.sourceSlug, sourceItemId: s.sourceItemId };
  };

  const applyUpdated = (u) => {
    if (!u) return;
    for (const k of ['background', 'task', 'action', 'result']) if (u[k]) view.querySelector('[name=' + k + ']').value = u[k];
    if (Array.isArray(u.metrics) && u.metrics.length) view.querySelector('[name=metrics]').value = u.metrics.join('，');
    if (Array.isArray(u.stack) && u.stack.length) view.querySelector('[name=stack]').value = u.stack.join('，');
    if (Array.isArray(u.tags) && u.tags.length) view.querySelector('[name=tags]').value = u.tags.join('，');
  };

  const save = async () => {
    const body = collect();
    if (!body.title) { toast('请填写标题', 'warn'); return null; }
    const r = s.id ? await put('/api/stories/' + s.id, body) : await post('/api/stories', body);
    Object.assign(s, r.item);
    toast('已保存');
    if (!story) history.replaceState(null, '', '#/stories/' + s.id);
    return r.item;
  };

  $('#save').onclick = () => save().catch((e) => toast(e.message, 'err'));
  $('#del')?.addEventListener('click', async () => {
    if (!(await confirmDialog('删除这条素材？不会改已经写进简历的内容。', { ok: '删除', danger: true }))) return;
    await del('/api/stories/' + s.id); toast('已删除'); location.hash = '#/stories';
  });

  let abort;
  $('#probe').onclick = async () => {
    if (!s.id) { const saved = await save(); if (!saved) return; }
    const box = $('#probe-q');
    const answer = $('#probe-a').value.trim();
    if (answer) $('#probe-log').insertAdjacentHTML('beforeend', '<div class="mi-turn me"><div class="av">我</div><div class="bubble small">' + esc(answer) + '</div></div>');
    box.innerHTML = thinkingBox('正在想下一问…');
    abort?.abort(); abort = new AbortController();
    try {
      const r = await runAgent({ task: 'story_probe', story: collect(), answer }, { ...streamHandlers(box), signal: abort.signal });
      const d = r.data || {};
      applyUpdated(d.updated);
      $('#probe-a').value = '';
      box.innerHTML = (d.coach ? '<p class="small">' + esc(d.coach) + '</p>' : '') + (d.questions || []).map((q) => '<div class="callout" style="margin-top:8px">' + icon('question') + '<div><b>' + esc(q.ask) + '</b><div class="tiny">想补：' + esc(q.aim || '') + '</div></div></div>').join('') + (d.done ? '<p class="muted small">可以先保存，再用「写成简历条目」放到某份简历里。</p>' : '');
      await save();
    } catch (e) { box.innerHTML = '<div class="callout warn">' + icon('alert') + '<div>' + esc(e.message) + '</div></div>'; }
  };

  $('#write').onclick = async () => {
    if (!s.id) { const saved = await save(); if (!saved) return; }
    const out = $('#write-out');
    out.innerHTML = thinkingBox('正在写成简历条目…');
    try {
      const r = await runAgent({ task: 'story_write', story: collect(), style: 'star' }, { ...streamHandlers(out) });
      const html = sanitizeHtml(r.data?.html || '');
      const lint = lintBullets(html, { sources: JSON.stringify(collect()) });
      out.innerHTML = '<div class="card card-pad"><div class="sec-title" style="margin-top:0">可写入简历的正文</div><div class="small" style="border:1px solid var(--border);border-radius:10px;padding:10px">' + html + '</div><p class="tiny">' + esc(r.data?.reason || '') + '</p>' + (lint.length ? '<p class="small">成稿检查：' + lint.map((l) => '<span class="badge ' + (l.level === 'warn' ? 'warn' : '') + '">' + esc(l.text) + '</span>').join(' ') + '</p>' : '') + '<p class="muted small">复制后到编辑器里粘贴到对应条目（会自动去格式；或在 JD 适配时勾选这条素材写入定制版）。</p><button class="btn sm" id="copy-html">复制 HTML</button></div>';
      out.querySelector('#copy-html').onclick = () => navigator.clipboard.writeText(html).then(() => toast('已复制'));
    } catch (e) { out.innerHTML = '<div class="callout warn">' + icon('alert') + '<div>' + esc(e.message) + '</div></div>'; }
  };
}
