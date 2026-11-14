// 头像 / 校徽：选图、裁剪、形状、常用库。压缩后上传到 resumes/<slug>/assets/
import { icon, el, $, toast, modal, confirmDialog } from './ui.js';
import { get, post, del } from './api.js';
import { getOverlay, boxOf, intersectVisible, clearOverlay, mountOverlayNode, applyBox } from './overlay.js';

const SHAPES = [['circle', '圆形'], ['rounded', '圆角'], ['square', '方形']];

function kindLabel(kind) {
  if (kind === 'avatar') return '头像';
  if (kind === 'school') return '校徽';
  return '图片';
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('无法读取这张图片'));
    img.src = src;
  });
}

function fileFromEvent(e) {
  const items = e.clipboardData?.items || e.dataTransfer?.items;
  if (items) {
    for (const it of items) if (it.type && it.type.startsWith('image/')) return it.getAsFile();
  }
  const files = e.dataTransfer?.files || e.target?.files;
  if (files && files[0] && files[0].type.startsWith('image/')) return files[0];
  return null;
}

export function applyMediaToDoc(rd, { kind, url, name, shape }) {
  const doc = rd.doc;
  if (!doc) return;
  if (kind === 'avatar') {
    doc.querySelectorAll('.user').forEach((user) => {
      user.classList.remove('rp-no-avatar');
      user.classList.add('avatar');
      const img = user.querySelector('.user-avatar-image') || user.querySelector('.user-avatar img');
      if (!img) return;
      img.setAttribute('data-rp-asset', name);
      if (shape) img.setAttribute('data-rp-shape', shape);
      img.src = url;
    });
  } else if (kind === 'school') {
    doc.querySelectorAll('.user').forEach((user) => {
      user.classList.remove('rp-no-school');
      user.classList.add('school-logo');
      const img = user.querySelector('.user-school img') || user.querySelector('.user-school');
      if (!img || img.tagName !== 'IMG') return;
      img.setAttribute('data-rp-asset', name);
      if (shape) img.setAttribute('data-rp-shape', shape);
      img.src = url;
    });
  } else if (String(kind).startsWith('edu-')) {
    const id = kind.slice(4);
    ensureEduCrests(doc);
    doc.querySelectorAll('.section-item-container').forEach((item) => {
      if ((item.getAttribute('id') || item.dataset.id) !== id) return;
      let img = item.querySelector('img.edu-crest');
      if (!img) {
        img = doc.createElement('img');
        img.className = 'edu-crest';
        const left = item.querySelector('.menu-title .left') || item.querySelector('.menu-title');
        left?.insertBefore(img, left.firstChild);
      }
      img.setAttribute('data-rp-asset', name);
      if (shape) img.setAttribute('data-rp-shape', shape);
      img.src = url;
    });
  }
  try { rd.syncFrom(rd.primary()); } catch { /* 预览未就绪 */ }
  try { rd.paginate(); } catch { /* ignore */ }
}

export function removeMediaFromDoc(rd, kind) {
  const doc = rd.doc;
  if (!doc) return;
  if (kind === 'avatar') {
    doc.querySelectorAll('.user').forEach((user) => {
      user.classList.add('rp-no-avatar');
      user.classList.remove('avatar');
      const img = user.querySelector('.user-avatar-image, .user-avatar img');
      if (img) { img.removeAttribute('data-rp-asset'); img.removeAttribute('src'); }
    });
  } else if (kind === 'school') {
    doc.querySelectorAll('.user').forEach((user) => {
      user.classList.add('rp-no-school');
      user.classList.remove('school-logo');
      const img = user.querySelector('.user-school img');
      if (img) { img.removeAttribute('data-rp-asset'); img.removeAttribute('src'); }
    });
  } else if (String(kind).startsWith('edu-')) {
    const id = kind.slice(4);
    doc.querySelectorAll('.section-item-container').forEach((item) => {
      if ((item.getAttribute('id') || item.dataset.id) !== id) return;
      item.querySelectorAll('img.edu-crest').forEach((img) => img.remove());
    });
  }
  try { rd.syncFrom(rd.primary()); } catch { /* ignore */ }
  try { rd.paginate(); } catch { /* ignore */ }
}

