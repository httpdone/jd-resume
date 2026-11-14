// 用 Chrome DevTools Protocol 打印 PDF（零依赖：自带一个最小 WebSocket 客户端）。
// 比 --print-to-pdf 更可控：会等字体加载完成；某些环境下 --print-to-pdf 会卡住，这里也能正常工作。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function wsConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(wsUrl);
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      host: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key },
    });
    req.on('error', reject);
    req.on('response', (res) => reject(new Error('WebSocket 握手失败：' + res.statusCode)));
    req.on('upgrade', (res, socket, head) => {
      const listeners = new Set();
      let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
      let frags = [];
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        for (;;) {
          if (buf.length < 2) return;
          const fin = (buf[0] & 0x80) !== 0;
          const op = buf[0] & 0x0f;
          let len = buf[1] & 0x7f;
          let off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          const masked = (buf[1] & 0x80) !== 0;
          const maskOff = off;
          if (masked) off += 4;
          if (buf.length < off + len) return;
          let payload = buf.subarray(off, off + len);
          if (masked) { const m = buf.subarray(maskOff, maskOff + 4); payload = Buffer.from(payload.map((b, i) => b ^ m[i % 4])); }
          buf = buf.subarray(off + len);
          if (op === 8) { socket.end(); return; }
          if (op === 9) { send(payload, 10); continue; }
          if (op === 1 || op === 2 || op === 0) {
            frags.push(Buffer.from(payload));
            if (fin) { const msg = Buffer.concat(frags).toString('utf8'); frags = []; for (const l of listeners) l(msg); }
          }
        }
      });
      function send(data, opcode = 1) {
        const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
        const len = payload.length;
        const header = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
        header[0] = 0x80 | opcode;
        if (len < 126) header[1] = 0x80 | len;
        else if (len < 65536) { header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
        else { header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); }
        const mask = crypto.randomBytes(4);
        const masked = Buffer.alloc(len);
        for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
        socket.write(Buffer.concat([header, mask, masked]));
      }
      resolve({ send: (s) => send(s), onMessage: (fn) => listeners.add(fn), close: () => { try { send(Buffer.alloc(0), 8); socket.end(); } catch { /* 忽略 */ } }, socket });
    });
    req.end();
  });
}

export function printPdfCdp({ htmlPath, pdfPath, browserPath, timeoutMs = 90000 }) {
  return new Promise((resolve, reject) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-cdp-'));
    const args = [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--disable-background-networking', '--disable-component-update', '--disable-sync', '--hide-scrollbars', '--mute-audio',
      ...(process.platform === 'linux' && (process.getuid?.() === 0 || process.env.CHROME_NO_SANDBOX) ? ['--no-sandbox'] : []),
      ...(process.env.CHROME_FLAGS ? process.env.CHROME_FLAGS.split(/\s+/).filter(Boolean) : []),
      '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank',
    ];
    const child = spawn(browserPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let ws = null;
    let connecting = false;
    let finished = false;
    let stderr = '';
    const finish = (err, val) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { ws?.close(); } catch { /* 忽略 */ }
      try { child.kill(); } catch { /* 忽略 */ }
      // Windows 上浏览器退出前目录可能被占用，晚一点删，失败就算了（在系统临时目录里）
      setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* 忽略 */ } }, 800).unref?.();
      err ? reject(err) : resolve(val);
    };
    const timer = setTimeout(() => finish(new Error('CDP 打印超时\n' + stderr.slice(-600))), timeoutMs);
    child.on('error', (e) => finish(e));
    child.on('exit', (code) => { if (!finished) finish(new Error('浏览器提前退出（' + code + '）\n' + stderr.slice(-600))); });
    child.stderr.on('data', async (d) => {
      stderr = (stderr + d).slice(-4000);
      const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (!m || connecting) return;
      connecting = true;
      try {
        ws = await wsConnect(m[1]);
        let seq = 0;
        const pending = new Map();
        const waiters = [];
        ws.onMessage((raw) => {
          let msg;
          try { msg = JSON.parse(raw); } catch { return; }
          if (msg.id && pending.has(msg.id)) {
            const { res, rej } = pending.get(msg.id);
            pending.delete(msg.id);
            msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
          } else if (msg.method) {
            for (const w of [...waiters]) if (w.method === msg.method && (!w.sessionId || w.sessionId === msg.sessionId)) { waiters.splice(waiters.indexOf(w), 1); w.res(msg.params); }
          }
        });
        const call = (method, params = {}, sessionId) => new Promise((res, rej) => {
          const id = ++seq;
          pending.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
        const once = (method, sessionId) => new Promise((res) => waiters.push({ method, sessionId, res }));

        const dbg = (...a) => { if (process.env.DEBUG_CDP) console.error('[cdp]', ...a); };
        dbg('connected');
        const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
        dbg('attached', sessionId);
        await call('Page.enable', {}, sessionId);
        const loaded = once('Page.loadEventFired', sessionId);
        await call('Page.navigate', { url: pathToFileURL(path.resolve(htmlPath)).href }, sessionId);
        let loadTimer;
        await Promise.race([loaded, new Promise((r) => { loadTimer = setTimeout(r, 20000); })]);
        clearTimeout(loadTimer);
        dbg('loaded');
        await call('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => document.fonts.size)', awaitPromise: true }, sessionId);
        dbg('fonts ready');
        await call('Runtime.evaluate', { expression: `document.fonts.ready.then(() => new Promise((res) => {
          const done = () => res(document.documentElement.getAttribute('data-rp-paged') || 'timeout');
          if (document.documentElement.getAttribute('data-rp-paged')) return done();
          const t = setInterval(() => { if (document.documentElement.getAttribute('data-rp-paged')) { clearInterval(t); done(); } }, 40);
          setTimeout(() => { clearInterval(t); done(); }, 2500);
        }))`, awaitPromise: true }, sessionId);
        await new Promise((r) => setTimeout(r, 150));
        const { data } = await call('Page.printToPDF', {
          printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false,
          marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, paperWidth: 8.27, paperHeight: 11.69,
        }, sessionId);
        fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
        const tmp = pdfPath + '.part';
        fs.writeFileSync(tmp, Buffer.from(data, 'base64'));
        try { fs.renameSync(tmp, pdfPath); } catch (e) { throw new Error('无法写入 ' + pdfPath + '（文件是否正被 PDF 阅读器打开？）'); }
        call('Browser.close').catch(() => {});
        finish(null, { pdfPath, bytes: fs.statSync(pdfPath).size });
      } catch (e) { finish(e); }
    });
  });
}
