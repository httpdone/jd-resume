// v4.2 浏览器测试：编辑态选中框 / 操作栏（7 套模板 × 多种缩放 × 高分屏），回车与删除合并不破坏版式
import { launch } from './browser.mjs';
import { probe } from './screenshots-v42.mjs';

const THEMES = ['classic', 'minimal', 'navy', 'tech', 'academic', 'international', 'colorband'];

const RECT = `(idx, sel) => {
  const f = document.querySelector('#frame'); const ir = f.getBoundingClientRect(); const z = ir.width / f.offsetWidth;
  const el = f.contentDocument.querySelectorAll(sel || '.content-scroll .section-item-container')[idx];
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect(); const ir2 = f.getBoundingClientRect();
  return { x: ir2.left + r.left * z, y: ir2.top + r.top * z, w: r.width * z, h: r.height * z, id: el.id, z };
}`;

async function openEditor(page, base, slug, zoom) {
  await page.goto(base + '/#/');
  await page.eval(zoom ? `localStorage.setItem('rp-zoom', '${zoom}')` : `localStorage.removeItem('rp-zoom')`);
  await page.goto(base + '/#/editor/' + encodeURIComponent(slug));
  await page.eval('location.reload()');
  await page.sleep(300);
  await page.waitFor('!!window.__rpRd && window.__rpRd.primary && window.__rpRd.primary() && document.querySelector("#mode [data-m=edit]")');
  await page.sleep(400);
  await page.eval(`document.querySelector('#mode [data-m="edit"]').click()`);
  await page.sleep(200);
}

// 选中第 idx 条并检查：唯一选中框、框与元素对齐、操作栏属于它且不压住别的条目、移过去不跳
async function checkSelect(page, idx) {
  const r = await page.eval('(' + RECT + ')(' + idx + ')');
  if (!r) return { skip: true };
  await page.sleep(80);
  const r2 = await page.eval('(' + RECT + ')(' + idx + ')');
  const st = await page.eval(`document.querySelector('#stage').getBoundingClientRect().toJSON()`);
  const px = Math.max(st.left + 12, Math.min(r2.x + Math.min(30, r2.w / 3), st.right - 60)), py = r2.y + Math.min(8, r2.h / 2);
  await page.click(px, py);
  await page.sleep(180);
  const p = await probe(page);
  const sel = await page.eval(`(() => { const s = document.querySelector('.rp-ov-sel'); if (!s) return null; const r = s.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, for: s.dataset.for }; })()`);
  const bar = p.bars[0];
  let stable = false;
  if (bar) {
    await page.move(bar.x + bar.w / 2, bar.y + Math.min(10, bar.h / 2), 10, { x: px, y: py });
    await page.sleep(120);
    const p2 = await probe(page);
    stable = p2.bars.length === 1 && p2.bars[0].for === r2.id && Math.abs(p2.bars[0].y - bar.y) < 1;
  }
  const aligned = sel && Math.abs(sel.x - (r2.x - 3 * 1)) < 6 && Math.abs(sel.w - (r2.w + 6)) < 8;
  return { id: r2.id, count: p.sel, barCount: p.bars.length, barFor: bar?.for, where: bar?.where, barY: bar?.y, under: bar?.under, aligned, stable, sel, r: r2 };
}