export function ensureEduCrests(_doc) {
  // 4.1：不再在教育经历条目里放校徽
}

export function stripEduCrests(doc) {
  if (!doc) return;
  doc.querySelectorAll('img.edu-crest, .rp-add-crest, .rp-media-bar, [data-rp-chrome]').forEach((e) => e.remove());
  doc.querySelectorAll('.edu-crest-host').forEach((e) => e.classList.remove('edu-crest-host'));
}

function hasAsset(img) {
  return !!(img && img.getAttribute('data-rp-asset'));
}

export function bindResumeMedia(rd, slug, { onChange, onSave } = {}) {
  const doc = rd.doc;
  if (!doc) return;
  stripEduCrests(doc);
  rd.stripLegacyChrome?.();

  const iframe = rd.iframe;
  const ov = getOverlay(iframe);
  if (!ov) return;

  const openFor = (kind, file, mode) => openMediaModal({ rd, slug, kind, file, mode, onChange, onSave });

  const paint = () => {
    clearOverlay(ov.layer, 'rp-media-ph');
    clearOverlay(ov.layer, 'rp-media-ovbar');
    if (!rd.editable) return;
    const user = rd.primary()?.querySelector('.user');
    if (!user) return;
    const place = (kind, anchor, label) => {
      const box = intersectVisible(boxOf(anchor, iframe, ov.wrap), iframe, ov.wrap);
      if (!box) return;
      const ph = mountOverlayNode(ov.layer, 'rp-media-ph');
      ph.textContent = label;
      ph.title = label;
      applyBox(ph, box);
      ph.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openFor(kind, null, 'pick'); };
    };
    const avatarImg = user.querySelector('.user-avatar-image, .user-avatar img');
    const schoolImg = user.querySelector('.user-school img');
    const avHost = user.querySelector('.user-avatar') || user;
    const scHost = user.querySelector('.user-school');
    if (!hasAsset(avatarImg)) {
      const anchor = avHost && avHost.getBoundingClientRect().width > 8 ? avHost : user;
      const box = intersectVisible(boxOf(anchor, iframe, ov.wrap), iframe, ov.wrap);
      if (box) {
        // 没有头像时在页眉左侧放占位
        const w = Math.min(86, Math.max(56, box.height));
        place('avatar', anchor, '+ 添加头像');
        const last = ov.layer.querySelector('.rp-media-ph:last-child');
        if (last) applyBox(last, { left: box.left, top: box.top, width: w, height: box.height });
      }
    }
    if (!hasAsset(schoolImg)) {
      const ubox = intersectVisible(boxOf(user, iframe, ov.wrap), iframe, ov.wrap);
      if (ubox) {
        const w = Math.min(96, Math.max(64, ubox.height * 0.7));
        const ph = mountOverlayNode(ov.layer, 'rp-media-ph');
        ph.textContent = '+ 添加校徽';
        ph.title = '在页眉右上角添加校徽（仅编辑态可见，不进 PDF）';
        applyBox(ph, { left: ubox.left + ubox.width - w - 4, top: ubox.top + 6, width: w, height: Math.min(w, ubox.height - 12) });
        ph.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openFor('school', null, 'pick'); };
      }
    }
  };

  const showBar = (kind, host) => {
    if (!rd.editable) return;
    const box = intersectVisible(boxOf(host, iframe, ov.wrap), iframe, ov.wrap);
    if (!box) return;
    clearOverlay(ov.layer, 'rp-media-ovbar');
    const bar = mountOverlayNode(ov.layer, 'rp-ov-bar rp-media-ovbar');
    bar.innerHTML = '<button type="button" data-a="replace">更换</button><button type="button" data-a="edit">编辑</button><button type="button" data-a="del" class="danger">删除</button>';
    bar.style.width = 'auto';
    bar.style.height = 'auto';
    // 放在图片内部底部居中：鼠标从图片移到工具栏不会经过别的元素，不会被收起
    const wr = ov.wrap.getBoundingClientRect();
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    bar.style.left = Math.max(2, Math.min(wr.width - bw - 2, box.left + (box.width - bw) / 2)) + 'px';
    bar.style.top = Math.max(2, box.top + box.height - bh - 4) + 'px';
    bar.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
    bar.onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      e.preventDefault(); e.stopPropagation();
      if (a === 'del') return removeMedia(rd, slug, kind, onChange, onSave).then(paint);
      openFor(kind, null, a === 'replace' ? 'pick' : 'edit');
    };
  };

  if (!doc._rpMediaBound) {
    doc._rpMediaBound = true;
    doc.addEventListener('paste', (e) => {
      const file = fileFromEvent(e);
      if (!file) return;
      e.preventDefault();
      const kind = e.target?.closest?.('.user-school') ? 'school' : 'avatar';
      openFor(kind, file, 'edit');
    });
    doc.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    doc.addEventListener('drop', (e) => {
      const file = fileFromEvent(e);
      if (!file) return;
      e.preventDefault();
      const kind = e.target?.closest?.('.user-school') ? 'school' : 'avatar';
      openFor(kind, file, 'edit');
    });
    doc.addEventListener('mouseover', (e) => {
      if (!rd.editable) return;
      if (e.target.closest?.('.user-avatar') && hasAsset(doc.querySelector('.user-avatar-image'))) showBar('avatar', e.target.closest('.user-avatar'));
      else if (e.target.closest?.('.user-school') && hasAsset(doc.querySelector('.user-school img'))) showBar('school', e.target.closest('.user-school'));
      else clearOverlay(ov.layer, 'rp-media-ovbar');
    });
  }
  iframe._rpPaintMedia = paint;
  if (!rd._rpMediaLayoutHooked) {
    rd._rpMediaLayoutHooked = true;
    const prev = rd.onLayout;
    rd.onLayout = (info) => { prev?.(info); iframe._rpPaintMedia?.(); };
    window.addEventListener('resize', () => iframe._rpPaintMedia?.());
  }
  paint();
}

