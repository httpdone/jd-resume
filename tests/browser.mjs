// 测试辅助：用 CDP 驱动无头 Chrome（零依赖），用于 UI 冒烟测试与截图
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { wsConnect } from '../lib/cdp.mjs';
import { findBrowser } from '../lib/pdf.mjs';

export async function launch({ width = 1600, height = 1000, scale = 1 } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-test-'));
  const child = spawn(findBrowser(), ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--window-size=' + width + ',' + height, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((res, rej) => {
    let err = '';
    child.stderr.on('data', (d) => { err += d; const m = err.match(/DevTools listening on (ws:\/\/\S+)/); if (m) res(m[1]); });
    const t = setTimeout(() => rej(new Error('chrome 启动超时')), 20000);
    t.unref();
  });
  const ws = await wsConnect(wsUrl);
  let seq = 0;
  const pending = new Map();
  const logs = [];
  ws.onMessage((raw) => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result); return; }
    // 离开页面时的「未保存」确认框等：测试里一律自动确认，避免导航卡住
    if (msg.method === 'Page.javascriptDialogOpening') { call('Page.handleJavaScriptDialog', { accept: true }, msg.sessionId).catch(() => {}); return; }
    if (msg.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) logs.push(msg.params.type + ': ' + msg.params.args.map((a) => a.value ?? a.description).join(' '));
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') logs.push('LOG: ' + msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
  });
  const call = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => call(m, p, sessionId);
  await s('Page.enable'); await s('Runtime.enable'); await s('Log.enable');
  await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  const page = {
    logs,
    async goto(url) { await s('Page.navigate', { url }); await page.sleep(300); },
    async eval(expr) {
      const r = await s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('eval 出错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    },
    async waitFor(expr, timeout = 20000) {
      const t = Date.now();
      while (Date.now() - t < timeout) { try { if (await page.eval(expr)) return true; } catch { /* 继续等 */ } await page.sleep(150); }
      throw new Error('等待超时：' + expr);
    },
    async mouse(type, x, y, button = 'none') {
      await s('Input.dispatchMouseEvent', { type, x, y, button, clickCount: type === 'mouseMoved' ? 0 : 1, buttons: button === 'left' && type === 'mousePressed' ? 1 : 0 });
    },
    async move(x, y, steps = 1, from = null) {
      if (from && steps > 1) { for (let i = 1; i <= steps; i++) await page.mouse('mouseMoved', from.x + (x - from.x) * i / steps, from.y + (y - from.y) * i / steps); }
      else await page.mouse('mouseMoved', x, y);
    },
    async click(x, y) { await page.mouse('mouseMoved', x, y); await page.mouse('mousePressed', x, y, 'left'); await page.mouse('mouseReleased', x, y, 'left'); },
    async key(key, code = key, keyCode = 0, mods = 0) {
      const text = key === 'Enter' ? '\r' : key.length === 1 ? key : undefined;
      await s('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers: mods, ...(text ? { text, unmodifiedText: text } : {}) });
      await s('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers: mods });
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    async shot(file, clip) {
      const { data } = await s('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
    },
    async close() { try { await call('Browser.close'); } catch { /* 忽略 */ } child.kill(); await new Promise((r) => setTimeout(r, 500)); try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ } },
  };
  return page;
}
