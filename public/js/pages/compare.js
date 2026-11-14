import { icon, esc, $, $$, toast, fmtTime } from '../ui.js';
import { get } from '../api.js';
import { diffHtml, changeRatio } from '../diff.js';

export async function render(view, params) {
  const resumes = (await get('/api/resumes')).items;
  const aSlug = params[0] || resumes[0]?.slug || '';
  const bSlug = params[1] || resumes[1]?.slug || resumes[0]?.slug || '';
  const aHist = params[2] || '';
  const bHist = params[3] || '';
  view.innerHTML = `<div class="page" style="max-width:1500px"><div class="page-head"><div><h1>版本对比</h1><p>任意两份简历，或同一份的历史版本，按模块对齐并逐字高亮差异。</p></div></div>
    <div class="compare-head">
      ${sideSelect('a', resumes, aSlug, aHist)}
      ${sideSelect('b', resumes, bSlug, bHist)}
    </div>
    <div class="row" style="margin-bottom:14px"><button class="btn primary" id="go">${icon('columns')}开始对比</button><span class="muted small" id="sum"></span></div>
    <div id="out"></div></div>`;
  await fillHistory('a', aSlug, aHist);
  await fillHistory('b', bSlug, bHist);
  view.querySelector('[name=a]').onchange = () => fillHistory('a', view.querySelector('[name=a]').value);
  view.querySelector('[name=b]').onchange = () => fillHistory('b', view.querySelector('[name=b]').value);
  $('#go').onclick = () => run(view);
  if (aSlug && bSlug) run(view);
}

function sideSelect(side, resumes, slug, hist) {
  return `<div class="card card-pad"><div class="field"><label>${side === 'a' ? '左侧' : '右侧'}</label><select class="input" name="${side}">${resumes.map((r) => '<option value="' + esc(r.slug) + '"' + (r.slug === slug ? ' selected' : '') + '>' + esc(r.slug) + '</option>').join('')}</select></div>
    <div class="field"><label>版本</label><select class="input" name="${side}-h"><option value="">当前保存稿</option></select></div></div>`;
}

async function fillHistory(side, slug, selected = '') {
  const sel = document.querySelector('[name=' + side + '-h]');
  if (!sel || !slug) return;
  const { items } = await get('/api/resumes/' + encodeURIComponent(slug) + '/history');
  sel.innerHTML = '<option value="">当前保存稿</option>' + items.map((h) => '<option value="' + esc(h.id) + '"' + (h.id === selected ? ' selected' : '') + '>' + new Date(h.at).toLocaleString('zh-CN', { hour12: false }) + ' · ' + Math.round(h.bytes / 1024) + ' KB</option>').join('');
  if (selected) sel.value = selected;
}

async function loadHtml(slug, hist) {
  if (hist) return (await get('/api/resumes/' + encodeURIComponent(slug) + '/history/' + encodeURIComponent(hist))).html;
  return (await get('/api/resumes/' + encodeURIComponent(slug))).html;
}

function parse(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.querySelector('.content-scroll') || doc.body;
  const modules = [...root.querySelectorAll('.option')].map((opt) => {
    const id = opt.id || '';
    const title = (opt.querySelector('.module-title-wrapper .title, .module-title-wrapper')?.textContent || id).replace(/\s+/g, ' ').trim();
    const items = [...opt.querySelectorAll('.section-item-container')].map((it) => {
      const content = it.querySelector('.menu-content');
      const t = [...it.querySelectorAll('.menu-title')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ｜ ');
      return { id: it.id, title: t, text: (content?.textContent || '').replace(/\s+/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), html: content?.innerHTML || '' };
    });
    return { id, title, items };
  }).filter((m) => m.id);
  return modules;
}

function alignItems(a, b) {
  const used = new Set();
  const pairs = [];
  for (const x of a) {
    const byId = b.find((y) => y.id && y.id === x.id);
    const byTitle = !byId && b.find((y) => y.title && y.title === x.title && !used.has(y.id));
    const y = byId || byTitle || null;
    if (y) used.add(y.id);
    pairs.push([x, y]);
  }
  for (const y of b) if (!used.has(y.id)) pairs.push([null, y]);
  return pairs;
}

async function run(view) {
  const aSlug = view.querySelector('[name=a]').value;
  const bSlug = view.querySelector('[name=b]').value;
  const aH = view.querySelector('[name=a-h]').value;
  const bH = view.querySelector('[name=b-h]').value;
  if (!aSlug || !bSlug) return toast('请选择要对比的简历', 'warn');
  $('#out').innerHTML = '<div class="muted small">正在对比…</div>';
  try {
    const [ha, hb] = await Promise.all([loadHtml(aSlug, aH), loadHtml(bSlug, bH)]);
    const A = parse(ha), B = parse(hb);
    const used = new Set();
    let changed = 0, same = 0;
    let html = '<div class="compare-grid"><div class="h">模块 / 条目</div><div class="h">' + esc(aSlug) + (aH ? '（历史）' : '') + '</div><div class="h">' + esc(bSlug) + (bH ? '（历史）' : '') + '</div>';
    const mods = [];
    for (const m of A) {
      const n = B.find((x) => x.id === m.id) || B.find((x) => x.title === m.title);
      if (n) used.add(n.id);
      mods.push([m, n]);
    }
    for (const n of B) if (!used.has(n.id)) mods.push([null, n]);
    for (const [m, n] of mods) {
      html += '<div class="mod">' + esc((m || n).title) + (m && n && m.title !== n.title ? '  ↔  ' + esc(n.title) : '') + '</div>';
      const pairs = alignItems(m?.items || [], n?.items || []);
      for (const [x, y] of pairs) {
        const left = x?.text || '';
        const right = y?.text || '';
        const ratio = left && right ? changeRatio(left, right) : 100;
        if (ratio < 1 && x && y) same++; else changed++;
        const body = (!x ? '<span class="badge warn">仅右侧有</span>' : !y ? '<span class="badge warn">仅左侧有</span>' : ratio < 1 ? '<span class="badge ok">相同</span>' : '<span class="badge">' + ratio + '% 不同</span>');
        html += '<div class="c"><div style="font-weight:600">' + esc((x || y).title || (x || y).id) + '</div><div class="tiny">' + body + '</div></div>';
        html += '<div class="c diff">' + (x ? (y && ratio ? diffHtml(left, right) : esc(left).replace(/\n/g, '<br>')) : '<span class="muted">—</span>') + '</div>';
        html += '<div class="c diff">' + (y ? (x && ratio ? diffHtml(left, right) : esc(right).replace(/\n/g, '<br>')) : '<span class="muted">—</span>') + '</div>';
      }
    }
    html += '</div>';
    $('#out').innerHTML = html;
    $('#sum').textContent = '有差异的条目 ' + changed + ' 个，完全相同 ' + same + ' 个。';
  } catch (e) { $('#out').innerHTML = '<div class="callout warn">' + icon('alert') + '<div>' + esc(e.message) + '</div></div>'; }
}
