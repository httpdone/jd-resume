// 为 v2 新功能截图：先用示例数据启动工作台（LLM_MOCK=1 node tests/demo-server.mjs 4321），再执行
//   node tests/screenshots-v2.mjs /workspace/shots/v2 4321
import { launch } from './browser.mjs';

const OUT = process.argv[2] || '/workspace/shots/v2';
const PORT = process.argv[3] || '4321';
const B = 'http://127.0.0.1:' + PORT + '/';

const p = await launch({ width: 1600, height: 1000, scale: 1.5 });
const shot = async (name) => { await p.sleep(500); await p.shot(OUT.replace(/\/$/, '') + '/' + name + '.png'); console.log('✓', name); };
const click = (sel) => p.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);

try {
  const resumes = (await (await fetch(B + 'api/resumes')).json()).items;
  const base = resumes.find((r) => !r.target && !/EN$/i.test(r.slug))?.slug || resumes[0].slug;
  const tailored = resumes.find((r) => r.target)?.slug || resumes[1]?.slug || base;

  // 1. 工作台提醒
  await p.goto(B + '#/dashboard');
  await p.waitFor("document.querySelector('.hero')", 20000);
  await p.sleep(400);
  await shot('01-工作台-投递提醒');

  // 2. 素材库
  await p.goto(B + '#/stories');
  await p.waitFor("document.querySelector('.story-grid, .story-card, .page-head')", 20000);
  await p.sleep(400);
  await shot('02-素材库');

  // 3. JD 抓取
  await p.goto(B + '#/jd/new');
  await p.waitFor("document.querySelector('#fetch-jd')", 20000);
  await p.eval(`
    const ta = document.querySelector('[name=text]');
    ta.value = '<html><head><title>后端开发实习生 - 星河科技招聘</title></head><body><h1>后端开发实习生</h1><div>公司名称：星河科技</div><div>工作地点：北京</div><h2>岗位职责</h2><p>负责后端服务开发与维护，参与接口设计。</p><h2>任职要求</h2><p>熟悉 Java、MySQL、Redis，了解 Docker。</p></body></html>';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await click('#extract-paste');
  await p.waitFor("document.querySelector('#fetch-msg .callout')", 30000);
  await p.sleep(300);
  await shot('03-JD一键抓取');

  // 4. 模拟面试（列表或已有会话）
  await p.goto(B + '#/mock');
  await p.waitFor("document.querySelector('.page-head')", 20000);
  await p.sleep(300);
  const hasSess = await p.eval("Boolean(document.querySelector('tr[data-id], .session-list tr, table tbody tr'))");
  if (hasSess) {
    await p.eval("document.querySelector('tr[data-id], table tbody tr')?.click()");
    await p.sleep(800);
  }
  await shot('04-模拟面试');

  // 5. 版本对比
  await p.goto(B + '#/compare/' + encodeURIComponent(base) + '/' + encodeURIComponent(tailored));
  await p.waitFor("document.querySelector('#out .compare-grid, #out .diff, #sum')", 30000);
  await p.sleep(500);
  await shot('05-版本对比');

  // 6. 一页纸检查
  await p.goto(B + '#/editor/' + encodeURIComponent(base));
  await p.waitFor("document.querySelector('#b-page') && document.querySelector('#outline')", 30000);
  await p.sleep(800);
  await click('#b-page');
  await p.waitFor("document.querySelector('.modal, dialog, .overlay')", 10000);
  await p.sleep(400);
  // 若超出一页则跑压缩，便于展示建议
  const canRun = await p.eval("Boolean([...document.querySelectorAll('button')].find(b => /让 Agent 压缩/.test(b.textContent)))");
  if (canRun) {
    await p.eval("[...document.querySelectorAll('button')].find(b => /让 Agent 压缩/.test(b.textContent)).click()");
    await p.waitFor("document.querySelector('#page-out .diff-card, #page-out .callout, #page-out .muted')", 40000);
    await p.sleep(400);
  }
  await shot('06-一页纸检查');
  // 关掉弹窗
  await p.eval("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '关闭')?.click()");
  await p.sleep(200);

  // 7. 投递复盘
  await p.goto(B + '#/apps');
  await p.waitFor("document.querySelector('#views [data-v=stats]')", 20000);
  await click('#views [data-v=stats]');
  await p.waitFor("document.querySelector('#insights .insight-table, #insights .funnel-row')", 20000);
  await p.sleep(300);
  const strat = await p.eval("Boolean(document.querySelector('#btn-strategy'))");
  if (strat) {
    await click('#btn-strategy');
    await p.waitFor("document.querySelector('#strategy-out ul, #strategy-out .callout')", 30000);
    await p.eval("document.querySelector('#insights')?.scrollIntoView({ block: 'start' })");
    await p.sleep(400);
  }
  await shot('07-投递复盘');

  // 8. 设置提醒 + 英文按钮所在的简历库
  await p.goto(B + '#/settings');
  await p.waitFor("document.querySelector('#save-remind')", 20000);
  await p.eval("document.querySelector('#save-remind')?.scrollIntoView({ block: 'center' })");
  await p.sleep(300);
  await shot('08-设置-投递提醒');

  await p.goto(B + '#/resumes');
  await p.waitFor("document.querySelector('.resume-grid')", 20000);
  await p.sleep(800);
  await shot('09-简历库-对比与英文');

  console.log('全部截图已写入', OUT);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await p.close();
}
