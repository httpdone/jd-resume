// v4 截图与 7 套模板有图 / 删图后的预览、PDF 目视检查
// 用法：先启动工作台，再：node tests/screenshots-v4.mjs <shotsDir> <port> [slug] [pdfDir]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { launch } from './browser.mjs';
import { listTemplates, normalizeStyle } from '../lib/templates.mjs';
import { renderHtml } from '../lib/render.mjs';
import { printPdfAuto } from '../lib/pdf.mjs';
import { readBody, readMeta, writeMeta, writeBody, hasResume } from '../lib/store.mjs';
import { assetsDir } from '../lib/media.mjs';
import { ASSETS_DIR } from '../lib/config.mjs';

const OUT = process.argv[2] || '/workspace/shots/v4';
const PORT = process.argv[3] || '4399';
const B = 'http://127.0.0.1:' + PORT + '/';
const SLUG = process.argv[4] || '张明';
const PDF_DIR = process.argv[5] || '/tmp/v4-pdf';
const MEDIA = process.argv[6] || '/tmp/v4-media';

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(PDF_DIR, { recursive: true });
if (!hasResume(SLUG)) throw new Error('找不到简历：' + SLUG);

const enc = encodeURIComponent;
const api = async (method, url, body) => {
  const r = await fetch(B.replace(/\/$/, '') + url, { method, headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok && d.ok === false) throw new Error(d.error || url + ' ' + r.status);
  return d;
};
const toDataUrl = (file, mime) => 'data:' + mime + ';base64,' + fs.readFileSync(file).toString('base64');

async function applyAssets(withImages) {
  if (withImages) {
    const avatar = await api('POST', '/api/resumes/' + enc(SLUG) + '/assets', { kind: 'avatar', data: toDataUrl(path.join(MEDIA, 'avatar.png'), 'image/png') });
    const school = await api('POST', '/api/resumes/' + enc(SLUG) + '/assets', { kind: 'school', data: toDataUrl(path.join(MEDIA, 'school.png'), 'image/png') });
    let html = (await api('GET', '/api/resumes/' + enc(SLUG))).html;
    html = html.replace(/class="user-avatar-image"/g, 'class="user-avatar-image" data-rp-asset="' + avatar.name + '" data-rp-shape="circle"');
    html = html.replace(/(<img\b[^>]*class="user-avatar-image"[^>]*?)\ssrc="[^"]*"/g, '$1 src="assets/' + avatar.name + '"');
    html = html.replace(/class="user"([^>]*)\bavatar\b/g, 'class="user"$1avatar');
    html = html.replace(/\brp-no-avatar\b/g, '');
    // school logo img inside .user-school
    html = html.replace(/(<div[^>]*class="user-school"[^>]*>[\s\S]*?<img\b)([^>]*)>/, (m, a, rest) => {
      let tag = rest;
      if (/data-rp-asset=/.test(tag)) tag = tag.replace(/data-rp-asset="[^"]*"/, 'data-rp-asset="' + school.name + '"');
      else tag += ' data-rp-asset="' + school.name + '" data-rp-shape="square"';
      if (/\ssrc=/.test(tag)) tag = tag.replace(/\ssrc="[^"]*"/, ' src="assets/' + school.name + '"');
      else tag += ' src="assets/' + school.name + '"';
      return a + tag + '>';
    });
    html = html.replace(/\brp-no-school\b/g, '');
    await api('PUT', '/api/resumes/' + enc(SLUG), { html });
    return { avatar, school };
  }
  let html = (await api('GET', '/api/resumes/' + enc(SLUG))).html;
  html = html.replace(/class="user"/g, (m) => m);
  html = html.replace(/(<div[^>]*class="user"[^>]*)>/g, (m, a) => {
    let tag = a;
    if (!/\brp-no-avatar\b/.test(tag)) tag += ' class'.includes('x');
    // add flags on the user element itself
    return m;
  });
  // simpler: inject classes onto .user
  html = html.replace(/class="([^"]*\buser\b[^"]*)"/g, (m, cls) => {
    let c = cls.replace(/\brp-no-avatar\b/g, '').replace(/\brp-no-school\b/g, '').replace(/\bavatar\b/g, '').replace(/\bschool-logo\b/g, '');
    c += ' rp-no-avatar rp-no-school';
    return 'class="' + c.replace(/\s+/g, ' ').trim() + '"';
  });
  await api('PUT', '/api/resumes/' + enc(SLUG), { html });
  try { await api('DELETE', '/api/resumes/' + enc(SLUG) + '/assets/avatar'); } catch { /* ignore */ }
  try { await api('DELETE', '/api/resumes/' + enc(SLUG) + '/assets/school'); } catch { /* ignore */ }
}

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
  spawnSync('pdftoppm', ['-png', '-r', '110', pdf, prefix], { stdio: 'inherit' });
}

