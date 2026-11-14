// v4.3 单元测试：条目编辑框结构、日期解析、示例投递与本科时间
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDateRange, itemKind, itemPlaceholders, DASH_TEXT } from '../public/js/item-layout.js';
import { loadApps, DEFAULT_STATUSES } from '../lib/apps.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function runV43Unit(ok) {
  console.log('\nv4.3 条目结构与日期解析');
  ok('经历类是 range，奖项是 single，技能/总结是 body', itemKind('edus') === 'range' && itemKind('works') === 'range' && itemKind('project_experience') === 'range' && itemKind('honor') === 'single' && itemKind('certificates') === 'single' && itemKind('skill_list') === 'body');
  const ph = itemPlaceholders('edus');
  ok('教育占位是开始/结束两个时间，不是一个合并的日期 span', ph.start.includes('开始') && ph.end.includes('结束') && ph.org.includes('学校'));
  ok('解析「2020年09月 - 2024年06月」', (() => { const d = parseDateRange('2020年09月 - 2024年06月'); return d.start === '2020年09月' && d.end === '2024年06月'; })());
  ok('解析无空格的「2024年09月-至今」', (() => { const d = parseDateRange('2024年09月-至今'); return d.start === '2024年09月' && d.end === '至今'; })());
  ok('解析单个年份「2024」', parseDateRange('2024').start === '2024' && parseDateRange('2024').end === '');
  ok('空字符串解析为空', parseDateRange('').start === '' && parseDateRange('  ').end === '');
  ok('默认破折号带空格，与原稿一致', DASH_TEXT === ' - ');

  console.log('\nv4.3 示例数据');
  const appsFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/applications.json'), 'utf8'));
  ok('示例投递恰好 1 条', appsFile.items.length === 1, '实际 ' + appsFile.items.length);
  ok('示例是字节跳动 · 大模型应用开发实习', appsFile.items[0].company === '字节跳动' && appsFile.items[0].role === '大模型应用开发实习');
  ok('状态列表仍是完整流水线（不少于待投递到已放弃）', appsFile.statuses.length === DEFAULT_STATUSES.length && appsFile.statuses.some((s) => s.name === '待投递') && appsFile.statuses.some((s) => s.name === 'Offer') && appsFile.statuses.some((s) => s.name === '已放弃'));
  const loaded = loadApps();
  ok('loadApps 读到 1 条示例且保留状态列表', loaded.items.length === 1 && loaded.statuses.length === DEFAULT_STATUSES.length);

  const bodies = [
    path.join(ROOT, 'resumes/张明/body.html'),
    path.join(ROOT, 'resumes/张明-字节跳动-大模型应用开发实习/body.html'),
  ];
  for (const f of bodies) {
    const html = fs.readFileSync(f, 'utf8');
    const near = html.match(/江苏信息工程学院[\s\S]{0,500}?202[02]年09月[\s\S]{0,200}?2024年06月/);
    ok(path.basename(path.dirname(f)) + ' 本科时间为 2020年09月 – 2024年06月', near && near[0].includes('2020年09月') && !near[0].includes('2022年09月') && /江苏信息工程学院/.test(html));
    ok(path.basename(path.dirname(f)) + ' 仍用三个 span 写日期', /江苏信息工程学院[\s\S]{0,400}?<span[^>]*>\s*2020年09月\s*<\/span>\s*<span[^>]*>\s*-?\s*<\/span>\s*<span[^>]*>\s*2024年06月/.test(html));
    ok(path.basename(path.dirname(f)) + ' 没有把别的 2022年09月误改掉（本应已全部改为本科）', !html.includes('2022年09月'));
  }
  const stories = fs.readFileSync(path.join(ROOT, 'data/stories.json'), 'utf8');
  ok('素材库里没有需要同步的本科 2022 时间', !/江苏信息工程[\s\S]{0,200}2022年09月/.test(stories));
}
