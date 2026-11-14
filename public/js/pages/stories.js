import { icon, esc, el, $, $$, toast, modal, confirmDialog, fmtTime, markTodos } from '../ui.js';
import { get, post, put, del } from '../api.js';
import { runAgent } from '../agent.js';
import { llmNotice, ensureSettings, state } from '../store.js';
import { thinkingBox, streamHandlers } from './shared.js';
import { lintBullets } from '../bullet-lint.js';
import { sanitizeHtml } from '../resume-dom.js';

const DRAFT_KEY = 'rp-story-draft';
const TYPE_NAME = { internship: '实习', project: '项目', research: '科研', competition: '竞赛', org: '组织/社团', award: '奖项', other: '其他' };

export async function render(view, [id]) {
  await ensureSettings();
  const data = await get('/api/stories');
  const resumes = (await get('/api/resumes')).items;
  if (id && id !== 'new') return renderEdit(view, data.items.find((s) => s.id === id), data, resumes);
  if (id === 'new') {
    // 「从本机项目生成」→「先在编辑页修改」会把草稿放在 sessionStorage 里带过来（只用一次）
    let draft = null;
    try { draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch { /* 忽略 */ }
    sessionStorage.removeItem(DRAFT_KEY);
    return renderEdit(view, null, data, resumes, draft);
  }
  renderList(view, data, resumes);
}

function renderList(view, data, resumes) {
  const items = data.items || [];
  view.innerHTML = `<div class="page"><div class="page-head"><div><h1>经历素材库</h1><p>把项目 / 实习的完整 STAR（背景、任务、行动、结果、数据、证据）存在这里。JD 适配和改写会把它当作证据来源，仍然不会编造。</p></div>
    <div class="actions"><button class="btn" id="imp">${icon('download')}从简历导入</button><button class="btn" id="proj">${icon('layers')}从本机项目生成</button><a class="btn primary" href="#/stories/new">${icon('plus')}新建经历</a></div></div>
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
  $('#proj').onclick = () => projectDialog();
}

// ---------- 从本机项目生成 ----------
const fmtN = (n) => Number(n || 0).toLocaleString('zh-CN');

function scanSummaryHtml(sm) {
  const g = sm.git;
  const a = g && g.author;
  const rows = [
    ['项目', esc(sm.name) + ' <span class="tiny">' + esc(sm.root) + '</span>'],
    ['技术', (sm.stack || []).map((t) => '<span class="chip">' + esc(t) + '</span>').join('') || '<span class="muted">未识别</span>'],
    ['代码', (sm.langs || []).slice(0, 6).map((l) => esc(l.lang) + ' ' + fmtN(l.files) + ' 个文件 / ' + fmtN(l.loc) + ' 行').join('；') || '<span class="muted">没有识别到源码</span>'],
    ['规模', fmtN(sm.fileCount) + ' 个文件' + (sm.walkTruncated ? '（已达上限，后面的没统计）' : '') + (sm.modules?.length ? '，顶层模块 ' + sm.modules.length + ' 个' : '') + (sm.routes ? '，接口路由约 ' + sm.routes + ' 处' : '') + (sm.usedGitIgnore ? '，已按 .gitignore 过滤' : '')],
    ['Git', !g ? '<span class="muted">不是 Git 仓库，或本机没装 git</span>' : !g.commits ? '还没有提交' : '共 ' + fmtN(g.commits) + ' 次提交，' + g.contributors + ' 位参与者，' + esc(g.first) + ' ~ ' + esc(g.last)
      + (a && a.commits != null ? '<br>按作者「' + esc([a.name, a.email].filter(Boolean).join(' / ')) + '」' + (a.auto ? '（取自该仓库 git config）' : '') + '筛选：本人提交 ' + fmtN(a.commits) + ' 次' + (a.commits ? '，' + esc(a.first) + ' ~ ' + esc(a.last) : '') : '<br><span class="muted">没有作者信息，不区分本人提交</span>')],
  ];
  const sent = (sm.sent || []).map((f) => '<tr><td>' + esc(f.kind) + '</td><td style="word-break:break-all">' + esc(f.file) + '</td><td style="text-align:right">' + fmtN(f.chars) + '</td></tr>').join('');
  return '<div class="card card-pad" style="margin-top:12px"><table class="small" style="width:100%;border-collapse:collapse">' + rows.map(([k, v]) => '<tr><td class="muted" style="width:56px;vertical-align:top;padding:4px 0">' + k + '</td><td style="padding:4px 0">' + v + '</td></tr>').join('') + '</table>'
    + '<div class="sec-title">将发送给模型的内容 <span class="tiny" style="margin-left:6px">共 ' + fmtN(sm.totalChars) + ' 字符，上限 ' + fmtN(sm.budget) + '</span></div>'
    + '<div style="max-height:180px;overflow:auto;border:1px solid var(--border);border-radius:10px"><table class="small" style="width:100%;border-collapse:collapse">' + sent + '</table></div>'
    + '<p class="tiny" style="margin-top:8px">已跳过依赖、构建产物、二进制和锁文件内容；密钥类文件（.env、*.pem、*.key、credentials 等）一律不读' + (sm.skippedSecretsCount ? '，本次跳过 ' + sm.skippedSecretsCount + ' 个：' + esc(sm.skippedSecrets.slice(0, 6).join('、')) + (sm.skippedSecretsCount > 6 ? ' 等' : '') : '') + '；发送前已对疑似密钥做脱敏' + (sm.redactions ? '（本次隐藏 ' + sm.redactions + ' 处）' : '') + '。</p>'
    + '<details class="small"><summary class="muted" style="cursor:pointer">查看发送全文</summary><pre id="scan-raw" style="white-space:pre-wrap;word-break:break-all;max-height:260px;overflow:auto;background:var(--panel-2);border-radius:8px;padding:8px;font-size:11.5px"></pre></details></div>';
}

function draftToStory(d, sm) {
  const todos = (d.to_confirm || []).map((q) => '【待补充：' + String(q.ask || '').replace(/[【】]/g, '') + '】').filter((t) => t.length > 7);
  const result = [d.result || '', todos.length ? '待确认：' + todos.join('') : ''].filter(Boolean).join('\n');
  const evidence = [{ label: '本机项目', url: '', note: sm.root }, ...(d.evidence || []).map((e) => ({ label: String(e.file || '依据').slice(0, 80), url: '', note: e.note || '' }))].slice(0, 10);
  return {
    type: d.type || 'project', title: d.title || sm.name, org: d.org || '', role: d.role || '', start: d.start || '', end: d.end || '', location: '',
    background: d.background || '', task: d.task || '', action: d.action || '', result,
    metrics: d.metrics || [], stack: d.stack || [], tags: [...new Set([...(d.tags || []), '本机项目'])], evidence,
  };
}

function draftHtml(d, story) {
  const line = (k, v) => v ? '<div style="margin-top:6px"><b class="small">' + k + '</b><div class="small" style="line-height:1.7">' + markTodos(esc(v)).replace(/\n/g, '<br>') + '</div></div>' : '';
  return '<div class="card card-pad" style="margin-top:12px"><div class="row"><span class="badge info">' + esc(TYPE_NAME[story.type] || story.type) + '</span><h4 style="margin:0">' + esc(story.title) + '</h4><span class="muted small" style="margin-left:auto">' + esc([story.start, story.end].filter(Boolean).join(' – ')) + '</span></div>'
    + (story.role || story.org ? '<div class="small muted" style="margin-top:4px">' + markTodos(esc([story.org, story.role].filter(Boolean).join(' · '))) + '</div>' : '')
    + line('背景', story.background) + line('任务', story.task) + line('行动', story.action) + line('结果', d.result)
    + (story.metrics.length ? '<div style="margin-top:6px"><b class="small">数据（程序统计）</b><div class="chip-row">' + story.metrics.map((t) => '<span class="chip">' + esc(t) + '</span>').join('') + '</div></div>' : '')
    + (story.stack.length ? '<div class="chip-row" style="margin-top:6px">' + story.stack.map((t) => '<span class="chip">' + esc(t) + '</span>').join('') + '</div>' : '')
    + ((d.evidence || []).length ? '<div style="margin-top:6px"><b class="small">依据</b><ul class="small" style="margin:4px 0 0 18px">' + d.evidence.map((e) => '<li><code>' + esc(e.file) + '</code> ' + esc(e.note || '') + '</li>').join('') + '</ul></div>' : '')
    + ((d.to_confirm || []).length ? '<div style="margin-top:8px">' + d.to_confirm.map((q) => '<div class="callout" style="margin-bottom:6px">' + icon('question') + '<div><b>' + esc(q.ask) + '</b><div class="tiny">待确认：' + esc(q.aim || '') + '</div></div></div>').join('') + '<p class="tiny">这些问题会以【待补充】标记写进「结果」，保存后用右侧「Agent 引导式深挖」逐条补齐。</p></div>' : '')
    + (d.reason ? '<p class="tiny">' + esc(d.reason) + '</p>' : '') + '</div>';
}

function projectDialog() {
  const body = el(`<div>
    <div class="field"><label>项目目录（绝对路径）</label><input class="input" name="path" placeholder="如 E:\\Project\\demo 或 /Users/me/code/demo"></div>
    <div class="field"><label>我的角色 / 补充说明（可选，会当作可信事实交给 Agent）</label><textarea class="input" name="note" rows="2" placeholder="如：课程大作业，3 人小组，我负责后端接口和部署；已在实验室内部使用"></textarea></div>
    <div class="cols"><div class="field"><label>Git 作者名（可选）</label><input class="input" name="an" placeholder="留空自动取该仓库 git config"></div><div class="field"><label>Git 作者邮箱（可选）</label><input class="input" name="ae" placeholder="用于只统计你本人的提交"></div></div>
    <p class="muted small">只读扫描：跳过 node_modules、.git、构建产物、二进制和锁文件内容，密钥类文件（.env、*.pem、*.key 等）一律不读，发送前再做密钥脱敏。先扫描预览，确认后才会发送给模型。</p>
    <div class="row" style="gap:8px"><button class="btn" data-scan>${icon('eye')}扫描</button><button class="btn primary" data-gen disabled>${icon('sparkles')}生成素材</button></div>
    <div data-out></div><div data-draft></div>
  </div>`);
  let scan = null;
  let draft = null;
  let abort;
  const dlg = modal({ title: '从本机项目生成经历素材', body, width: 760, onClose: () => abort?.abort() });
  const q = (sel) => body.querySelector(sel);
  q('[data-scan]').onclick = async () => {
    const btn = q('[data-scan]');
    btn.classList.add('loading');
    q('[data-gen]').disabled = true;
    q('[data-draft]').innerHTML = '';
    try {
      const r = await post('/api/stories/_scan', { path: q('[name=path]').value, authorName: q('[name=an]').value.trim(), authorEmail: q('[name=ae]').value.trim() });
      scan = r;
      q('[data-out]').innerHTML = scanSummaryHtml(r.summary);
      q('#scan-raw').textContent = r.payload || '';
      q('[data-gen]').disabled = false;
    } catch (e) {
      scan = null;
      q('[data-out]').innerHTML = '<div class="callout warn" style="margin-top:12px">' + icon('alert') + '<div>' + esc(e.message) + '</div></div>';
    } finally { btn.classList.remove('loading'); }
  };
  q('[data-gen]').onclick = async () => {
    if (!scan) return;
    const box = q('[data-draft]');
    box.innerHTML = '<div style="margin-top:12px">' + thinkingBox('正在根据项目起草素材…') + '</div>';
    box.querySelector('[data-stop]')?.addEventListener('click', () => abort?.abort());
    abort?.abort(); abort = new AbortController();
    q('[data-gen]').disabled = true;
    try {
      const r = await runAgent({ task: 'story_from_project', scanId: scan.scanId, note: q('[name=note]').value.trim() }, { ...streamHandlers(box, { json: true }), signal: abort.signal });
      draft = r.data || {};
      const story = draftToStory(draft, scan.summary);
      box.innerHTML = draftHtml(draft, story) + '<div class="row" style="gap:8px;margin-top:10px;justify-content:flex-end"><button class="btn" data-edit>' + icon('edit') + '先在编辑页修改</button><button class="btn primary" data-save>' + icon('save') + '保存到素材库</button></div>';
      box.querySelector('[data-edit]').onclick = () => { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(story)); dlg.close(); location.hash = '#/stories/new'; };
      box.querySelector('[data-save]').onclick = async () => {
        try {
          const saved = await post('/api/stories', story);
          toast('已保存到素材库');
          dlg.close();
          location.hash = '#/stories/' + saved.item.id;
        } catch (e) { toast(e.message, 'err'); }
      };
    } catch (e) {
      if (abort.signal.aborted) { box.innerHTML = ''; return; }
      box.innerHTML = '<div class="callout warn" style="margin-top:12px">' + icon('alert') + '<div>' + esc(e.message) + '</div></div>';
    } finally { q('[data-gen]').disabled = false; }
  };
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

async function renderEdit(view, story, data, resumes, draft = null) {
  const s = story || draft || { type: 'project', metrics: [], stack: [], tags: [], evidence: [] };
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
