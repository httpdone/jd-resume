#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ASSETS_DIR, OUT_DIR, IS_SEA } from './lib/config.mjs';
import { initUserData } from './lib/userdata.mjs';
import { renderHtml } from './lib/render.mjs';
import { assetsDir } from './lib/media.mjs';
import { printPdfAuto, findBrowser } from './lib/pdf.mjs';
import { startEditor } from './lib/editor.mjs';
import { startServer } from './lib/server.mjs';
import {
  listResumes, createResume, deleteResume, resolveSlug,
  readBody, readMeta, hasResume, slugify, countPages,
} from './lib/store.mjs';

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      if (value !== undefined) flags[key] = value;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[key] = argv[++i];
      else flags[key] = true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function openPath(target) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', target]]
    : process.platform === 'darwin' ? ['open', [target]]
      : ['xdg-open', [target]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* 打不开就只打印路径 */
  }
}

function exportHtml(slug) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const htmlPath = path.join(OUT_DIR, slug + '.html');
  fs.writeFileSync(htmlPath, renderHtml({
    body: readBody(slug),
    title: slug,
    fontHref: pathToFileURL(path.join(ASSETS_DIR, 'fonts.css')).href,
    meta: readMeta(slug),
    assetBase: pathToFileURL(assetsDir(slug)).href + '/',
  }), 'utf8');
  return htmlPath;
}

const HELP = [
  '简历库命令',
  '',
  '  node cli.mjs serve [--port 4321] [--no-open]  启动简历工作台（网页版：简历管理 / AI 诊断改写 / JD 适配 / 投递日历）',
  '  node cli.mjs list                       列出所有简历',
  '  node cli.mjs new <名称> [--from <名称>]  新建简历（默认从入门模板创建，可指定从某份简历复制）',
  '  node cli.mjs edit [名称] [--port 4321]  启动本地编辑器，浏览器内直接改文字，Ctrl+S 保存',
  '  node cli.mjs pdf <名称> [--open]        导出 out/<名称>.html 与 out/<名称>.pdf',
  '  node cli.mjs html <名称>                只导出 HTML',
  '  node cli.mjs rm <名称> [--yes]          删除简历',
  '',
  '导 PDF 使用本机 Chrome/Edge；找不到时设置环境变量 CHROME_PATH 指向 chrome.exe',
].join('\n');

async function cmdList() {
  const rows = listResumes();
  if (!rows.length) {
    console.log('还没有简历。用 node cli.mjs new <名称> 新建一份。');
    return;
  }
  console.log('名称'.padEnd(24) + '页数'.padEnd(6) + '大小'.padEnd(10) + '更新时间');
  for (const row of rows) {
    console.log(
      row.slug.padEnd(24)
      + String(row.pages).padEnd(6)
      + (row.bytes >= 1024 ? (row.bytes / 1024).toFixed(0) + 'KB' : row.bytes + 'B').padEnd(10)
      + new Date(row.updatedAt).toLocaleString('zh-CN', { hour12: false }),
    );
  }
}

function cmdNew(positional, flags) {
  const name = positional[0];
  if (!name) throw new Error('用法：node cli.mjs new <名称> [--from <名称>]');
  const from = flags.from && flags.from !== true ? flags.from : null;
  const created = createResume(name, from);
  console.log('已新建「' + created.slug + '」，' + created.pages + ' 页，来源：' + (from || '入门模板'));
  console.log('下一步：node cli.mjs edit ' + created.slug);
}

async function cmdRm(positional, flags) {
  const name = positional[0];
  if (!name) throw new Error('用法：node cli.mjs rm <名称> [--yes]');
  const slug = resolveSlug(name);
  if (!flags.yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('确认删除「' + slug + '」？输入 y 继续：');
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('已取消');
      return;
    }
  }
  deleteResume(slug);
  console.log('已删除「' + slug + '」');
}

function cmdEdit(positional, flags) {
  const port = flags.port && flags.port !== true ? Number(flags.port) : 4321;
  startEditor({ name: positional[0], port, open: flags.open !== false });
}

function cmdServe(positional, flags) {
  const port = flags.port && flags.port !== true ? Number(flags.port) : Number(process.env.PORT) || 4321;
  const host = flags.host && flags.host !== true ? flags.host : '127.0.0.1';
  startServer({ port, host, open: !flags['no-open'] && !process.env.NO_OPEN });
}

async function cmdPdf(positional, flags) {
  const slug = resolveSlug(positional[0]);
  const htmlPath = exportHtml(slug);
  console.log('HTML：' + htmlPath);
  console.log('浏览器：' + findBrowser());
  const pdfPath = path.join(OUT_DIR, slug + '.pdf');
  const { bytes } = await printPdfAuto({ htmlPath, pdfPath });
  console.log('PDF ：' + pdfPath + '（' + (bytes / 1024).toFixed(0) + 'KB，' + countPages(readBody(slug)) + ' 页）');
  if (flags.open) openPath(pdfPath);
}

function cmdHtml(positional) {
  const slug = resolveSlug(positional[0]);
  if (!hasResume(slugify(slug))) throw new Error('找不到简历「' + slug + '」');
  console.log('HTML：' + exportHtml(slug));
}

const commands = {
  serve: cmdServe,
  start: cmdServe,
  list: cmdList,
  ls: cmdList,
  new: cmdNew,
  edit: cmdEdit,
  pdf: cmdPdf,
  html: cmdHtml,
  rm: cmdRm,
};

// 双击可执行文件时没有参数：直接启动网页版
const argv = process.argv.slice(2);
const [command, ...rest] = IS_SEA && (!argv.length || argv[0].startsWith('--')) ? ['serve', ...argv] : argv;
const { positional, flags } = parseArgs(rest);
const run = commands[command];

async function main() {
  try {
    if (!run || flags.help) {
      console.log(HELP);
    } else {
      if (command !== 'serve') initUserData(); // 首次运行命令行时也放入门模板（serve 在启动时自己做）
      await run(positional, flags);
    }
  } catch (error) {
    console.error('错误：' + error.message);
    process.exitCode = 1;
  }
}

main();
