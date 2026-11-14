// v4.1 截图：结构树、悬停工具栏、诊断引用 chip、校徽占位；结构操作后 7 套模板预览 + PDF
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { launch } from './browser.mjs';
import { listTemplates, normalizeStyle } from '../lib/templates.mjs';
import { renderHtml } from '../lib/render.mjs';
import { printPdfAuto } from '../lib/pdf.mjs';
import { readBody, readMeta, writeMeta, hasResume } from '../lib/store.mjs';
import { assetsDir } from '../lib/media.mjs';
import { ASSETS_DIR } from '../lib/config.mjs';

const OUT = process.argv[2] || '/workspace/shots/v4.1';
const PORT = process.argv[3] || '4399';
const B = 'http://127.0.0.1:' + PORT + '/';
const SLUG = process.argv[4] || '张明';
const PDF_DIR = process.argv[5] || '/tmp/v41-pdf';

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(PDF_DIR, { recursive: true });
if (!hasResume(SLUG)) throw new Error('找不到简历：' + SLUG);

const enc = encodeURIComponent;

function exportPdf(slug, template, destPdf) {
  writeMeta(slug, { ...readMeta(slug), ...normalizeStyle({ ...readMeta(slug), template }) });
  const htmlPath = destPdf.replace(/\.pdf$/, '.html');
  fs.writeFileSync(htmlPath, renderHtml({
    body: readBody(slug),
    title: slug,
    fontHref: pathToFileURL(path.join(ASSETS_DIR, 'fonts.css')).href,
    meta: normalizeStyle(readMeta(slug)),
    assetBase: pathToFileURL(assetsDir(slug)).href + '/',
  }), 'utf8');
  return printPdfAuto({ htmlPath, pdfPath: destPdf });
}

function pdfToPng(pdf, prefix) {
  spawnSync('pdftoppm', ['-png', '-r', '110', '-f', '1', '-l', '1', pdf, prefix], { stdio: 'inherit' });
}

try {
  const ping = await fetch(B + 'api/health');
  if (!ping.ok) throw new Error('工作台未就绪');

  const ui = await launch({ width: 1600, height: 1000, scale: 1.25 });
  try {
    await ui.goto(B + '#/editor/' + enc(SLUG));
    await ui.waitFor('!!window.__rpRd && window.__rpRd.primary && window.__rpRd.primary()', 25000);
    await ui.sleep(800);

    // 切到编辑模式：结构树 + 校徽占位
    await ui.eval(`document.querySelector('#mode [data-m="edit"]')?.click()`);
    await ui.sleep(500);
    // 若已有校徽，先清掉以便拍摄占位
    await ui.eval(`(() => { const rd = window.__rpRd; const img = rd.doc.querySelector('.user-school img'); if (img && img.getAttribute('data-rp-asset')) { img.removeAttribute('data-rp-asset'); img.removeAttribute('src'); rd.primary().querySelector('.user')?.classList.add('rp-no-school'); } const frame = document.querySelector('#frame'); frame?._rpPaintMedia?.(); })()`);
    await ui.sleep(300);
    await ui.shot(path.join(OUT, 'structure-tree.png'));
    console.log('✓ structure-tree');

    const ph = await ui.eval(`(() => {
      const n = [...document.querySelectorAll('.rp-media-ph')].find((x) => /校徽/.test(x.textContent));
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return { x: Math.max(0, r.x - 80), y: Math.max(0, r.y - 40), width: Math.min(900, r.width + 200), height: Math.min(400, r.height + 160) };
    })()`);
    if (ph) await ui.shot(path.join(OUT, 'school-placeholder.png'), { x: ph.x, y: ph.y, width: ph.width, height: ph.height, scale: 1 });
    else await ui.shot(path.join(OUT, 'school-placeholder.png'));
    console.log('✓ school-placeholder', ph);

    // 悬停工具栏
    await ui.eval(`(() => {
      const rd = window.__rpRd;
      const it = rd.primary().querySelector('.section-item-container');
      it?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    })()`);
    await ui.sleep(400);
    const bar = await ui.eval(`(() => {
      const n = document.querySelector('.rp-struct-bar, .rp-ov-bar.rp-struct-bar, .rp-ov-bar');
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return { x: Math.max(0, r.x - 40), y: Math.max(0, r.y - 30), width: Math.min(1000, r.width + 280), height: Math.min(360, r.height + 180) };
    })()`);
    await ui.shot(path.join(OUT, 'hover-toolbar.png'), bar || undefined);
    console.log('✓ hover-toolbar', bar);

    // 结构操作后再拍一次树
    await ui.eval(`(() => { const rd = window.__rpRd; if (!rd.modules().some((m) => (m.type || m.id).startsWith('certificates'))) rd.addModule('certificates', { title: '证书' }); })()`);
    await ui.eval(`document.querySelector('#b-save')?.click()`);
    await ui.sleep(900);
    await ui.eval(`document.querySelector('#outline') && null`);
    // 触发 outline 刷新：调用页面里的按钮比较难，直接重绘树靠 onChanged 不一定走。保存后 reload? 简单：再点一下空白让我们手动 render — window 没有 renderOutline。
    await ui.eval(`document.querySelector('#ol-add-mod')`);
    await ui.sleep(200);

    // 诊断 + chip（演示模式）
    await ui.eval(`document.querySelector('#tabs [data-t=diag], #tabs button')?.click()`);
    await ui.sleep(300);
    const ran = await ui.eval(`(function(){ const b=[...document.querySelectorAll('button')].find(x=>/诊断/.test(x.textContent)); if(b){b.click();return true;} return false; })()`);
    if (ran) {
      try { await ui.waitFor("document.querySelector('.issue, .rp-ref') || document.querySelector('#agent-body')?.innerText.includes('分')", 35000); } catch { /* ignore */ }
      await ui.sleep(1200);
      // 滚到问题列表，尽量拍到引用 chip
      await ui.eval(`document.querySelector('.issue, .rp-ref')?.scrollIntoView({block:'center'})`);
      await ui.sleep(300);
    }
    await ui.shot(path.join(OUT, 'diagnose-chips.png'));
    console.log('✓ diagnose-chips');
  } finally {
    await ui.close();
  }

  console.log('== 结构操作后 7 套模板预览 + PDF ==');
  const p = await launch({ width: 920, height: 1280, scale: 1.25 });
  try {
    for (const t of listTemplates()) {
      writeMeta(SLUG, { ...readMeta(SLUG), ...normalizeStyle({ ...readMeta(SLUG), template: t.id }) });
      const url = B + 'preview/' + enc(SLUG) + '?t=' + Date.now();
      await p.goto(url);
      await p.waitFor("document.getElementById('cv-container')", 20000);
      try { await p.waitFor("document.documentElement.getAttribute('data-rp-paged') === '1'", 6000); } catch { /* still */ }
      await p.sleep(400);
      const file = path.join(OUT, 'tpl-struct-' + t.id + '.png');
      await p.shot(file);
      console.log('✓', path.basename(file));
      const pdf = path.join(PDF_DIR, t.id + '-struct.pdf');
      await exportPdf(SLUG, t.id, pdf);
      pdfToPng(pdf, path.join(OUT, 'pdf-struct-' + t.id));
      console.log('✓ pdf', t.id);
    }
  } finally {
    await p.close();
  }
  writeMeta(SLUG, { ...readMeta(SLUG), ...normalizeStyle({ ...readMeta(SLUG), template: 'classic' }) });
  console.log('done', OUT);
} catch (e) {
  console.error(e);
  process.exit(1);
}
