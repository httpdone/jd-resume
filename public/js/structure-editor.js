// 左侧结构树 + 预览选中工具栏（overlay，不写入简历 DOM）
import { icon, el, $, toast, modal, confirmDialog } from './ui.js';
import { ADDABLE_MODULES } from './resume-dom.js';
import { itemKind, fieldLabels, itemPlaceholders } from './item-layout.js';
import { getOverlay, intersectVisible, clearOverlay, mountOverlayNode, applyBox, visibleDocRect, docRectToWrap, placeBar } from './overlay.js';
import { loadStories } from './pages/shared.js';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function highlightOutline(box, id, { scroll = true } = {}) {
  if (!box) return;
  box.querySelectorAll('.ol-card.active, .ol-item.active').forEach((n) => n.classList.remove('active'));
  if (!id) return;
  const card = box.querySelector('.ol-card[data-item="' + CSS.escape(id) + '"]');
  if (!card) return;
  card.classList.add('active');
  if (scroll) {
    try { card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* 忽略 */ }
  }
}

function kindOf(it) {
  const type = it.module;
  if (type && type !== 'custom') return itemKind(type);
  const rows = it.el?.querySelectorAll?.(':scope > .menu-title')?.length || 0;
  if (!rows) return 'body';
  if (rows === 1) return 'single';
  return 'range';
}

function phText(type, field) {
  return (itemPlaceholders(type)[field] || '').replace(/[【】]/g, '') || '';
}

function fieldInput(it, field, label, value, { span = false, ph = '' } = {}) {
  return '<div class="ol-f' + (span ? ' span-2' : '') + '"><label>' + esc(label) + '</label>'
    + '<input class="input sm" data-field="' + field + '" data-item="' + esc(it.id) + '" value="' + esc(value || '') + '" placeholder="' + esc(ph) + '"></div>';
}