async function removeMedia(rd, slug, kind, onChange, onSave) {
  if (!(await confirmDialog('删除这份' + kindLabel(kind) + '？简历布局会自动收拢。', { ok: '删除', danger: true }))) return;
  try {
    await del('/api/resumes/' + encodeURIComponent(slug) + '/assets/' + encodeURIComponent(kind));
    removeMediaFromDoc(rd, kind);
    onChange?.();
    await onSave?.();
    toast('已删除' + kindLabel(kind));
  } catch (err) { toast(err.message, 'err'); }
}

export async function openMediaModal({ rd, slug, kind, file, mode, onChange, onSave }) {
  const isAvatar = kind === 'avatar';
  const state = { img: null, zoom: 1, x: 0, y: 0, ratio: isAvatar ? '3:4' : '1:1', shape: 'circle', dragging: false, sx: 0, sy: 0, ox: 0, oy: 0 };
  if (kind === 'school' || String(kind).startsWith('edu-')) state.shape = 'square';

  const existing = currentImg(rd, kind);
  if (existing?.getAttribute('data-rp-shape')) state.shape = existing.getAttribute('data-rp-shape');

  const body = el('<div class="media-editor"><div class="media-stage" tabindex="0"><canvas></canvas><div class="media-drop muted small">点击选择、拖拽到此处，或 Ctrl+V 粘贴图片</div></div><div class="media-side"><div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn sm" data-a="pick">' + icon('file') + '选择文件</button><input type="file" accept="image/*" hidden></div><div class="field" data-ratio><label>裁剪比例</label><div class="btn-group compact" data-r></div></div><div class="field"><label>缩放 <span data-zv>100%</span></label><input type="range" min="100" max="300" value="100" data-zoom></div><div class="field"><label>形状</label><div class="btn-group compact" data-s></div></div><div class="field"><label>常用' + kindLabel(kind === 'school' || String(kind).startsWith('edu-') ? 'school' : 'avatar') + '</label><div class="media-lib" data-lib></div></div><div class="row" style="gap:8px"><button type="button" class="btn sm ghost" data-a="save-lib">保存到常用库</button></div><div class="hint">图片会压缩后存到本份简历的 assets 目录，不会把大图写进正文。</div></div></div>');

  const ratios = isAvatar ? [['3:4', '证件照 3:4'], ['1:1', '正方形 1:1']] : [['1:1', '正方形 1:1'], ['3:4', '3:4']];
  body.querySelector('[data-r]').innerHTML = ratios.map((r) => '<button type="button" class="' + (state.ratio === r[0] ? 'active' : '') + '" data-ratio="' + r[0] + '">' + r[1] + '</button>').join('');
  body.querySelector('[data-s]').innerHTML = SHAPES.map((s) => '<button type="button" class="' + (state.shape === s[0] ? 'active' : '') + '" data-shape="' + s[0] + '">' + s[1] + '</button>').join('');

  const canvas = body.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const stage = body.querySelector('.media-stage');
  const dropHint = body.querySelector('.media-drop');
  const fileInput = body.querySelector('input[type=file]');

  const viewSize = () => {
    const [a, b] = state.ratio.split(':').map(Number);
    const w = 280;
    return { w, h: Math.round(w * b / a) };
  };

  const paint = () => {
    const { w, h } = viewSize();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.dataset.shape = state.shape;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, 0, w, h);
    if (!state.img) { dropHint.style.display = ''; return; }
    dropHint.style.display = 'none';
    const cover = Math.max(w / state.img.naturalWidth, h / state.img.naturalHeight);
    const scale = cover * state.zoom;
    const dw = state.img.naturalWidth * scale;
    const dh = state.img.naturalHeight * scale;
    const maxX = Math.max(0, (dw - w) / 2);
    const maxY = Math.max(0, (dh - h) / 2);
    state.x = Math.max(-maxX, Math.min(maxX, state.x));
    state.y = Math.max(-maxY, Math.min(maxY, state.y));
    const dx = (w - dw) / 2 + state.x;
    const dy = (h - dh) / 2 + state.y;
    ctx.save();
    if (state.shape === 'circle') { ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, Math.PI * 2); ctx.clip(); }
    else if (state.shape === 'rounded') { const r = Math.min(w, h) * 0.12; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, w, h, r) : ctx.rect(0, 0, w, h); ctx.clip(); }
    ctx.drawImage(state.img, dx, dy, dw, dh);
    ctx.restore();
  };

  const setFile = async (f) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    try {
      state.img = await loadImage(url);
      state.zoom = 1; state.x = 0; state.y = 0;
      paint();
    } finally { URL.revokeObjectURL(url); }
  };

  body.querySelector('[data-a="pick"]').onclick = () => fileInput.click();
  fileInput.onchange = () => setFile(fileInput.files[0]);
  stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('over'); });
  stage.addEventListener('dragleave', () => stage.classList.remove('over'));
  stage.addEventListener('drop', (e) => { e.preventDefault(); stage.classList.remove('over'); setFile(fileFromEvent(e)); });
  const onPaste = (e) => { const f = fileFromEvent(e); if (f) { e.preventDefault(); setFile(f); } };
  document.addEventListener('paste', onPaste);

  stage.addEventListener('mousedown', (e) => {
    if (!state.img) return;
    state.dragging = true; state.sx = e.clientX; state.sy = e.clientY; state.ox = state.x; state.oy = state.y;
  });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', () => { state.dragging = false; });
  function onMove(e) {
    if (!state.dragging) return;
    state.x = state.ox + (e.clientX - state.sx);
    state.y = state.oy + (e.clientY - state.sy);
    paint();
  }

  body.querySelector('[data-r]').onclick = (e) => {
    const b = e.target.closest('[data-ratio]'); if (!b) return;
    state.ratio = b.dataset.ratio;
    body.querySelectorAll('[data-ratio]').forEach((x) => x.classList.toggle('active', x === b));
    paint();
  };
  body.querySelector('[data-s]').onclick = (e) => {
    const b = e.target.closest('[data-shape]'); if (!b) return;
    state.shape = b.dataset.shape;
    body.querySelectorAll('[data-shape]').forEach((x) => x.classList.toggle('active', x === b));
    paint();
  };
  const zoomEl = body.querySelector('[data-zoom]');
  zoomEl.oninput = () => { state.zoom = Number(zoomEl.value) / 100; body.querySelector('[data-zv]').textContent = zoomEl.value + '%'; paint(); };

  const libBox = body.querySelector('[data-lib]');
  const libKind = kind === 'avatar' ? 'avatar' : 'school';
  const loadLib = async () => {
    try {
      const { items } = await get('/api/media-library?kind=' + libKind);
      if (!items.length) { libBox.innerHTML = '<span class="muted small">暂无，裁剪后可保存到常用库</span>'; return; }
      libBox.innerHTML = items.map((it) => '<button type="button" class="media-lib-item" data-id="' + it.id + '" title="' + (it.title || '') + '"><img src="/api/media-library/' + it.id + '" alt=""></button>').join('');
    } catch { libBox.innerHTML = ''; }
  };
  loadLib();
  libBox.onclick = async (e) => {
    const b = e.target.closest('[data-id]'); if (!b) return;
    try {
      const r = await post('/api/resumes/' + encodeURIComponent(slug) + '/assets', { kind, fromLibrary: b.dataset.id });
      const url = r.url + '?t=' + Date.now();
      applyMediaToDoc(rd, { kind, url, name: r.name, shape: state.shape });
      onChange?.();
      await onSave?.();
      toast('已套用常用' + kindLabel(kind));
      m.close();
    } catch (err) { toast(err.message, 'err'); }
  };

  body.querySelector('[data-a="save-lib"]').onclick = async () => {
    try {
      const data = await exportCrop(state, kind);
      await post('/api/media-library', { kind: libKind, title: kindLabel(kind), data: data.data });
      toast('已加入常用库');
      loadLib();
    } catch (err) { toast(err.message, 'err'); }
  };

  const m = modal({
    title: '编辑' + kindLabel(kind),
    body, width: 720,
    onClose: () => { document.removeEventListener('paste', onPaste); window.removeEventListener('mousemove', onMove); },
    actions: [
      { label: '取消' },
      { label: '应用', cls: 'primary', icon: 'check', onClick: async () => {
        const data = await exportCrop(state, kind);
        const r = await post('/api/resumes/' + encodeURIComponent(slug) + '/assets', { kind, mime: data.mime, data: data.data });
        applyMediaToDoc(rd, { kind, url: r.url + '?t=' + Date.now(), name: r.name, shape: state.shape });
        onChange?.();
        await onSave?.();
        toast(kindLabel(kind) + '已更新');
      } },
    ],
  });

  paint();
  if (file) setFile(file);
  else if (existing && existing.getAttribute('data-rp-asset') && existing.src && !existing.src.startsWith('data:image/svg')) {
    loadImage(existing.src).then((img) => { state.img = img; paint(); }).catch(() => {});
  }
  setTimeout(() => stage.focus(), 40);
}

