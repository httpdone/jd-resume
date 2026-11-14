import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { printPdfCdp } from './cdp.mjs';

// 用本机已装的 Chrome / Edge 无头打印，避免为了导 PDF 引入 puppeteer
export function findBrowser() {
  const env = [process.env.CHROME_PATH, process.env.EDGE_PATH].filter(Boolean);
  const windows = [
    path.join(process.env['ProgramFiles'] || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['LOCALAPPDATA'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env['ProgramFiles'] || 'C:/Program Files', 'Microsoft/Edge/Application/msedge.exe'),
  ];
  const posix = [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge', '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  const found = [...env, ...windows, ...posix].find((p) => p && fs.existsSync(p));
  if (!found) {
    throw new Error('未找到 Chrome / Edge，可设置环境变量 CHROME_PATH 指向 chrome.exe');
  }
  return found;
}

export function printPdf({ htmlPath, pdfPath, browserPath = findBrowser() }) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-pdf-'));
  fs.mkdirSync(path.dirname(pdfPath), { recursive: true });

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=5000',
    '--no-pdf-header-footer',
    // Linux 容器 / root 下 Chrome 沙箱起不来；Windows 不需要
    ...(process.platform === 'linux' && (process.getuid?.() === 0 || process.env.CHROME_NO_SANDBOX) ? ['--no-sandbox'] : []),
    ...(process.env.CHROME_FLAGS ? process.env.CHROME_FLAGS.split(/\s+/).filter(Boolean) : []),
    '--user-data-dir=' + profile,
    '--print-to-pdf=' + path.resolve(pdfPath),
    pathToFileURL(path.resolve(htmlPath)).href,
  ];

  const result = spawnSync(browserPath, args, { timeout: 180000, encoding: 'utf8' });
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* 忽略 */ }

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error('浏览器退出码 ' + result.status + '\n' + (result.stderr || '').slice(-800));
  }
  if (!fs.existsSync(pdfPath) || fs.statSync(pdfPath).size === 0) {
    throw new Error('未生成 PDF，检查页面是否有渲染错误：' + pdfPath);
  }
  return { pdfPath, bytes: fs.statSync(pdfPath).size };
}

// 异步版：网页服务里用，避免导出时卡住其他请求
export function printPdfAsync({ htmlPath, pdfPath, browserPath = findBrowser() }) {
  return new Promise((resolve, reject) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-pdf-'));
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
    const tmpPdf = pdfPath + '.part';
    const args = [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--disable-background-timer-throttling', '--run-all-compositor-stages-before-draw', '--virtual-time-budget=5000',
      '--no-pdf-header-footer',
      ...(process.platform === 'linux' && (process.getuid?.() === 0 || process.env.CHROME_NO_SANDBOX) ? ['--no-sandbox'] : []),
      ...(process.env.CHROME_FLAGS ? process.env.CHROME_FLAGS.split(/\s+/).filter(Boolean) : []),
      '--user-data-dir=' + profile,
      '--print-to-pdf=' + path.resolve(tmpPdf),
      pathToFileURL(path.resolve(htmlPath)).href,
    ];
    let stderr = '';
    const child = spawn(browserPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const timer = setTimeout(() => child.kill(), 180000);
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* 忽略 */ }
      if (code !== 0) return reject(new Error('浏览器退出码 ' + code + '\n' + stderr.slice(-800)));
      if (!fs.existsSync(tmpPdf) || fs.statSync(tmpPdf).size === 0) return reject(new Error('未生成 PDF，检查页面是否有渲染错误'));
      try {
        fs.renameSync(tmpPdf, pdfPath);
      } catch (error) {
        return reject(new Error('无法写入 ' + pdfPath + '（文件是否正被 PDF 阅读器打开？）：' + error.message));
      }
      resolve({ pdfPath, bytes: fs.statSync(pdfPath).size });
    });
  });
}

// PDF 引擎：默认先用 CDP（会等字体加载完成；某些环境下 --print-to-pdf 会卡住），失败再退回 --print-to-pdf。
// 环境变量 PDF_ENGINE=cli 强制用原来的 --print-to-pdf，PDF_ENGINE=cdp 只用 CDP。
export async function printPdfAuto({ htmlPath, pdfPath, browserPath = findBrowser() }) {
  const engine = (process.env.PDF_ENGINE || 'auto').toLowerCase();
  if (engine === 'cli') return printPdfAsync({ htmlPath, pdfPath, browserPath });
  try {
    return await printPdfCdp({ htmlPath, pdfPath, browserPath });
  } catch (error) {
    if (engine === 'cdp') throw error;
    console.warn('[pdf] CDP 打印失败，改用 --print-to-pdf：' + String(error.message).split('\n')[0]);
    return printPdfAsync({ htmlPath, pdfPath, browserPath });
  }
}