export function renderStructureTree(box, rd, opts = {}) {
  const { onLocate, onRewriteItem, onRewriteMod, onChanged, onSave, onInsertStory, getSelected, focusItem } = opts;
  const selected = getSelected?.() || opts.selected || '';
  const mods = rd.modules();
  const headActs = (m) => {
    return '<span class="ol-acts">'
      + '<button class="btn xs ghost icon act" data-a="up" data-mod="' + esc(m.id) + '" title="上移">' + icon('up') + '</button>'
      + '<button class="btn xs ghost icon act" data-a="down" data-mod="' + esc(m.id) + '" title="下移">' + icon('down') + '</button>'
      + '<button class="btn xs ghost icon act" data-a="hide" data-mod="' + esc(m.id) + '" title="' + (m.hidden ? '显示' : '隐藏') + '">' + (m.hidden ? icon('eye') : icon('eyeOff')) + '</button>'
      + '<button class="btn xs ghost icon act" data-a="rename" data-mod="' + esc(m.id) + '" title="重命名标题">' + icon('edit') + '</button>'
      + (m.items.filter((i) => i.editable).length ? '<button class="btn xs ghost icon act" data-rw-mod="' + esc(m.id) + '" title="AI 改写整个模块">' + icon('wand') + '</button>' : '')
      + '<button class="btn xs ghost icon act" data-a="add-item" data-mod="' + esc(m.id) + '" title="新增一条">' + icon('plus') + '</button>'
      + '<button class="btn xs ghost icon act danger" data-a="del-mod" data-mod="' + esc(m.id) + '" title="删除模块">' + icon('trash') + '</button>'
      + '</span>';
  };
  const itemActs = (it) => '<span class="ol-acts">'
    + '<button class="btn xs ghost icon act" data-a="i-up" data-item="' + esc(it.id) + '" title="上移">' + icon('up') + '</button>'
    + '<button class="btn xs ghost icon act" data-a="i-down" data-item="' + esc(it.id) + '" title="下移">' + icon('down') + '</button>'
    + '<button class="btn xs ghost icon act" data-a="i-copy" data-item="' + esc(it.id) + '" title="复制">' + icon('copy') + '</button>'
    + (it.editable && it.text ? '<button class="btn xs ghost icon act" data-rw-item="' + esc(it.id) + '" title="AI 改写这一条">' + icon('wand') + '</button>' : '')
    + '<button class="btn xs ghost icon act danger" data-a="i-del" data-item="' + esc(it.id) + '" title="删除">' + icon('trash') + '</button>'
    + '</span>';

  const cardBody = (it) => {
    const kind = kindOf(it);
    const labels = fieldLabels(it.module);
    const fields = it.fields || {};
    const type = it.module;
    if (kind === 'body') {
      return '<div class="ol-form"><div class="ol-f span-2"><label>' + esc(labels.body || '内容') + '</label>'
        + '<textarea class="input sm" data-field="body" data-item="' + esc(it.id) + '" rows="5" placeholder="' + esc(phText(type, 'body')) + '">' + esc(fields.body || it.text || '') + '</textarea></div></div>';
    }
    if (kind === 'single') {
      return '<div class="ol-form">'
        + fieldInput(it, 'org', labels.org || '名称', fields.org, { span: true, ph: phText(type, 'org') })
        + fieldInput(it, 'start', labels.start || '时间', fields.start || fields.dates, { span: true, ph: phText(type, 'start') })
        + '</div>';
    }
    const bullets = [...(it.el?.querySelectorAll?.('.menu-content li') || [])];
    const bl = bullets.map((li, i) => '<div class="ol-li" data-item="' + esc(it.id) + '" data-bi="' + i + '">'
      + '<textarea class="input sm" data-field="bullet" data-item="' + esc(it.id) + '" data-bi="' + i + '" rows="2">' + esc(li.textContent || '') + '</textarea>'
      + '<span class="ol-acts"><button class="btn xs ghost icon act" data-a="b-up" title="上移">↑</button><button class="btn xs ghost icon act" data-a="b-down" title="下移">↓</button><button class="btn xs ghost icon act danger" data-a="b-del" title="删除">×</button></span></div>').join('');
    return '<div class="ol-form">'
      + fieldInput(it, 'org', labels.org || '名称', fields.org, { span: true, ph: phText(type, 'org') })
      + fieldInput(it, 'start', labels.start || '开始时间', fields.start, { ph: phText(type, 'start') || '开始年月' })
      + fieldInput(it, 'end', labels.end || '结束时间', fields.end, { ph: phText(type, 'end') || '结束年月 / 至今' })
      + fieldInput(it, 'role', labels.role || '角色', fields.role, { ph: phText(type, 'role') })
      + fieldInput(it, 'place', labels.place || '地点', fields.place, { ph: '地点（可空）' })
      + '<div class="ol-f span-2"><label>' + esc(labels.body || '描述 / 要点') + '</label>'
      + '<textarea class="input sm" data-field="desc" data-item="' + esc(it.id) + '" rows="2" placeholder="一段描述（可空）">' + esc(fields.desc || '') + '</textarea></div>'
      + '</div>'
      + '<div class="ol-bullets">' + bl + '<button class="btn xs ghost" data-a="b-add" data-item="' + esc(it.id) + '">+ 要点</button></div>';
  };

  box.innerHTML = '<h4>简历结构 <span class="n" style="text-transform:none;letter-spacing:0;font-weight:500">每条经历一张填报卡片</span></h4>'
    + mods.map((m) => {
      return '<div class="ol-mod' + (m.hidden ? ' hidden-mod' : '') + '" data-mod="' + esc(m.id) + '">'
        + '<div class="ol-mod-head" data-mod="' + esc(m.id) + '" draggable="true" title="拖动标题栏调整模块顺序">' + icon('layers') + '<span class="ol-name" title="双击重命名">' + esc(m.title) + '</span><span class="n">' + m.items.length + '</span>' + headActs(m) + '</div>'
        + m.items.map((it) => {
          const kind = kindOf(it);
          const fields = it.fields || {};
          const title = (kind === 'body'
            ? (fields.body || it.text || m.title || '（空）').split('\n')[0]
            : (fields.org || (it.title || it.text || '（空）').split(' ｜ ')[0])
          ).slice(0, 28) || '（空）';
          return '<div class="ol-card" data-item="' + esc(it.id) + '" data-kind="' + kind + '">'
            + '<div class="ol-card-head" data-item="' + esc(it.id) + '"><span class="ol-card-title" title="' + esc(it.title || (it.text || "").slice(0, 40)) + '">' + esc(title) + '</span>' + itemActs(it) + '</div>'
            + cardBody(it)
            + '</div>';
        }).join('')
        + '</div>';
    }).join('')
    + '<div class="ol-add"><button class="btn sm" id="ol-add-mod">' + icon('plus') + '新增模块</button> <button class="btn sm ghost" id="ol-add-story">' + icon('book') + '从素材库插入</button></div>'
    + '<div class="ol-foot">每条经历是一张填报卡片（名称、开始/结束时间、角色、地点、要点）。点预览中的条目会定位到对应卡片。Ctrl+Z 撤销，并会写入历史版本。</div>';

  const passOpts = () => ({ onLocate, onRewriteItem, onRewriteMod, onChanged, onSave, onInsertStory, getSelected, selected: getSelected?.() || selected });
  const changed = (selectId, more = {}) => {
    onChanged?.();
    onSave?.();
    const sel = selectId || getSelected?.() || selected;
    renderStructureTree(box, rd, { ...passOpts(), ...more, selected: sel, getSelected: getSelected || (() => sel) });
  };

  if (selected) highlightOutline(box, selected, { scroll: !focusItem });
  if (focusItem) {
    const card = box.querySelector('.ol-card[data-item="' + CSS.escape(focusItem) + '"]');
    card?.classList.add('active');
    const inp = card?.querySelector('input[data-field="org"], textarea[data-field="body"]');
    try { inp?.focus(); inp?.select?.(); } catch { /* 忽略 */ }
    try { card?.scrollIntoView({ block: 'nearest' }); } catch { /* 忽略 */ }
  }

  box.onchange = (e) => {
    const inp = e.target.closest('input[data-field], textarea[data-field]');
    if (!inp) return;
    const field = inp.dataset.field;
    const id = inp.dataset.item;
    if (field === 'desc') rd.setItemDesc(id, inp.value);
    else if (field === 'body') rd.setItemContent(id, inp.value);
    else if (field === 'bullet') rd.setBulletText(id, +inp.dataset.bi, inp.value);
    else rd.setItemField(id, field, inp.value);
    onChanged?.();
    onSave?.();
  };

  box.onclick = async (e) => {
    const rwItem = e.target.closest('[data-rw-item]');
    const rwMod = e.target.closest('[data-rw-mod]');
    if (rwItem) { e.stopPropagation(); onRewriteItem?.(rwItem.dataset.rwItem); return; }
    if (rwMod) { e.stopPropagation(); const m = rd.modules().find((x) => x.id === rwMod.dataset.rwMod); onRewriteMod?.(m); return; }

    const btn = e.target.closest('[data-a]');
    const act = btn?.dataset.a;
    if (act === 'up') { rd.moveModule(btn.dataset.mod, -1); return changed(); }
    if (act === 'down') { rd.moveModule(btn.dataset.mod, 1); return changed(); }
    if (act === 'hide') {
      const m = rd.modules().find((x) => x.id === btn.dataset.mod);
      rd.setModuleHidden(btn.dataset.mod, !m?.hidden);
      return changed();
    }
    if (act === 'rename') { return renameMod(rd, btn.dataset.mod, changed); }
    if (act === 'add-item') { const id = rd.addItem(btn.dataset.mod); onLocate?.(id); return changed(id, { focusItem: id }); }
    if (act === 'del-mod') {
      if (!(await confirmDialog('删除整个模块「' + (rd.modules().find((x) => x.id === btn.dataset.mod)?.title || '') + '」？可用 Ctrl+Z 撤销。', { ok: '删除', danger: true }))) return;
      rd.removeModule(btn.dataset.mod); return changed();
    }
    if (act === 'i-up') { rd.moveItem(btn.dataset.item, -1); return changed(btn.dataset.item); }
    if (act === 'i-down') { rd.moveItem(btn.dataset.item, 1); return changed(btn.dataset.item); }
    if (act === 'i-copy') { const id = rd.duplicateItem(btn.dataset.item); onLocate?.(id); return changed(id, { focusItem: id }); }
    if (act === 'i-del') {
      if (!(await confirmDialog('删除这条经历？可用 Ctrl+Z 撤销。', { ok: '删除', danger: true }))) return;
      rd.removeItem(btn.dataset.item); return changed();
    }
    if (act === 'b-add') { rd.addBullet(btn.dataset.item); return changed(btn.dataset.item); }
    const li = e.target.closest('.ol-li');
    if (li && act) {
      const itemId = li.dataset.item, i = +li.dataset.bi;
      if (act === 'b-up') rd.moveBullet(itemId, i, -1);
      else if (act === 'b-down') rd.moveBullet(itemId, i, 1);
      else if (act === 'b-del') rd.removeBullet(itemId, i);
      return changed(itemId);
    }

    if (e.target.closest('#ol-add-mod')) return pickNewModule(rd, changed);
    if (e.target.closest('#ol-add-story')) return onInsertStory?.();

    if (e.target.closest('input,textarea,button')) return;
    const card = e.target.closest('.ol-card[data-item]');
    if (card) { highlightOutline(box, card.dataset.item); onLocate?.(card.dataset.item); return; }
    const mh = e.target.closest('.ol-mod-head');
    if (mh) {
      const m = rd.modules().find((x) => x.id === mh.dataset.mod);
      if (m?.items[0]) onLocate?.(m.items[0].id, m.items.map((i) => i.id));
    }
  };

  box.ondblclick = (e) => {
    const head = e.target.closest('.ol-mod-head');
    if (head) renameMod(rd, head.dataset.mod, changed);
  };

  let dragId = '';
  box.ondragstart = (e) => {
    // 只有模块标题栏能拖；卡片里的输入框正常选中文字
    const head = e.target.closest?.('.ol-mod-head');
    const mod = head?.closest('.ol-mod[data-mod]');
    if (!mod) { dragId = ''; return; }
    dragId = mod.dataset.mod;
    e.dataTransfer.effectAllowed = 'move';
  };
  box.ondragover = (e) => {
    const mod = e.target.closest('.ol-mod[data-mod]');
    if (!mod || !dragId) return;
    e.preventDefault();
    box.querySelectorAll('.ol-mod').forEach((n) => n.classList.toggle('drag-over', n === mod && n.dataset.mod !== dragId));
  };
  box.ondrop = (e) => {
    const mod = e.target.closest('.ol-mod[data-mod]');
    box.querySelectorAll('.ol-mod').forEach((n) => n.classList.remove('drag-over'));
    if (!mod || !dragId || mod.dataset.mod === dragId) return;
    e.preventDefault();
    const order = rd.modules().map((m) => m.id);
    const from = order.indexOf(dragId), to = order.indexOf(mod.dataset.mod);
    if (from < 0 || to < 0) return;
    order.splice(to, 0, ...order.splice(from, 1));
    rd.snapshot();
    rd.reorderModules(order);
    rd._commitStructure();
    changed();
  };
}

