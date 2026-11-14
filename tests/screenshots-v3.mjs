// 为 v3 模板截图并导出 PDF。先启动工作台，再执行：
// 示例数据：先 node tests/demo-server.mjs <端口> 启动（examples/ 复制到临时 RESUME_HOME）
//   node tests/screenshots-v3.mjs /workspace/shots/v3 4399
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { launch } from './browser.mjs';
import { listTemplates, normalizeStyle } from '../lib/templates.mjs';
import { renderHtml } from '../lib/render.mjs';
import { printPdfAuto } from '../lib/pdf.mjs';
import { readBody, readMeta, writeMeta, hasResume } from '../lib/store.mjs';
import { ASSETS_DIR } from '../lib/config.mjs';

const OUT = process.argv[2] || '/workspace/shots/v3';
const PORT = process.argv[3] || '4399';
const B = 'http://127.0.0.1:' + PORT + '/';
const SLUG = process.argv[4] || '张明';
const PDF_DIR = process.argv[5] || '/tmp/v3-pdf';

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(PDF_DIR, { recursive: true });
if (!hasResume(SLUG)) throw new Error('找不到简历：' + SLUG);

const savedMeta = JSON.parse(JSON.stringify(readMeta(SLUG)));
const tpls = listTemplates();
const body = readBody(SLUG);

function patchStyle(template) {
  const t = tpls.find((x) => x.id === template);
  const cur = normalizeStyle({ ...readMeta(SLUG), template, theme: t?.theme || {} });
  writeMeta(SLUG, { ...readMeta(SLUG), template: cur.template, theme: cur.theme });
  return cur;
}

try {
  const ping = await fetch(B + 'api/templates');
  if (!ping.ok) throw new Error('工作台未就绪：' + ping.status + '，请先启动 node cli.mjs serve --port ' + PORT + ' --no-open');

  // 1) 各模板预览截图
  const p = await launch({ width: 920, height: 1280, scale: 1.5 });
  try {
    for (const t of tpls) {
      const cur = patchStyle(t.id);
      const url = B + 'preview/' + encodeURIComponent(SLUG) + '?t=' + Date.now();
      await p.goto(url);
      await p.waitFor("document.getElementById('cv-container')", 20000);
      try { await p.waitFor("document.documentElement.getAttribute('data-rp-paged') === '1'", 5000); } catch { /* 仍截图 */ }
      await p.sleep(700);
      const attr = await p.eval("document.documentElement.getAttribute('data-rp-theme')");
      await p.shot(path.join(OUT, 'tpl-' + t.id + '.png'));
      console.log('✓ tpl-' + t.id, 'theme=' + attr, 'accent=' + (cur.theme && cur.theme.accent));
    }
  } finally {
    await p.close();
  }

  // 2) 简历库 + 编辑器模板选择器
  const ui = await launch({ width: 1600, height: 1000, scale: 1.5 });
  try {
    patchStyle('classic');
    await ui.goto(B + '#/resumes');
    await ui.waitFor("document.querySelector('.resume-grid, .card, .page-head')", 20000);
    await ui.sleep(500);
    await ui.shot(path.join(OUT, 'library.png'));
    console.log('✓ library');

    await ui.goto(B + '#/editor/' + encodeURIComponent(SLUG));
    await ui.waitFor("document.querySelector('#b-tpl')", 20000);
    await ui.sleep(800);
    await ui.eval("document.querySelector('#b-tpl').click()");
    await ui.waitFor("document.querySelector('.tpl-grid, .tpl-card')", 10000);
    await ui.sleep(400);
    await ui.shot(path.join(OUT, 'template-picker.png'));
    console.log('✓ template-picker');
  } finally {
    await ui.close();
  }

  // 3) 每套模板导出 PDF（不经过会互相覆盖的 out/张明.pdf）
  for (const t of tpls) {
    const meta = normalizeStyle({ template: t.id, theme: t.theme || {} });
    const htmlPath = path.join(PDF_DIR, t.id + '.html');
    const pdfPath = path.join(PDF_DIR, t.id + '.pdf');
    const html = renderHtml({
      body,
      title: SLUG + '-' + t.id,
      fontHref: pathToFileURL(path.join(ASSETS_DIR, 'fonts.css')).href,
      meta,
    });
    fs.writeFileSync(htmlPath, html, 'utf8');
    const { bytes } = await printPdfAuto({ htmlPath, pdfPath });
    console.log('✓ pdf', t.id, bytes, 'bytes →', pdfPath);
  }
} finally {
  writeMeta(SLUG, savedMeta);
  console.log('已恢复', SLUG, '的 meta');
}