export async function runV42Browser({ ok, base, slug, j }) {
  const enc = encodeURIComponent;
  const page = await launch({ width: 1440, height: 960 });
  const problems = [];
  try {
    for (const theme of THEMES) {
      await j('PATCH', '/api/resumes/' + enc(slug) + '/meta', { template: theme });
      for (const zoom of [0, 0.7, 1.3]) {
        await openEditor(page, base, slug, zoom);
        const total = await page.eval(`document.querySelector('#frame').contentDocument.querySelectorAll('.content-scroll .section-item-container').length`);
        for (const idx of [1, 3, Math.max(0, total - 1)]) {
          const c = await checkSelect(page, idx);
          if (c.skip) continue;
          const bad = [];
          if (c.count !== 1) bad.push('选中框 ' + c.count + ' 个');
          if (c.barCount !== 1 || c.barFor !== c.id) bad.push('操作栏不属于当前条目');
          // 原 bug：操作栏跑到上一个框上。现在：停靠右侧留白时不压任何条目；放大后留白滚出视野才退到选中框下方
          if (c.where === 'side' && c.under) bad.push('操作栏压在条目上：' + c.under);
          if (c.where !== 'above' && c.sel && c.barY < c.sel.y - 1) bad.push('操作栏跑到选中框上方');
          if (!c.aligned) bad.push('选中框没对齐 ' + JSON.stringify({ sel: c.sel, r: c.r }));
          if (!c.stable) bad.push('鼠标移向操作栏时跳走');
          if (bad.length) problems.push(theme + '@' + (zoom || 'fit') + '#' + idx + '：' + bad.join('；'));
        }
        // 点空白处取消；Esc 取消
        const fr = await page.eval(`(() => { const r = document.querySelector('#frame').getBoundingClientRect(); return { x: r.left, y: r.top }; })()`);
        await page.click(Math.max(4, fr.x - 16), Math.max(80, fr.y + 40));
        await page.sleep(120);
        const afterOut = await probe(page);
        if (afterOut.sel || afterOut.bars.length) problems.push(theme + '@' + (zoom || 'fit') + '：点击简历外没有取消选中');
        await checkSelect(page, 1);
        await page.key('Escape', 'Escape', 27);
        await page.sleep(120);
        const afterEsc = await probe(page);
        if (afterEsc.sel || afterEsc.bars.length) problems.push(theme + '@' + (zoom || 'fit') + '：Esc 没有取消选中');
      }
    }
    ok('7 套模板 × 3 种缩放：只有一个选中框、操作栏锚定当前条目且不压别的条目、点外面 / Esc 能取消', !problems.length, problems.slice(0, 6).join(' | '));
    await j('PATCH', '/api/resumes/' + enc(slug) + '/meta', { template: 'classic' });
  } finally {
    await page.close();
  }

  // 高分屏（devicePixelRatio 2）+ 点在分页后第 2 页的条目
  const hi = await launch({ width: 1280, height: 900, scale: 2 });
  try {
    await openEditor(hi, base, slug, 0);
    const pages = await hi.eval(`window.__rpRd.pages().length`);
    const c = await checkSelect(hi, 2);
    let p2 = { ok: true };
    if (pages > 1) {
      // 第 2 页副本里的条目
      const idx = await hi.eval(`(() => { const d = document.querySelector('#frame').contentDocument; const all = [...d.querySelectorAll('.section-item-container')]; const p2 = d.querySelectorAll('.main')[1]; const loc = all.findIndex((e) => p2.contains(e) && window.__rpRd.locate(e.id)?.el === e); return loc; })()`);
      if (idx >= 0) {
        const r = await hi.eval('(' + RECT + ')(' + idx + ', ".section-item-container")');
        await hi.click(r.x + 20, r.y + Math.min(8, r.h / 2));
        await hi.sleep(150);
        const sel = await hi.eval(`(() => { const s = document.querySelector('.rp-ov-sel'); const r = s?.getBoundingClientRect(); return r ? { y: r.top, h: r.height, for: s.dataset.for } : null; })()`);
        p2 = { ok: !!sel && sel.for === r.id && Math.abs(sel.y - (r.y - 3)) < 8, sel, r };
      }
    }
    ok('高分屏下选中框与操作栏对齐；第 2 页的条目也框在第 2 页', c.count === 1 && c.aligned && c.stable && p2.ok, JSON.stringify({ c, p2 }).slice(0, 400));
  } finally {
    await hi.close();
  }

  // 回车与删除合并
  const ed = await launch({ width: 1440, height: 960 });
  try {
    const results = [];
    for (const theme of THEMES) {
      await j('PATCH', '/api/resumes/' + enc(slug) + '/meta', { template: theme });
      await openEditor(ed, base, slug, 0);
      const setCaret = (what) => ed.eval(`(() => {
        const d = document.querySelector('#frame').contentDocument;
        const it = [...d.querySelectorAll('.content-scroll .section-item-container')].find((x) => x.querySelector('li') && x.querySelectorAll('.menu-title').length > 1);
        if (!it) return null;
        window.__it = it.id;
        const node = ${'`'}${'$'}{what}${'`'} === 'desc' ? it.querySelectorAll('.menu-title')[1].querySelector('.left') : it.querySelector('li');
        const w = d.createTreeWalker(node, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.textContent.trim() ? 1 : 3 });
        const t = w.nextNode(); if (!t) return null;
        node.closest('[contenteditable=true]').focus();
        const r = d.createRange(); r.setStart(t, t.textContent.search(/\\S/)); r.collapse(true);
        const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
        return it.id;
      })()`.replace('${what}', what));
      const state = () => ed.eval(`(() => {
        const d = document.querySelector('#frame').contentDocument;
        const it = d.querySelector('.content-scroll [id="' + window.__it + '"]');
        const left = it.querySelectorAll('.menu-title')[1]?.querySelector('.left');
        // 描述行里的每个可见子项都应在同一列起始（横向文字流），而不是被拆成并排的几列
        const kids = left ? [...left.children].filter((c) => c.getBoundingClientRect().width > 0) : [];
        const cols = new Set(kids.map((c) => Math.round(c.getBoundingClientRect().left)));
        const runs = left ? [...left.childNodes].filter((n) => n.nodeType === 3 ? n.textContent.trim() : n.nodeType === 1).length : 0;
        return { lis: it.querySelectorAll('li').length, inLeft: left ? left.querySelectorAll('strong').length : 0, cols: cols.size, runs, flow: !!left?.querySelector('.rp-flow'), divs: it.querySelectorAll('.rp-flow > div:not([class])').length, styled: it.querySelectorAll('li strong[style]').length };
      })()`);
      // 1) 第一条 bullet 段首按退格：不能并进描述行（flex）
      if (!(await setCaret('li'))) continue;
      const s0 = await state();
      await ed.key('Backspace', 'Backspace', 8);
      await ed.sleep(80);
      const s1 = await state();
      // 2) 在 bullet 中间回车：新起一条 bullet
      for (let i = 0; i < 4; i++) await ed.key('ArrowRight', 'ArrowRight', 39);
      await ed.key('Enter', 'Enter', 13);
      await ed.sleep(80);
      const s2 = await state();
      // 3) 描述行中回车：插入换行，仍保持横向文字流（不拆成几列）
      await setCaret('desc');
      for (let i = 0; i < 4; i++) await ed.key('ArrowRight', 'ArrowRight', 39);
      await ed.key('Enter', 'Enter', 13);
      await ed.sleep(80);
      const s3 = await state();
      // 4) 模拟旧版本已经并坏的数据：把加粗塞进描述行，再回车，应自动归一化
      await ed.eval(`(() => { const d = document.querySelector('#frame').contentDocument; const it = d.querySelector('.content-scroll [id="' + window.__it + '"]'); const left = it.querySelectorAll('.menu-title')[1].querySelector('.left'); left.innerHTML = '描述文字。<strong>加粗要点</strong>：后续说明文字'; })()`);
      await setCaret('desc');
      for (let i = 0; i < 2; i++) await ed.key('ArrowRight', 'ArrowRight', 39);
      await ed.key('Enter', 'Enter', 13);
      await ed.sleep(80);
      const s4 = await state();
      const okTheme = s1.lis === s0.lis && s1.inLeft === 0 && s2.lis === s0.lis + 1 && s3.cols <= 1 && s3.runs <= 1 && s4.cols <= 1 && s4.runs <= 1 && s4.flow && !s4.divs;
      results.push({ theme, ok: okTheme, s0, s1, s2, s3, s4 });
      if (theme === 'classic') await ed.shot('/tmp/v42-enter-' + theme + '.png');
    }
    const bad = results.filter((r) => !r.ok);
    ok('7 套模板：段首退格不会把 bullet 并进描述行；bullet 内回车新起一条；描述行回车只换行、不被拆成竖排', results.length === 7 && !bad.length, JSON.stringify(bad[0] || results.length).slice(0, 500));
    // 改写面板有素材库选项
    await j('PATCH', '/api/resumes/' + enc(slug) + '/meta', { template: 'classic' });
    await openEditor(ed, base, slug, 0);
    await ed.eval(`document.querySelector('#tabs [data-t="rewrite"]').click()`);
    await ed.sleep(300);
    const ui = await ed.eval(`({ modes: [...document.querySelectorAll('#st-mode [data-sm]')].map((b) => b.dataset.sm), list: !!document.querySelector('#st-list') })`);
    ok('改写面板可选素材库（自动匹配 / 手动选择 / 不使用）', ui.modes.join() === 'auto,pick,off' && ui.list, JSON.stringify(ui));
  } finally {
    await ed.close();
  }
}