async function shotTemplates(page, tag) {
  const tpls = listTemplates();
  for (const t of tpls) {
    writeMeta(SLUG, { ...readMeta(SLUG), ...normalizeStyle({ ...readMeta(SLUG), template: t.id }) });
    const url = B + 'preview/' + enc(SLUG) + '?t=' + Date.now();
    await page.goto(url);
    await page.waitFor("document.getElementById('cv-container')", 20000);
    try { await page.waitFor("document.documentElement.getAttribute('data-rp-paged') === '1'", 6000); } catch { /* still shot */ }
    await page.sleep(500);
    const file = path.join(OUT, 'tpl-' + tag + '-' + t.id + '.png');
    await page.shot(file);
    console.log('✓', path.basename(file));
  }
}

try {
  const ping = await fetch(B + 'api/health');
  if (!ping.ok) throw new Error('工作台未就绪');

  console.log('== 有图：预览 7 套模板 ==');
  await applyAssets(true);
  const p = await launch({ width: 920, height: 1280, scale: 1.25 });
  try { await shotTemplates(p, 'with'); } finally { await p.close(); }

  console.log('== 有图：PDF ==');
  for (const t of listTemplates()) {
    const pdf = path.join(PDF_DIR, t.id + '-with.pdf');
    await exportPdf(SLUG, t.id, pdf);
    pdfToPng(pdf, path.join(OUT, 'pdf-' + t.id + '-with'));
    console.log('✓ pdf', t.id, 'with');
  }

  console.log('== UI 截图 ==');
  const ui = await launch({ width: 1600, height: 1000, scale: 1.25 });
  try {
    // crop modal
    writeMeta(SLUG, { ...readMeta(SLUG), ...normalizeStyle({ ...readMeta(SLUG), template: 'classic' }) });
    await ui.goto(B + '#/editor/' + enc(SLUG));
    await ui.waitFor("document.querySelector('#b-media')", 20000);
    await ui.sleep(1200);
    await ui.eval("document.querySelector('#b-media').click()");
    await ui.waitFor("document.querySelector('[data-k=\"avatar\"]')", 8000);
    await ui.eval("document.querySelector('[data-k=\"avatar\"]').click()");
    await ui.waitFor("document.querySelector('.media-editor')", 8000);
    await ui.sleep(600);
    await ui.shot(path.join(OUT, 'avatar-crop-modal.png'));
    console.log('✓ avatar-crop-modal');
    await ui.eval("document.querySelector('.modal-mask [data-x], .modal-foot .btn')?.click()");
    await ui.sleep(300);

    // diagnose if possible
    try {
      await ui.eval("document.querySelector('#tabs [data-t=diag], #tabs button')?.click()");
      await ui.sleep(200);
      const ran = await ui.eval(`(function(){ const b=[...document.querySelectorAll('button')].find(x=>/诊断/.test(x.textContent)); if(b){b.click();return true;} return false; })()`);
      if (ran) {
        try { await ui.waitFor("document.querySelector('.score, .diag, [data-score], .callout, .issues') || document.body.innerText.includes('分')", 25000); } catch { /* ignore */ }
        await ui.sleep(800);
      }
    } catch (e) { console.log('diagnose skip', e.message); }
    await ui.shot(path.join(OUT, 'editor-diagnose.png'));
    console.log('✓ editor-diagnose');

    // try rewrite tab
    try {
      await ui.eval("document.querySelector('#tabs [data-t=rewrite]')?.click()");
      await ui.sleep(400);
    } catch { /* ignore */ }
    await ui.shot(path.join(OUT, 'editor-rewrite.png'));
    console.log('✓ editor-rewrite');

    // library
    await ui.goto(B + '#/resumes');
    await ui.waitFor("document.querySelector('.resume-card, .page-head')", 15000);
    await ui.sleep(800);
    await ui.shot(path.join(OUT, 'library.png'));
    console.log('✓ library');

    // inline rename
    await ui.eval(`(function(){ const b=document.querySelector('.resume-name-row [data-a=rename-inline], .resume-name-row b'); if(b) b.click(); const name=document.querySelector('.resume-name'); if(name){ name.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); } })()`);
    await ui.sleep(400);
    await ui.waitFor("document.querySelector('.inline-rename')", 5000);
    await ui.shot(path.join(OUT, 'inline-rename.png'));
    console.log('✓ inline-rename');
    await ui.eval("document.querySelector('.inline-rename') && (document.querySelector('.inline-rename').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))");
    await ui.sleep(200);

    // dashboard
    await ui.goto(B + '#/dashboard');
    await ui.waitFor("document.querySelector('.page-head, .card')", 15000);
    await ui.sleep(600);
    await ui.shot(path.join(OUT, 'dashboard.png'));
    console.log('✓ dashboard');

    // JD
    await ui.goto(B + '#/jd');
    await ui.waitFor("document.querySelector('.jd-item, #jd-new, .page-head')", 15000);
    await ui.sleep(800);
    await ui.shot(path.join(OUT, 'jd.png'));
    console.log('✓ jd');
    // delete confirm
    const hasDel = await ui.eval("!!document.querySelector('.jd-del, [data-del]')");
    if (hasDel) {
      await ui.eval("document.querySelector('.jd-del, [data-del]').click()");
      await ui.waitFor("document.querySelector('.modal-mask')", 8000);
      await ui.sleep(300);
      await ui.shot(path.join(OUT, 'jd-delete-confirm.png'));
      console.log('✓ jd-delete-confirm');
      await ui.eval("document.querySelector('.modal-mask [data-x]')?.click()");
    }

    // templates picker
    await ui.goto(B + '#/editor/' + enc(SLUG));
    await ui.waitFor("document.querySelector('#b-tpl')", 15000);
    await ui.sleep(800);
    await ui.eval("document.querySelector('#b-tpl').click()");
    await ui.waitFor("document.querySelector('.tpl-grid, .tpl-card')", 8000);
    await ui.sleep(400);
    await ui.shot(path.join(OUT, 'template-picker.png'));
    console.log('✓ template-picker');
    await ui.eval("document.querySelector('.modal-mask [data-x]')?.click()");

    // apps calendar + kanban
    await ui.goto(B + '#/apps');
    await ui.waitFor("document.querySelector('#views')", 15000);
    await ui.sleep(400);
    await ui.eval("document.querySelector('#views [data-v=calendar]')?.click()");
    await ui.sleep(700);
    await ui.shot(path.join(OUT, 'apps-calendar.png'));
    console.log('✓ apps-calendar');
    await ui.eval("document.querySelector('#views [data-v=kanban]')?.click()");
    await ui.sleep(700);
    await ui.shot(path.join(OUT, 'apps-kanban.png'));
    console.log('✓ apps-kanban');

    // stories
    await ui.goto(B + '#/stories');
    await ui.waitFor("document.querySelector('.page-head')", 15000);
    await ui.sleep(700);
    await ui.shot(path.join(OUT, 'stories.png'));
    console.log('✓ stories');

    // mock interview
    await ui.goto(B + '#/mock');
    await ui.waitFor("document.querySelector('.page-head')", 15000);
    await ui.sleep(700);
    await ui.shot(path.join(OUT, 'mock-interview.png'));
    console.log('✓ mock-interview');

    // settings + model dropdown
    await ui.goto(B + '#/settings');
    await ui.waitFor("document.querySelector('#fetch-models')", 15000);
    await ui.sleep(400);
    await ui.eval(`(function(){ const u=document.querySelector('[name=baseUrl]'); const k=document.querySelector('[name=apiKey]'); if(u){u.value=u.value||location.origin.replace(/:\\d+$/, '') ;} })()`);
    // caller should have pre-filled settings; just click fetch
    await ui.eval("document.querySelector('#fetch-models').click()");
    try { await ui.waitFor("document.querySelector('.model-opt, #model-drop:not(.hide)')", 10000); } catch { /* fallback still shot */ }
    await ui.eval("document.querySelector('[name=model]')?.focus()");
    await ui.sleep(400);
    await ui.shot(path.join(OUT, 'model-list.png'));
    console.log('✓ model-list');
  } finally {
    await ui.close();
  }

  console.log('== 删图后：预览 + PDF ==');
  await applyAssets(false);
  const p2 = await launch({ width: 920, height: 1280, scale: 1.25 });
  try { await shotTemplates(p2, 'none'); } finally { await p2.close(); }
  for (const t of listTemplates()) {
    const pdf = path.join(PDF_DIR, t.id + '-none.pdf');
    await exportPdf(SLUG, t.id, pdf);
    pdfToPng(pdf, path.join(OUT, 'pdf-' + t.id + '-none'));
    console.log('✓ pdf', t.id, 'none');
  }

  // restore classic + images so later docs shots (already taken) stay consistent; sample in TEMP home only
  await applyAssets(true);
  writeMeta(SLUG, { ...readMeta(SLUG), ...normalizeStyle({ ...readMeta(SLUG), template: 'classic' }) });
  console.log('done', OUT);
} catch (e) {
  console.error(e);
  process.exit(1);
}
