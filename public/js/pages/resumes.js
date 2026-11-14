import { icon, esc, el, toast, modal, confirmDialog, promptDialog, fmtTime, beginInlineEdit } from '../ui.js';
import { get, post, put, del } from '../api.js';
import { runAgent } from '../agent.js';
import { ResumeDoc } from '../resume-dom.js';
import { loadStories, thinkingBox } from './shared.js';
import { openThemePicker, thumbHtml, loadTemplates } from '../theme-picker.js';

export async function newResumeDialog(defaultFrom = '') {
  const { items } = await get('/api/resumes');
  return new Promise((resolve) => {
    const body = el('<div><div class="field"><label>简历名称</label><input class="input" name="name" placeholder="例如：张明-后端开发-通用版"><div class="hint">用于区分不同版本，建议 姓名-方向-公司</div></div><div class="field"><label>从哪里开始</label><select class="input" name="from"><option value="">基础模板（template/base.html）</option>' + items.map((r) => '<option value="' + esc(r.slug) + '"' + (r.slug === defaultFrom ? ' selected' : '') + '>复制「' + esc(r.slug) + '」</option>').join('') + '</select></div></div>');
    let done = false;
    modal({
      title: '新建简历', body, width: 480, onClose: () => { if (!done) resolve(null); },
      actions: [
        { label: '取消' },
        { label: '创建并打开', cls: 'primary', onClick: async () => {
          const name = body.querySelector('[name=name]').value.trim();
          if (!name) { toast('请填写名称', 'warn'); return false; }
          const r = await post('/api/resumes', { name, from: body.querySelector('[name=from]').value || null });
          done = true; resolve(r.slug); toast('已创建「' + r.slug + '」');
        } },
      ],
    });
  });
}

export async function exportPdfFlow(slug) {
  const r = await post('/api/resumes/' + encodeURIComponent(slug) + '/pdf');
  const body = '<p style="margin:0 0 6px">已导出 <b>' + esc(r.file) + '</b>（' + r.pages + ' 页 · ' + Math.round(r.bytes / 1024) + ' KB）</p><p class="muted small mono" style="margin:0;word-break:break-all">' + esc(r.path) + '</p>';
  modal({ title: 'PDF 导出成功', body, width: 480, actions: [
    { label: '在浏览器打开', icon: 'eye', onClick: () => { window.open(r.url, '_blank'); } },
    { label: '下载', cls: 'primary', icon: 'download', onClick: () => { const a = document.createElement('a'); a.href = r.url + '?download=1'; a.click(); } },
  ] });
  return r;
}

/** 复制当前简历并翻译为英文版（模板结构与 class 保持不变）。 */
export async function translateToEnglish(slug) {
  const base = String(slug).replace(/-EN$/, '');
  const box = document.createElement('div');
  box.innerHTML = thinkingBox('正在生成英文版（复制后翻译，不改中文原稿）…');
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:80;width:min(420px,92vw)';
  wrap.appendChild(box);
  document.body.appendChild(wrap);
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-9999px;width:794px;height:1123px;border:0;opacity:0';
  document.body.appendChild(iframe);
  try {
    const rd = new ResumeDoc(iframe);
    await rd.load('/preview/' + encodeURIComponent(slug) + '?t=' + Date.now());
    const resume = rd.payload();
    const stories = await loadStories();
    const r = await runAgent({
      task: 'translate',
      resume,
      items: resume.items,
      modules: rd.modules().map((m) => ({ id: m.id, title: m.title })),
      profileText: rd.profileText(),
      stories,
    }, { onMeta: (m) => { const l = box.querySelector('.lbl'); if (l && m.mock) l.textContent = '演示模式翻译中…'; } });
    const created = await post('/api/resumes', { name: base + '-EN', from: slug, unique: true, meta: { lang: 'en', from: slug } });
    rd.snapshot();
    rd.applyTranslation(r.data || {});
    await put('/api/resumes/' + encodeURIComponent(created.slug), { html: rd.serialize() });
    toast('已生成英文版「' + created.slug + '」' + ((r.data?.notes || [])[0] ? '。' + r.data.notes[0] : ''));
    location.hash = '#/editor/' + encodeURIComponent(created.slug);
    return created.slug;
  } finally {
    iframe.remove();
    wrap.remove();
  }
}

export async function render(view) {
  view.innerHTML = '<div class="page"><div class="page-head"><div><h1>简历库</h1><p>每份简历都是独立版本：通用版、按公司定制版……点开即可预览、编辑、让 AI 诊断改写。也可切换模板、对比版本，或翻译成英文版。</p></div><div class="actions"><a class="btn" href="#/compare">' + icon('columns') + '版本对比</a><button class="btn primary" id="btn-new">' + icon('plus') + '新建简历</button></div></div><div class="resume-grid" id="grid"></div></div>';
  view.querySelector('#btn-new').onclick = async () => { const slug = await newResumeDialog(); if (slug) location.hash = '#/editor/' + encodeURIComponent(slug); };
  await load(view);
}

