// 把编辑器工具栏画在简历 iframe 外面的 overlay 上，避免文字写进 body.html
export function getOverlay(iframe) {
  const wrap = iframe?.closest?.('#paper') || iframe?.parentElement;
  if (!wrap) return null;
  let layer = wrap.querySelector(':scope > .rp-page-overlay');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'rp-page-overlay';
    wrap.appendChild(layer);
  }
  return { wrap, layer };
}

export function iframeScale(iframe) {
  const w = iframe.getBoundingClientRect().width;
  return w / (iframe.offsetWidth || iframe.getBoundingClientRect().width || 794);
}

export function boxOf(el, iframe, wrap) {
  if (!el || !iframe) return null;
  const ir = iframe.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const z = iframeScale(iframe);
  return {
    left: ir.left - wr.left + r.left * z,
    top: ir.top - wr.top + r.top * z,
    width: r.width * z,
    height: r.height * z,
  };
}

export function intersectVisible(box, iframe, wrap) {
  if (!box) return null;
  const ir = iframe.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();
  const L = ir.left - wr.left, T = ir.top - wr.top, R = L + ir.width, B = T + ir.height;
  const l = Math.max(box.left, L), t = Math.max(box.top, T);
  const r = Math.min(box.left + box.width, R), b = Math.min(box.top + box.height, B);
  if (r - l < 8 || b - t < 8) return null;
  return { left: l, top: t, width: r - l, height: b - t };
}

export function clearOverlay(layer, cls) {
  if (!layer) return;
  [...layer.children].forEach((n) => { if (!cls || n.classList.contains(cls)) n.remove(); });
}

export function mountOverlayNode(layer, cls) {
  const n = document.createElement('div');
  n.className = cls;
  n.setAttribute('data-rp-overlay', '1');
  layer.appendChild(n);
  return n;
}

export function applyBox(node, box) {
  if (!node || !box) return;
  node.style.left = box.left + 'px';
  node.style.top = box.top + 'px';
  node.style.width = box.width + 'px';
  node.style.height = box.height + 'px';
}

// 元素在它所在那一页里真正可见的部分（iframe 文档坐标）。分页副本里同一条目会出现在多页，
// 被下一页覆盖层（.cover）遮住或超出内容区的部分不算。
export function visibleDocRect(el) {
  if (!el?.isConnected) return null;
  const r = el.getBoundingClientRect();
  let top = r.top, bottom = r.bottom;
  const page = el.closest?.('.main');
  const content = page?.querySelector('.content')?.getBoundingClientRect();
  if (content) {
    const cover = page.querySelector('.cover:not(.rs-cover-clear)');
    const ch = cover ? cover.getBoundingClientRect() : null;
    const coverTop = ch && ch.height > 0 ? ch.top : content.bottom;
    top = Math.max(top, content.top);
    bottom = Math.min(bottom, coverTop, content.bottom);
  }
  if (bottom - top < 4 || r.width < 4) return null;
  return { left: r.left, top, width: r.width, height: bottom - top };
}

// iframe 文档坐标 → overlay（#paper）坐标，计入 transform: scale 缩放
export function docRectToWrap(rect, iframe, wrap) {
  if (!rect) return null;
  const ir = iframe.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();
  const z = iframeScale(iframe);
  return { left: ir.left - wr.left + rect.left * z, top: ir.top - wr.top + rect.top * z, width: rect.width * z, height: rect.height * z };
}

// 操作栏位置：优先竖排停靠在纸张右侧留白（与选中框顶部对齐，不遮挡任何简历内容）；
// 右侧留白不够时放在选中框右下角外侧，再不行放右上角外侧 / 框内右上角。始终限制在可见范围内。
export function placeBar(box, size, bounds, gap = 4, gutter = 0, view = null) {
  const { width: bw, height: bh } = size;
  const W = bounds.width, H = bounds.height;
  // view：纸张在舞台里当前可见的区域（wrap 坐标）。放大后纸张比舞台宽时，右侧留白可能被滚出视野。
  const V = view || { left: 0, top: 0, right: W + gutter, bottom: H };
  const minL = Math.max(2, V.left + 2), maxL = Math.min(W - bw - 2, V.right - bw - 2);
  const minT = Math.max(2, V.top + 2), maxT = Math.min(H - bh - 2, V.bottom - bh - 2);
  if (gutter >= bw + gap && W + gap + bw <= V.right + 0.5) {
    const top = Math.max(minT, Math.min(box.top, maxT));
    return { left: W + gap, top, where: 'side' };
  }
  let left = box.left + box.width - bw;
  left = Math.max(minL, Math.min(left, maxL));
  let top = box.top + box.height + gap;
  let where = 'below';
  if (top + bh > H - 2) { top = box.top - bh - gap; where = 'above'; }
  if (top < 2) { top = Math.max(2, box.top + gap); where = 'inside'; }
  return { left, top, where };
}