function renameMod(rd, id, changed) {
  const m = rd.modules().find((x) => x.id === id);
  if (!m) return;
  const name = prompt('模块标题', m.title);
  if (name == null) return;
  const t = name.trim();
  if (!t || t === m.title) return;
  rd.renameModule(id, t);
  changed();
}

async function pickNewModule(rd, changed) {
  const body = el('<div><p class="muted small" style="margin-top:0">新模块会使用模板里已有的 DOM 结构，7 套主题都能套用。</p><div class="row" style="gap:8px;flex-wrap:wrap">'
    + ADDABLE_MODULES.map(([id, name]) => '<button class="btn sm" data-type="' + id + '">' + esc(name) + '</button>').join('')
    + '</div></div>');
  const m = modal({ title: '新增模块', body, width: 480, actions: [{ label: '取消' }] });
  body.onclick = async (e) => {
    const type = e.target.closest('[data-type]')?.dataset.type;
    if (!type) return;
    let title = '';
    if (type === 'custom') {
      title = (prompt('自定义模块标题', '自定义模块') || '').trim();
      if (!title) return;
    }
    m.close();
    try { rd.addModule(type, { title }); toast('已添加模块'); changed(); }
    catch (err) { toast(err.message, 'err'); }
  };
}

export async function openStoryInsert(rd, { onLocate, onChanged, onSave } = {}) {
  const stories = await loadStories();
  if (!stories.length) { toast('素材库还是空的，先到「经历素材」里写一条', 'warn'); return; }
  const mods = rd.modules();
  const body = el('<div><p class="muted small" style="margin-top:0">选一条素材，插入为对应模块的新条目。</p><div class="field"><label>插入到模块</label><select class="input sm" data-mod>'
    + mods.map((m) => '<option value="' + esc(m.id) + '">' + esc(m.title) + '</option>').join('')
    + '</select></div><div class="story-pick" style="display:flex;flex-direction:column;gap:6px;max-height:320px;overflow:auto">'
    + stories.map((s) => '<button type="button" class="btn" style="justify-content:flex-start;height:auto;padding:8px 10px;text-align:left" data-sid="' + esc(s.id) + '"><b>' + esc(s.title || s.org || '未命名') + '</b><div class="small muted">' + esc([s.org, s.role, [s.start, s.end].filter(Boolean).join(' - ')].filter(Boolean).join(' · ')) + '</div></button>').join('')
    + '</div></div>');
  const m = modal({ title: '从素材库插入经历', body, width: 520, actions: [{ label: '取消' }] });
  body.onclick = (e) => {
    const sid = e.target.closest('[data-sid]')?.dataset.sid;
    if (!sid) return;
    const story = stories.find((s) => s.id === sid);
    const moduleId = body.querySelector('[data-mod]').value;
    m.close();
    const id = rd.addItem(moduleId, { story });
    toast('已插入「' + (story.title || story.org || '素材') + '」');
    onLocate?.(id);
    onChanged?.();
    onSave?.();
  };
}