async function load(view) {
  const grid = view.querySelector('#grid');
  const { items } = await get('/api/resumes');
  items.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  grid.innerHTML = '';
  for (const r of items) {
    const tgt = r.target ? [r.target.company, r.target.role].filter(Boolean).join(' · ') : '';
    const en = r.lang === 'en' || /[-_]EN$/i.test(r.slug);
    const tplName = r.template && r.template !== 'classic' ? r.template : '';
    const card = el('<div class="card resume-card"><div class="thumb">' + (r.target ? '<span class="badge primary tag">' + icon('target') + '定制版</span>' : '') + (en ? '<span class="badge tag" style="left:auto;right:8px">' + icon('globe') + 'EN</span>' : '') + (tplName ? '<span class="badge tag" style="top:auto;bottom:8px">' + icon('layout') + esc(tplName) + '</span>' : '') + '<iframe loading="lazy" tabindex="-1" src="/preview/' + encodeURIComponent(r.slug) + '"></iframe></div><div class="meta"><div class="resume-name-row"><b class="resume-name" title="双击重命名">' + esc(r.slug) + '</b><button class="btn xs ghost icon" data-a="rename-inline" title="重命名">' + icon('type') + '</button></div><span class="muted small">' + r.pages + ' 页 · ' + fmtTime(r.updatedAt) + ' 更新</span>' + (tgt ? '<span class="small" style="color:var(--primary)">' + esc(tgt) + '</span>' : (r.from && r.from !== 'template' ? '<span class="muted small">复制自 ' + esc(r.from) + '</span>' : '<span class="muted small">&nbsp;</span>')) + '<div class="ops"><button class="btn xs soft" data-a="edit">' + icon('edit') + '编辑</button><button class="btn xs ghost icon" data-a="copy" title="复制">' + icon('copy') + '</button><button class="btn xs ghost icon" data-a="tpl" title="模板">' + icon('layout') + '</button><button class="btn xs ghost icon" data-a="cmp" title="对比">' + icon('columns') + '</button>' + (en ? '' : '<button class="btn xs ghost icon" data-a="en" title="翻译成英文版">' + icon('globe') + '</button>') + '<button class="btn xs ghost icon" data-a="rename" title="重命名">' + icon('type') + '</button><button class="btn xs ghost icon" data-a="pdf" title="导出 PDF">' + icon('download') + '</button><button class="btn xs ghost icon danger" data-a="del" title="删除">' + icon('trash') + '</button></div></div></div>');
    const startRename = (e) => {
      e.preventDefault(); e.stopPropagation();
      const nameEl = card.querySelector('.resume-name');
      beginInlineEdit(nameEl, {
        value: r.slug,
        validate: (v) => {
          if (!v) return '名称不能为空';
          if (/[\\/:*?"<>|]/.test(v)) return '名称不能包含非法字符 \\ / : * ? " < > |';
          if (v.startsWith('.')) return '名称不能以 . 开头';
          if (v.length > 80) return '名称过长（最多 80 个字符）';
          return '';
        },
        onCommit: async (v) => {
          if (v === r.slug) return;
          await post('/api/resumes/' + encodeURIComponent(r.slug) + '/rename', { name: v });
          toast('已重命名为「' + v + '」');
          await load(view);
        },
      });
    };
    card.querySelector('.resume-name').addEventListener('dblclick', startRename);
    card.addEventListener('click', async (e) => {
      if (e.target.closest('[data-a="rename-inline"]') || e.target.closest('.inline-rename')) { startRename(e); return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      const enc = encodeURIComponent(r.slug);
      if (!a || a === 'edit') { location.hash = '#/editor/' + enc; return; }
      e.stopPropagation();
      try {
        if (a === 'copy') {
          const name = await promptDialog('复制简历', { label: '新简历名称', value: r.slug + '-副本' });
          if (!name) return;
          await post('/api/resumes', { name, from: r.slug });
          toast('已复制为「' + name + '」');
          await load(view);
        } else if (a === 'tpl') {
          await openThemePicker(r.slug, { template: r.template, theme: r.theme }, async () => { await load(view); });
        } else if (a === 'cmp') {
          location.hash = '#/compare/' + enc;
        } else if (a === 'en') {
          const b = e.target.closest('button'); b.classList.add('loading');
          try { await translateToEnglish(r.slug); } finally { b.classList.remove('loading'); }
        } else if (a === 'rename') {
          const name = await promptDialog('重命名', { label: '新名称', value: r.slug, hint: '关联的投递记录会同步更新' });
          if (!name || name === r.slug) return;
          await post('/api/resumes/' + enc + '/rename', { name });
          toast('已重命名');
          await load(view);
        } else if (a === 'pdf') {
          const b = e.target.closest('button'); b.classList.add('loading');
          try { await exportPdfFlow(r.slug); } finally { b.classList.remove('loading'); }
        } else if (a === 'del') {
          if (!(await confirmDialog('删除「' + r.slug + '」？\n简历文件夹（含历史版本）会被永久删除。', { ok: '删除', danger: true }))) return;
          await del('/api/resumes/' + enc);
          toast('已删除');
          await load(view);
        }
      } catch (err) { toast(err.message, 'err'); }
    });
    grid.appendChild(card);
  }
  const add = el('<div class="card new-card"><div>' + icon('plus') + '<div style="margin-top:6px;font-weight:600">新建简历</div><div class="small">从模板或现有简历复制</div></div></div>');
  add.onclick = async () => { const slug = await newResumeDialog(); if (slug) location.hash = '#/editor/' + encodeURIComponent(slug); };
  grid.appendChild(add);
}
