import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ASSETS_DIR, OUT_DIR } from './config.mjs';
import { listResumes, readBody, writeBody, resolveSlug, readMeta } from './store.mjs';
import { renderHtml } from './render.mjs';
import { assetsDir } from './media.mjs';
import { printPdfAuto } from './pdf.mjs';

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

const BAR_CSS = `
.editor-bar { position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
  display: flex; gap: 8px; align-items: center; padding: 8px 12px;
  background: #1b1b1f; color: #eee; font: 13px/1.4 system-ui, "Microsoft YaHei", sans-serif;
  box-shadow: 0 2px 10px rgba(0,0,0,.35); }
.editor-bar select, .editor-bar button { font: inherit; padding: 5px 10px; border-radius: 5px;
  border: 1px solid #3a3a42; background: #2a2a32; color: #eee; cursor: pointer; }
.editor-bar button:hover { background: #3a3a45; }
.editor-bar .spacer { flex: 1; }
.editor-bar .status { opacity: .75; max-width: 46vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
body { padding-top: 44px !important; }
#cv-container:focus { outline: none; }
@media print { .editor-bar { display: none !important; } body { padding-top: 0 !important; } }
`;

function editorBar(slugs, slug) {
  const options = slugs.map((s) => '<option value="' + s + '"'
    + (s === slug ? ' selected' : '') + '>' + s + '</option>').join('');
  return '<div class="editor-bar">'
    + '<strong>简历编辑</strong>'
    + '<select id="resume-switch">' + options + '</select>'
    + '<button id="save">保存 (Ctrl+S)</button>'
    + '<button id="pdf">导出 PDF</button>'
    + '<span class="spacer"></span>'
    + '<span class="status" id="status">修改后按 Ctrl+S</span>'
    + '</div>';
}

function editorScript(slug) {
  return '<script>\n'
    + '(function () {\n'
    + '  var slug = ' + JSON.stringify(slug) + ';\n'
    + '  var statusEl = document.getElementById("status");\n'
    + '  function setStatus(text) { statusEl.textContent = text; }\n'
    + '  function editable() { return document.getElementById("cv-container"); }\n'
    + '  async function save() {\n'
    + '    setStatus("保存中…");\n'
    + '    var node = editable().cloneNode(true);\n'
    + '    node.removeAttribute("contenteditable");\n'
    + '    node.removeAttribute("spellcheck");\n'
    + '    var res = await fetch("/save?name=" + encodeURIComponent(slug), {\n'
    + '      method: "POST", headers: { "content-type": "application/json" },\n'
    + '      body: JSON.stringify({ html: node.outerHTML }),\n'
    + '    });\n'
    + '    var data = await res.json();\n'
    + '    setStatus(data.ok ? "已保存 " + data.bytes + " 字节 · " + data.pages + " 页 · " + data.at : "保存失败：" + data.error);\n'
    + '  }\n'
    + '  async function exportPdf() {\n'
    + '    setStatus("导出 PDF…");\n'
    + '    var res = await fetch("/pdf?name=" + encodeURIComponent(slug), { method: "POST" });\n'
    + '    var data = await res.json();\n'
    + '    setStatus(data.ok ? "已导出 " + data.pdfPath : "导出失败：" + data.error);\n'
    + '  }\n'
    + '  document.getElementById("save").addEventListener("click", save);\n'
    + '  document.getElementById("pdf").addEventListener("click", exportPdf);\n'
    + '  document.getElementById("resume-switch").addEventListener("change", function (e) {\n'
    + '    location.href = "/?name=" + encodeURIComponent(e.target.value);\n'
    + '  });\n'
    + '  document.addEventListener("keydown", function (e) {\n'
    + '    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }\n'
    + '  });\n'
    + '  editable().setAttribute("contenteditable", "true");\n'
    + '  editable().setAttribute("spellcheck", "false");\n'
    + '})();\n'
    + '</script>\n';
}

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function sendFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 40 * 1024 * 1024) reject(new Error('请求体过大'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function pageHtml(slug) {
  const slugs = listResumes().map((r) => r.slug);
  const body = readBody(slug);
  return renderHtml({
    body,
    title: slug,
    fontHref: '/assets/fonts.css',
    extraHead: '<style>' + BAR_CSS + '</style>\n',
    extraBody: editorBar(slugs, slug) + '\n' + editorScript(slug),
    meta: readMeta(slug),
    assetBase: '/api/resumes/' + encodeURIComponent(slug) + '/assets/',
  });
}

function openInBrowser(url) {
  const platform = process.platform;
  const cmd = platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : platform === 'darwin' ? ['open', [url]]
      : ['xdg-open', [url]];
  try {
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
  } catch {
    console.log('请手动打开：' + url);
  }
}

export function startEditor({ name, port = 4321, open = true } = {}) {
  const initial = resolveSlug(name);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const name = url.searchParams.get('name');

    try {
      if (req.method === 'GET' && url.pathname === '/') {
        const slug = name ? resolveSlug(name) : initial;
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(pageHtml(slug));
        return;
      }

      if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
        const rel = decodeURIComponent(url.pathname.slice('/assets/'.length));
        const target = path.resolve(ASSETS_DIR, rel);
        if (!target.startsWith(ASSETS_DIR + path.sep)) {
          res.writeHead(403);
          res.end('forbidden');
          return;
        }
        sendFile(res, target);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/save') {
        const slug = resolveSlug(name);
        const payload = JSON.parse(await readRequestBody(req) || '{}');
        const html = (payload.html || '').trim();
        if (!html.includes('id="cv-container"')) throw new Error('内容里没有 #cv-container，拒绝写入');
        writeBody(slug, html + '\n');
        sendJson(res, 200, {
          ok: true,
          bytes: Buffer.byteLength(html),
          pages: (html.match(/data-resume-page=/g) || []).length,
          at: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/pdf') {
        const slug = resolveSlug(name);
        const htmlPath = path.join(OUT_DIR, slug + '.html');
        const pdfPath = path.join(OUT_DIR, slug + '.pdf');
        fs.mkdirSync(OUT_DIR, { recursive: true });
        fs.writeFileSync(htmlPath, renderHtml({
          body: readBody(slug),
          title: slug,
          fontHref: pathToFileURL(path.join(ASSETS_DIR, 'fonts.css')).href,
          meta: readMeta(slug),
          assetBase: pathToFileURL(assetsDir(slug)).href + '/',
        }), 'utf8');
        const { bytes } = await printPdfAuto({ htmlPath, pdfPath });
        sendJson(res, 200, { ok: true, pdfPath: path.relative(process.cwd(), pdfPath) || pdfPath, bytes });
        return;
      }

      res.writeHead(404);
      res.end('not found');
    } catch (error) {
      if (url.pathname === '/save' || url.pathname === '/pdf') sendJson(res, 500, { ok: false, error: error.message });
      else {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(error.message);
      }
    }
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error('端口 ' + port + ' 被占用，换一个：node cli.mjs edit ' + initial + ' --port ' + (port + 1));
      process.exit(1);
    }
    throw error;
  });

  server.listen(port, '127.0.0.1', () => {
    const url = 'http://127.0.0.1:' + port + '/?name=' + encodeURIComponent(initial);
    console.log('编辑「' + initial + '」：' + url);
    console.log('Ctrl+C 结束服务');
    if (open) openInBrowser(url);
  });

  return server;
}