// 编辑态的「选中框 + 操作栏」：同一时间只有一个选中项。
// - 点击条目/模块 → 选中它（换一个就移过去）；点击空白、简历外、按 Esc → 取消选中
// - 操作栏锚定在选中元素自己的可见矩形（计入缩放、分页），放在右下角外侧，不跟随鼠标悬停跳动
export function bindHoverToolbar(rd, opts = {}) {
  const iframe = rd.iframe;
  const ov = getOverlay(iframe);
  if (!ov) return;
  iframe._rpStructOpts = opts;
  // 同一份文档只绑定一次（重复绑定会出现多套选中框互相打架）
  if (iframe._rpStructBound === rd.doc) { iframe._rpPaintStruct?.(); return; }
  const onChanged = (...a) => iframe._rpStructOpts?.onChanged?.(...a);
  const onSave = (...a) => iframe._rpStructOpts?.onSave?.(...a);
  const onLocate = (...a) => iframe._rpStructOpts?.onLocate?.(...a);
  iframe._rpStructBound = rd.doc;
  const doc = rd.doc;
  let active = null; // { id, kind, el }

  const resolve = () => {
    if (!active) return null;
    if (active.el?.isConnected && active.el.ownerDocument === rd.doc && visibleDocRect(active.el)) return active.el;
    // 重新分页后旧节点被替换：按 id 找到真正可见的那一份
    const loc = rd.locate?.(active.id);
    const el = loc?.el || rd.primary()?.querySelector('[id="' + CSS.escape(active.id) + '"]');
    if (!el) { active = null; return null; }
    active.el = el;
    return el;
  };

  const clearNodes = () => { clearOverlay(ov.layer, 'rp-struct-bar'); clearOverlay(ov.layer, 'rp-ov-sel'); clearOverlay(ov.layer, 'rp-ov-hit'); };

  const paint = () => {
    clearNodes();
    if (!rd.editable) { active = null; return; }
    const el = resolve();
    if (!el) return;
    const box = intersectVisible(docRectToWrap(visibleDocRect(el), iframe, ov.wrap), iframe, ov.wrap);
    if (!box) return;
    const sel = mountOverlayNode(ov.layer, 'rp-ov-sel');
    applyBox(sel, { left: box.left - 3, top: box.top - 3, width: box.width + 6, height: box.height + 6 });
    sel.dataset.for = active.id;
    const bar = mountOverlayNode(ov.layer, 'rp-ov-bar rp-struct-bar');
    bar.dataset.for = active.id;
    const isMod = active.kind === 'mod';
    const wr = ov.wrap.getBoundingClientRect();
    // 纸张右侧留白（.stage-inner 的右内边距）够放竖排工具栏就停靠在那里
    const host = ov.wrap.parentElement;
    const gutter = host ? (parseFloat(getComputedStyle(host).paddingRight) || 0) : 0;
    // 舞台（滚动容器）里纸张当前可见的范围
    const stage = ov.wrap.closest('.stage') || document.documentElement;
    const sr = stage.getBoundingClientRect();
    const view = { left: Math.max(sr.left, 0) - wr.left, top: Math.max(sr.top, 0) - wr.top, right: Math.min(sr.right, window.innerWidth) - wr.left, bottom: Math.min(sr.bottom, window.innerHeight) - wr.top };
    const side = gutter >= 38 && wr.width + 4 + 34 <= view.right + 0.5;
    bar.classList.toggle('rp-bar-vertical', side);
    bar.innerHTML = (isMod ? '<span class="rp-ov-tag" title="当前选中整个模块">模块</span>' : '')
      + '<button type="button" data-a="up" title="上移">上移</button><button type="button" data-a="down" title="下移">下移</button>'
      + (isMod ? '<button type="button" data-a="add" title="新增条目">新增</button>' : '<button type="button" data-a="copy" title="复制这一条">复制</button><button type="button" data-a="add" title="在本模块新增一条">新增</button>')
      + '<button type="button" data-a="del" class="danger" title="删除">删除</button>';
    const outer = { left: box.left - 3, top: box.top - 3, width: box.width + 6, height: box.height + 6 };
    const pos = placeBar(outer, { width: bar.offsetWidth, height: bar.offsetHeight }, { width: wr.width, height: wr.height }, 4, side ? gutter : 0, side ? view : { ...view, top: -1e6, bottom: 1e6 });
    bar.style.left = pos.left + 'px';
    bar.style.top = pos.top + 'px';
    bar.dataset.where = pos.where;
    // 不抢走正文里的光标
    bar.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
    bar.onclick = async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a || !active) return;
      e.preventDefault(); e.stopPropagation();
      const id = active.id;
      let next = id;
      if (isMod) {
        if (a === 'up') rd.moveModule(id, -1);
        else if (a === 'down') rd.moveModule(id, 1);
        else if (a === 'add') { next = rd.addItem(id); onLocate?.(next); }
        else if (a === 'del') {
          if (!(await confirmDialog('删除整个模块？可用 Ctrl+Z 撤销。', { ok: '删除', danger: true }))) return;
          rd.removeModule(id); next = null;
        }
      } else {
        if (a === 'up') rd.moveItem(id, -1);
        else if (a === 'down') rd.moveItem(id, 1);
        else if (a === 'copy') { next = rd.duplicateItem(id); onLocate?.(next); }
        else if (a === 'add') { const it = rd.item(id); next = rd.addItem(it.module); onLocate?.(next); }
        else if (a === 'del') {
          if (!(await confirmDialog('删除这条经历？可用 Ctrl+Z 撤销。', { ok: '删除', danger: true }))) return;
          rd.removeItem(id); next = null;
        }
      }
      active = next ? { id: next, kind: next === id ? active?.kind || (isMod ? 'mod' : 'item') : 'item', el: null } : null;
      onChanged?.();
      onSave?.();
      paint();
    };
  };

  const onSelect = (...a) => iframe._rpStructOpts?.onSelect?.(...a);
  const select = (target) => {
    if (!target) { rd.highlight?.([]); if (active) { active = null; paint(); } onSelect?.(null); return; }
    const kind = target.classList.contains('section-item-container') ? 'item' : 'mod';
    if (active && active.el === target) return;
    rd.highlight?.([]);
    active = { id: target.id, kind, el: target };
    paint();
    onSelect?.(active.id, active.kind);
  };
  const clear = () => select(null);
  const pickTarget = (t) => {
    if (!t?.closest) return null;
    if (t.closest('.user')) return null; // 页眉由头像/校徽工具处理
    const item = t.closest('.section-item-container');
    if (item?.id) return item;
    const mod = t.closest('.option');
    return mod?.id ? mod : null;
  };

  doc.addEventListener('mousedown', (e) => {
    if (!rd.editable) return;
    select(pickTarget(e.target));
  }, true);
  // 键盘移动光标到别的条目时，选中框也跟过去
  doc.addEventListener('selectionchange', () => {
    if (!rd.editable) return;
    const n = doc.getSelection()?.anchorNode;
    const t = pickTarget(n?.nodeType === 1 ? n : n?.parentElement);
    if (t && t !== active?.el && doc.activeElement?.closest?.('.content-scroll')) select(t);
  });
  let raf = 0;
  const repaintSoon = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (active) paint(); }); };
  doc.addEventListener('input', repaintSoon);
  const onEsc = (e) => {
    if (e.key !== 'Escape' || !active) return;
    if (document.querySelector('.modal-mask')) return;
    clear();
    try { doc.getSelection()?.removeAllRanges(); doc.activeElement?.blur?.(); } catch { /* 忽略 */ }
  };
  doc.addEventListener('keydown', onEsc);
  // 父页面：点在简历 iframe 外（舞台空白、侧栏等）就取消；点操作栏本身不算
  const onOuterDown = (e) => {
    if (!iframe.isConnected || iframe._rpStructBound !== doc) { document.removeEventListener('mousedown', onOuterDown, true); document.removeEventListener('keydown', onOuterKey); window.removeEventListener('resize', repaintSoon); return; }
    if (!active) return;
    if (e.target.closest?.('.rp-page-overlay > .rp-ov-bar, .modal-mask, #outline')) return;
    clear();
  };
  const onOuterKey = (e) => { if (!iframe.isConnected || iframe._rpStructBound !== doc) return; onEsc(e); };
  document.addEventListener('mousedown', onOuterDown, true);
  ov.wrap.closest('.stage')?.addEventListener('scroll', () => { if (active) repaintSoon(); }, { passive: true });
  document.addEventListener('keydown', onOuterKey);
  window.addEventListener('resize', repaintSoon);
  try { new ResizeObserver(repaintSoon).observe(doc.body); } catch { /* 旧浏览器忽略 */ }

  iframe._rpPaintStruct = paint;
  iframe._rpSelectStruct = (id) => { if (!id) return clear(); const el = rd.locate?.(id)?.el; if (el) select(el); };
  iframe._rpStructActive = () => (active ? { id: active.id, kind: active.kind } : null);
}

export function afterZoomPaint(iframe) {
  iframe?._rpPaintMedia?.();
  iframe?._rpPaintStruct?.();
}