function currentImg(rd, kind) {
  const doc = rd?.doc;
  if (!doc) return null;
  if (kind === 'avatar') return doc.querySelector('.user-avatar-image, .user-avatar img');
  if (kind === 'school') return doc.querySelector('.user-school img');
  if (String(kind).startsWith('edu-')) {
    const id = kind.slice(4);
    return [...doc.querySelectorAll('.section-item-container')].find((n) => (n.getAttribute('id') || n.dataset.id) === id)?.querySelector('img.edu-crest');
  }
  return null;
}

async function exportCrop(state, kind) {
  if (!state.img) throw new Error('请先选择一张图片');
  const { w, h } = (() => {
    const [a, b] = state.ratio.split(':').map(Number);
    return { w: 280, h: Math.round(280 * b / a) };
  })();
  const cover = Math.max(w / state.img.naturalWidth, h / state.img.naturalHeight);
  const scale = cover * state.zoom;
  const dw = state.img.naturalWidth * scale;
  const dh = state.img.naturalHeight * scale;
  const dx = (w - dw) / 2 + state.x;
  const dy = (h - dh) / 2 + state.y;
  const max = kind === 'avatar' ? 600 : 400;
  const outW = w >= h ? max : Math.round(max * w / h);
  const outH = h >= w ? max : Math.round(max * h / w);
  const out = document.createElement('canvas');
  out.width = outW; out.height = outH;
  const c = out.getContext('2d');
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  c.drawImage(state.img, dx * outW / w, dy * outH / h, dw * outW / w, dh * outH / h);
  const mime = kind === 'avatar' ? 'image/jpeg' : 'image/png';
  const blob = await new Promise((resolve) => out.toBlob(resolve, mime, 0.9));
  if (!blob) throw new Error('导出图片失败');
  return { mime, data: await blobToDataUrl(blob) };
}
