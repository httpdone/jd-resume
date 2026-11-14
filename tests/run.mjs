// 冒烟测试：在临时目录里启动服务（演示模式 + 假模型），逐个调用 API。不会动你的真实数据。
// 用法：npm test   （可选：加 --pdf 同时测 PDF 导出，需要本机有 Chrome/Edge）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-test-'));
// 示例数据在 examples/，复制到临时 RESUME_HOME 里测试
fs.cpSync(path.join(ROOT, 'examples/resumes'), path.join(HOME, 'resumes'), { recursive: true, filter: (p) => !p.includes('.history') });
fs.mkdirSync(path.join(HOME, 'data'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'examples/data/applications.json'), path.join(HOME, 'data/applications.json'));
// lib/config.mjs 在导入时解析数据目录，所以先设好 RESUME_HOME 再动态导入
process.env.RESUME_HOME = HOME;
const { runV41Unit } = await import('./v41-unit.mjs');
const { runV41Browser } = await import('./v41-browser.mjs');
const { runV42Unit } = await import('./v42-unit.mjs');
const { runV43Unit } = await import('./v43-unit.mjs');
const { runV43Browser } = await import('./v43-browser.mjs');
const { runV42Browser } = await import('./v42-browser.mjs');
const slug = fs.readdirSync(path.join(HOME, 'resumes')).find((d) => !d.startsWith('.'));
const PORT = 4500 + Math.floor(Math.random() * 400);
const LLM_PORT = PORT + 1;
const B = 'http://127.0.0.1:' + PORT;
const withPdf = process.argv.includes('--pdf');

const procs = [];
const start = (args, env = {}) => { const p = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, RESUME_HOME: HOME, NO_OPEN: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); procs.push(p); return p; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); } };
const j = async (method, url, body) => { const r = await fetch(B + url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); let d = null; try { d = await r.json(); } catch { /* 非 JSON */ } return { status: r.status, d }; };
const sse = async (body) => {
  const r = await fetch(B + '/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await r.text();
  const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => ({ ev: m[1], data: JSON.parse(m[2]) }));
  return { result: events.find((e) => e.ev === 'result')?.data, error: events.find((e) => e.ev === 'error')?.data, deltas: events.filter((e) => e.ev === 'delta').length };
};

try {
  await runV41Unit(ok);
  runV42Unit(ok);
  runV43Unit(ok);
  start(['cli.mjs', 'serve', '--port', String(PORT), '--no-open'], { LLM_API_KEY: '', OPENAI_API_KEY: '', DEEPSEEK_API_KEY: '', LLM_BASE_URL: '', LLM_MODEL: '', LLM_MOCK: '' });
  start(['tests/fake-llm.mjs', String(LLM_PORT)]);
  for (let i = 0; i < 50; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch { /* 等待启动 */ } await sleep(100); }
  const enc = encodeURIComponent;

  console.log('\n简历');
  ok('health', (await j('GET', '/api/health')).d?.ok);
  ok('列表含 ' + slug, (await j('GET', '/api/resumes')).d?.items?.some((i) => i.slug === slug));
  const demoApps = await j('GET', '/api/apps');
  ok('默认示例投递 1 条（字节跳动）', demoApps.d?.items?.length === 1 && demoApps.d.items[0].company === '字节跳动');
  ok('默认状态列表完整', (demoApps.d?.statuses || []).length >= 10);
  const one = await j('GET', '/api/resumes/' + enc(slug));
  ok('读取正文', one.d?.html?.includes('cv-container'));
  ok('复制', (await j('POST', '/api/resumes', { name: 'T-副本', from: slug })).d?.ok);
  ok('重名拒绝', (await j('POST', '/api/resumes', { name: 'T-副本', from: slug })).status === 400);
  ok('unique 自动加后缀', (await j('POST', '/api/resumes', { name: 'T-副本', from: slug, unique: true })).d?.slug === 'T-副本-2');
  ok('非法名称拒绝', (await j('POST', '/api/resumes', { name: '../x' })).status === 400);
  ok('改名', (await j('POST', '/api/resumes/' + enc('T-副本') + '/rename', { name: 'T-改名' })).d?.ok);
  ok('非法正文拒绝', (await j('PUT', '/api/resumes/' + enc('T-改名'), { html: '<div>bad</div>' })).status === 400);
  ok('保存', (await j('PUT', '/api/resumes/' + enc('T-改名'), { html: one.d.html.replace('张明', '张明明') })).d?.ok);
  ok('历史版本 1 份', (await j('GET', '/api/resumes/' + enc('T-改名') + '/history')).d?.items?.length === 1);
  ok('meta 更新', (await j('PATCH', '/api/resumes/' + enc('T-改名') + '/meta', { tags: ['a'] })).d?.ok);
  ok('删除', (await j('DELETE', '/api/resumes/' + enc('T-改名'))).d?.ok);
  ok('预览页', (await (await fetch(B + '/preview/' + enc(slug))).text()).includes('cv-container'));
  ok('路径穿越被拦', (await fetch(B + '/assets/..%2F..%2Fpackage.json')).status >= 400);
  ok('前端页面', (await (await fetch(B + '/')).text()).includes('简历工作台'));

  console.log('\nAgent');
  ok('未配置时给出提示', (await sse({ task: 'chat', resume: { text: 'x' }, messages: [{ role: 'user', content: 'hi' }] })).error?.code === 'not_configured');
  await j('PUT', '/api/settings', { mock: true });
  const resume = { text: '## 实习经历 [works]\n### [works-1] 某公司\n负责后端开发，主导了系统重构', items: [{ id: 'works-1', module: 'works', moduleTitle: '实习经历', title: '某公司', html: '<ul><li>负责后端开发，主导了系统重构</li></ul>', text: '负责后端开发，主导了系统重构', editable: true }] };
  const jd = { company: '某厂', role: '后端实习', text: '岗位职责：\n1. 负责后端服务开发\n任职要求：\n1. 熟悉 Java、MySQL、Redis\n加分项：熟悉 Docker' };
  for (const task of ['diagnose', 'rewrite', 'jd_analyze', 'jd_match', 'tailor', 'interview', 'chat']) {
    const r = await sse({ task, resume, items: resume.items, jd, messages: [{ role: 'user', content: '你好' }], style: 'quant' });
    ok('演示模式 ' + task, r.result && !r.error, JSON.stringify(r.error || ''));
  }
  await j('PUT', '/api/settings', { mock: false, llm: { preset: 'custom', baseUrl: 'http://127.0.0.1:' + LLM_PORT + '/v1', model: 'fake' } });
  ok('连接测试（假模型）', (await j('POST', '/api/settings/test', {})).d?.ok);
  const dr = await sse({ task: 'diagnose', resume });
  ok('真实链路：流式 + JSON 解析', dr.result?.data?.score === 77 && dr.deltas > 1);
  const rw = await sse({ task: 'rewrite', resume, items: resume.items, style: 'polish' });
  ok('真实链路：改写（带代码块的 JSON）', rw.result?.data?.items?.[0]?.id === 'works-1');
  await j('PUT', '/api/settings', { llm: { baseUrl: 'http://127.0.0.1:1/v1' } });
  ok('连不上时给出网络错误', (await sse({ task: 'chat', resume, messages: [{ role: 'user', content: 'x' }] })).error?.code === 'network');
  const st = await j('PUT', '/api/settings', { llm: { apiKey: 'sk-test-1234567890' } });
  ok('Key 打码返回', st.d?.llm?.keyMasked && !JSON.stringify(st.d).includes('sk-test-1234567890'));
  ok('清除 Key', (await j('PUT', '/api/settings', { clearKey: true })).d?.llm?.hasKey === false);

  console.log('\n投递 / JD');
  ok('公司必填', (await j('POST', '/api/apps', { company: '' })).status === 400);
  const a = await j('POST', '/api/apps', { company: '测试公司', status: '已投递', events: [{ type: '一面', date: '2026-01-02' }, { type: 'x', date: 'bad' }] });
  ok('新增投递（过滤非法日程）', a.d?.item?.events?.length === 1);
  const u = await j('PUT', '/api/apps/' + a.d.item.id, { status: '一面' });
  ok('改状态写入历史', u.d?.item?.history?.length === 2);
  ok('自定义状态（重名拒绝）', (await j('PUT', '/api/apps/_statuses', { statuses: [{ name: 'a' }, { name: 'a' }] })).status === 400);
  ok('删除投递', (await j('DELETE', '/api/apps/' + a.d.item.id)).d?.ok);
  const jr = await j('POST', '/api/jds', { company: '某厂', role: 'x', text: 'abc' });
  ok('保存 JD', jr.d?.item?.id);
  ok('更新 JD', (await j('POST', '/api/jds', { id: jr.d.item.id, role: 'y' })).d?.item?.role === 'y');
  ok('删除 JD', (await j('DELETE', '/api/jds/' + jr.d.item.id)).d?.ok);


  console.log('\n素材库 / 模拟面试 / 提醒 / 复盘 / JD 抓取');
  await j('PUT', '/api/settings', { mock: true, remindAfterDays: 10, notifyEnabled: false });
  const st2 = await j('GET', '/api/settings');
  ok('提醒天数可配置', st2.d?.remindAfterDays === 10);

  const story = await j('POST', '/api/stories', { title: '缓存穿透防护', type: 'internship', org: '测试公司', role: '后端实习', action: '加了布隆过滤器并设置空值缓存', result: '穿透请求下降', metrics: ['穿透 -80%'], stack: ['Redis', 'Java'], tags: ['缓存'] });
  ok('新建素材', story.d?.item?.id && story.d.item.title === '缓存穿透防护');
  ok('素材列表', (await j('GET', '/api/stories')).d?.items?.some((x) => x.id === story.d.item.id));
  ok('更新素材', (await j('PUT', '/api/stories/' + story.d.item.id, { result: '穿透请求下降 80%' })).d?.item?.result.includes('80%'));
  const imported = await j('POST', '/api/stories/_import', { slug });
  ok('从简历导入素材', imported.d?.ok && imported.d.added >= 1, JSON.stringify({ added: imported.d?.added, error: imported.d?.error }));
  ok('删除素材', (await j('DELETE', '/api/stories/' + story.d.item.id)).d?.ok);

  const iv = await j('POST', '/api/interviews', { resumeSlug: slug, type: 'tech', rounds: 4, company: '测试公司', role: '后端' });
  ok('新建模拟面试', iv.d?.item?.id && iv.d.item.rounds === 4);
  ok('缺少简历拒绝', (await j('POST', '/api/interviews', { type: 'tech' })).status === 400);
  ok('更新会话', (await j('PUT', '/api/interviews/' + iv.d.item.id, { messages: [{ role: 'assistant', content: '问1' }, { role: 'user', content: '答1' }] })).d?.ok);
  const wr = await j('POST', '/api/interviews/_wrong', { question: '数字口径是什么？', type: 'tech', sessionId: iv.d.item.id, resumeSlug: slug });
  ok('错题本写入', wr.d?.item?.id);
  ok('错题本列表', (await j('GET', '/api/interviews/_wrong')).d?.items?.some((x) => x.id === wr.d.item.id));
  ok('删除错题', (await j('DELETE', '/api/interviews/_wrong/' + wr.d.item.id)).d?.ok);
  ok('删除会话', (await j('DELETE', '/api/interviews/' + iv.d.item.id)).d?.ok);

  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const soon = iso(new Date(today.getTime() + 2 * 864e5));
  const old = iso(new Date(today.getTime() - 15 * 864e5));
  const evId = 'ev-test-1';
  const appA = await j('POST', '/api/apps', { company: '提醒测试', role: 'Java 后端实习', status: '已投递', channel: '牛客', appliedAt: old, resumeSlug: slug, events: [{ id: evId, type: '一面', date: soon, time: '14:00' }] });
  const appB = await j('POST', '/api/apps', { company: '阿里巴巴', role: '算法实习', status: '一面', channel: '官网', appliedAt: old, resumeSlug: slug, events: [{ type: '一面', date: soon, time: '10:00' }] });
  ok('提醒：即将到来', (await j('GET', '/api/apps/_reminders?days=7')).d?.upcoming?.some((e) => e.company === '提醒测试' && e.date === soon));
  ok('提醒：超期无回音', (await j('GET', '/api/apps/_reminders?days=7')).d?.silent?.some((e) => e.company === '提醒测试'));
  const icsAll = await fetch(B + '/api/apps/_ics');
  const icsText = await icsAll.text();
  ok('导出全部 ICS', icsAll.ok && icsText.includes('BEGIN:VCALENDAR') && icsText.includes('提醒测试') && icsText.includes('一面'));
  const icsOne = await (await fetch(B + '/api/apps/' + appA.d.item.id + '/ics')).text();
  ok('导出单条投递 ICS', icsOne.includes('BEGIN:VEVENT') && icsOne.includes('提醒测试'));
  const icsEv = await (await fetch(B + '/api/apps/' + appA.d.item.id + '/ics?event=' + evId)).text();
  ok('导出单个事件 ICS', icsEv.includes('一面') && icsEv.split('BEGIN:VEVENT').length === 2);
  const insights = await j('GET', '/api/apps/_insights');
  ok('复盘统计字段', insights.d?.overall && Array.isArray(insights.d.byChannel) && Array.isArray(insights.d.byRoleType) && Array.isArray(insights.d.byResume) && Array.isArray(insights.d.byCompanyType) && insights.d.funnel);
  ok('小样本标记不可靠', insights.d.unreliable === true);

  const paste = await j('POST', '/api/jds/fetch', { text: '公司名称：星河科技\n职位名称：后端开发实习生\n工作地点：北京\n岗位职责：\n1. 负责后端服务开发与维护\n任职要求：\n1. 熟悉 Java、MySQL、Redis\n加分项：了解 Docker' });
  ok('粘贴文本抽取 JD', paste.d?.ok && paste.d.company.includes('星河') && paste.d.role.includes('后端') && paste.d.text.includes('任职要求'), JSON.stringify(paste.d));
  const pasteHtml = await j('POST', '/api/jds/fetch', { html: '<html><head><title>后端开发实习生 - 星河科技招聘</title></head><body><h1>后端开发实习生</h1><div>公司名称：星河科技</div><h2>岗位职责</h2><p>负责 API 网关与订单服务</p><h2>任职要求</h2><p>熟悉 Java、Spring、MySQL，了解 Redis。</p></body></html>' });
  ok('粘贴 HTML 抽取 JD', pasteHtml.d?.ok && /星河|后端/.test((pasteHtml.d.company || '') + (pasteHtml.d.role || '')), JSON.stringify({ company: pasteHtml.d?.company, role: pasteHtml.d?.role, ok: pasteHtml.d?.ok }));
  ok('无内容抓取拒绝', (await j('POST', '/api/jds/fetch', {})).status === 400);
  ok('SSRF 拦截私网', (await j('POST', '/api/jds/fetch', { url: 'http://169.254.169.254/' })).status >= 400);
  ok('SSRF 拦截非 http', (await j('POST', '/api/jds/fetch', { url: 'file:///etc/passwd' })).status >= 400);

  const JD_HTML = '<!doctype html><html><head><title>大模型应用开发实习 - 示例公司招聘</title></head><body><h1>大模型应用开发实习</h1><p>公司名称：示例公司</p><p>工作地点：上海</p><h2>岗位职责</h2><p>负责基于大模型的 Agent 与 RAG 应用研发，参与知识库问答落地。</p><h2>任职要求</h2><p>熟悉 Python 或 Java，了解向量数据库与 Prompt 工程，每周实习四天以上。</p></body></html>';
  const jdPort = PORT + 2;
  const jdSrv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(JD_HTML); });
  await new Promise((resolve) => jdSrv.listen(jdPort, '127.0.0.1', resolve));
  try {
    const fetched = await j('POST', '/api/jds/fetch', { url: 'http://127.0.0.1:' + jdPort + '/job' });
    ok('本地页面抓取 JD', fetched.d?.ok && (fetched.d.company.includes('示例') || fetched.d.role.includes('大模型') || (fetched.d.text || '').includes('任职要求')), JSON.stringify(fetched.d));
  } finally { await new Promise((resolve) => jdSrv.close(resolve)); }

  console.log('\n新 Agent 任务（演示模式）');
  await j('PUT', '/api/settings', { mock: true });
  for (const [task, extra] of [
    ['extract_jd', { text: '公司名称：星河科技\n职位名称：后端实习\n岗位职责：负责服务开发\n任职要求：熟悉 Java 与 MySQL，了解 Redis 与 Docker。' }],
    ['compress', { items: resume.items, pages: 2, overLines: 8 }],
    ['translate', { resume, items: resume.items, modules: [{ id: 'works', title: '实习经历' }] }],
    ['mock_interview', { action: 'start', interviewType: 'tech', rounds: 4, resume }],
    ['mock_interview', { action: 'review', interviewType: 'tech', rounds: 4, messages: [{ role: 'assistant', content: 'q' }, { role: 'user', content: 'a' }] }],
    ['story_probe', { story: { title: '缓存', action: '做了优化' } }],
    ['story_write', { story: { title: '缓存', task: '降低穿透', action: '布隆过滤器', result: '下降 80%' } }],
    ['strategy', { insights: insights.d }],
  ]) {
    const r = await sse({ task, resume, ...extra });
    const name = task + (extra.action ? ' / ' + extra.action : '');
    ok('演示模式 ' + name, r.result && !r.error, JSON.stringify(r.error || r.result?.data || '').slice(0, 180));
  }
  const tr = await sse({ task: 'translate', resume, items: resume.items, modules: [{ id: 'works', title: '实习经历' }] });
  ok('翻译结果含模块英文名', tr.result?.data?.modules?.[0]?.title && /[A-Za-z]/.test(tr.result.data.modules[0].title));
  const mi = await sse({ task: 'mock_interview', action: 'start', interviewType: 'hr', rounds: 3, resume });
  ok('模拟面试返回问题', Boolean(mi.result?.data?.question));


  console.log('\n简历模板');
  const tps = await j('GET', '/api/templates');
  ok('模板列表不少于 6 套', tps.d?.items?.length >= 6 && tps.d.items.some((t) => t.id === 'classic'));
  ok('模板 id 互不重复', new Set(tps.d.items.map((t) => t.id)).size === tps.d.items.length);
  const prev0 = await (await fetch(B + '/preview/' + enc(slug))).text();
  ok('默认预览为经典模板', prev0.includes('data-rp-theme="classic"') && prev0.includes('cv-container'));
  const sw = await j('PATCH', '/api/resumes/' + enc(slug) + '/meta', { template: 'minimal', theme: { accent: '#111111', fontSize: 13, lineHeight: 1.8, margin: 14 } });
  ok('切换模板写入 meta', sw.d?.meta?.template === 'minimal' && sw.d.meta.theme.fontSize === 13 && sw.d.meta.theme.margin === 14);
  const prev1 = await (await fetch(B + '/preview/' + enc(slug))).text();
  ok('预览套用新主题 CSS', /<html[^>]*data-rp-theme="minimal"/.test(prev1) && prev1.includes('--rp-accent:#111111'));
  ok('正文结构仍在', prev1.includes('id="cv-container"') && prev1.includes('content-scroll') && prev1.includes('user-name'));
  ok('非法模板回落经典', (await j('PATCH', '/api/resumes/' + enc(slug) + '/meta', { template: '../hack' })).d?.meta?.template === 'classic');
  const clamp = await j('PATCH', '/api/resumes/' + enc(slug) + '/meta', { template: 'tech', theme: { accent: 'red', fontSize: 99, margin: 1, lineHeight: 9 } });
  ok('非法主题值被纠正', clamp.d?.meta?.template === 'tech' && clamp.d.meta.theme.accent === '#0891b2' && clamp.d.meta.theme.fontSize === 15 && clamp.d.meta.theme.margin === 8 && clamp.d.meta.theme.lineHeight <= 2.2);
  const copied = await j('POST', '/api/resumes', { name: 'T-模板继承', from: slug, unique: true });
  ok('复制时继承模板', copied.d?.item?.template === 'tech' || (await j('GET', '/api/resumes/' + enc(copied.d.slug || copied.d.item?.slug || 'T-模板继承'))).d?.meta?.template === 'tech', JSON.stringify(copied.d));
  await j('PATCH', '/api/resumes/' + enc(slug) + '/meta', { template: 'classic', theme: { accent: '#4183ff', fontSize: 12, lineHeight: 1.7, margin: 12 } });

  console.log('\n头像与校徽');
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const up = await j('POST', '/api/resumes/' + enc(slug) + '/assets', { kind: 'avatar', data: PNG });
  ok('上传头像到 assets', up.d?.ok && up.d.name.startsWith('avatar') && up.d.bytes > 10, JSON.stringify(up.d));
  const assetFile = await fetch(B + '/api/resumes/' + enc(slug) + '/assets/' + up.d.name);
  ok('按路径读取头像文件', assetFile.ok && (assetFile.headers.get('content-type') || '').includes('image/'));
  const school = await j('POST', '/api/resumes/' + enc(slug) + '/assets', { kind: 'school', data: PNG });
  ok('上传校徽', school.d?.ok && school.d.name.startsWith('school'));
  const listed = await j('GET', '/api/resumes/' + enc(slug) + '/assets');
  ok('列出简历素材', listed.d?.items?.length >= 2);
  const raw = (await j('GET', '/api/resumes/' + enc(slug))).d.html;
  const withAsset = raw.replace(/class="user-avatar-image"[^>]*>/, 'class="user-avatar-image" data-rp-asset="' + up.d.name + '" data-rp-shape="circle" src="assets/' + up.d.name + '">');
  ok('保存正文用相对路径而非巨型 base64', (await j('PUT', '/api/resumes/' + enc(slug), { html: withAsset })).d?.ok && !(await j('GET', '/api/resumes/' + enc(slug))).d.html.includes('data:image/png;base64,iVBOR') && (await j('GET', '/api/resumes/' + enc(slug))).d.html.includes('src="assets/' + up.d.name + '"'));
  const prevA = await (await fetch(B + '/preview/' + enc(slug))).text();
  ok('预览改写为接口路径', prevA.includes('/api/resumes/' + enc(slug) + '/assets/' + enc(up.d.name)) && prevA.includes('data-rp-asset="' + up.d.name + '"'));
  const copiedMedia = await j('POST', '/api/resumes', { name: 'T-带图副本', from: slug, unique: true });
  const copySlug = copiedMedia.d?.slug || copiedMedia.d?.item?.slug;
  ok('复制简历时一并复制图片', (await j('GET', '/api/resumes/' + enc(copySlug) + '/assets')).d?.items?.some((x) => x.name.startsWith('avatar')), JSON.stringify(copiedMedia.d));
  ok('素材路径穿越被拦', (await fetch(B + '/api/resumes/' + enc(slug) + '/assets/' + encodeURIComponent('../meta.json'))).status >= 400);
  ok('非法类型拒绝', (await j('POST', '/api/resumes/' + enc(slug) + '/assets', { kind: 'avatar', data: Buffer.from('not-an-image').toString('base64') })).status === 400);
  const lib = await j('POST', '/api/media-library', { kind: 'avatar', title: '常用一号', data: PNG });
  ok('保存常用头像', lib.d?.ok && lib.d.item?.id);
  ok('常用库列表', (await j('GET', '/api/media-library')).d?.items?.some((x) => x.id === lib.d.item.id));
  const applied = await j('POST', '/api/resumes/' + enc(copySlug) + '/assets', { kind: 'avatar', fromLibrary: lib.d.item.id });
  ok('从常用库套用到简历', applied.d?.ok && applied.d.name.startsWith('avatar'));
  ok('删除常用素材', (await j('DELETE', '/api/media-library/' + lib.d.item.id)).d?.ok);
  ok('删除头像文件', (await j('DELETE', '/api/resumes/' + enc(slug) + '/assets/avatar')).d?.ok);
  await j('DELETE', '/api/resumes/' + enc(copySlug));

  console.log('\n模型列表');
  await j('PUT', '/api/settings', { llm: { preset: 'custom', baseUrl: 'http://127.0.0.1:' + LLM_PORT + '/v1', apiKey: 'sk-test', model: 'fake' } });
  const models = await j('POST', '/api/settings/models', {});
  ok('假服务 /v1/models', models.d?.ok && (models.d.models || []).includes('fake') && models.d.models.includes('fake-pro') && models.d.source === 'openai', JSON.stringify(models.d));
  const ollama = await j('POST', '/api/settings/models', { baseUrl: 'http://127.0.0.1:' + LLM_PORT, preset: 'ollama' });
  ok('Ollama /api/tags 回退', ollama.d?.ok && (ollama.d.models || []).includes('qwen2.5:7b') && ollama.d.source === 'ollama', JSON.stringify(ollama.d));
  const missed = await j('POST', '/api/settings/models', { baseUrl: 'http://127.0.0.1:1/v1', preset: 'deepseek', apiKey: 'sk-test' });
  ok('连不上时回退推荐列表并给提示', missed.d?.fallback && (missed.d.models || []).includes('deepseek-chat') && missed.d.error && missed.d.hint, JSON.stringify(missed.d));
  const noKey = await j('POST', '/api/settings/models', { baseUrl: 'https://api.deepseek.com/v1', apiKey: '', preset: 'deepseek' });
  ok('云厂商缺 Key 时提示', noKey.d?.fallback && /Key/.test(noKey.d.error || '') , JSON.stringify(noKey.d));
  await j('PUT', '/api/settings', { llm: { modelsByTask: { diagnose: 'fake-pro', rewrite: 'fake', interview: '' } } });
  ok('按任务保存模型', (await j('GET', '/api/settings')).d?.llm?.modelsByTask?.diagnose === 'fake-pro');

  console.log('\n简历内联重命名同步');
  const rnSrc = await j('POST', '/api/resumes', { name: 'T-改名前', from: slug, unique: true });
  const rnFrom = rnSrc.d?.slug || 'T-改名前';
  const rnApp = await j('POST', '/api/apps', { company: '重命名公司', resumeSlug: rnFrom, status: '已投递' });
  const rnJd = await j('POST', '/api/jds', { company: '重命名厂', role: 'x', baseSlug: rnFrom, text: 'abc' });
  const rnIv = await j('POST', '/api/interviews', { resumeSlug: rnFrom, type: 'tech', rounds: 3 });
  ok('重命名非法字符拒绝', (await j('POST', '/api/resumes/' + enc(rnFrom) + '/rename', { name: 'a/b' })).status === 400);
  const renamed = await j('POST', '/api/resumes/' + enc(rnFrom) + '/rename', { name: 'T-改名后' });
  ok('重命名成功', renamed.d?.ok && renamed.d.slug === 'T-改名后');
  ok('投递记录引用已更新', (await j('GET', '/api/apps')).d?.items?.some((x) => x.id === rnApp.d.item.id && x.resumeSlug === 'T-改名后'));
  ok('JD 引用已更新', (await j('GET', '/api/jds')).d?.items?.some((x) => x.id === rnJd.d.item.id && x.baseSlug === 'T-改名后'));
  ok('模拟面试引用已更新', (await j('GET', '/api/interviews/' + rnIv.d.item.id)).d?.item?.resumeSlug === 'T-改名后');
  ok('重名拒绝', (await j('POST', '/api/resumes/' + enc('T-改名后') + '/rename', { name: slug })).status === 400);
  await j('DELETE', '/api/interviews/' + rnIv.d.item.id);
  await j('DELETE', '/api/apps/' + rnApp.d.item.id);
  await j('DELETE', '/api/jds/' + rnJd.d.item.id);
  await j('DELETE', '/api/resumes/' + enc('T-改名后'));

  console.log('\nJD 删除与撤销');
  const baseCopy = await j('POST', '/api/resumes', { name: 'T-JD底稿', from: slug, unique: true });
  const tailored = await j('POST', '/api/resumes', { name: 'T-JD定制', from: slug, unique: true });
  const delJd = await j('POST', '/api/jds', { company: '待删公司', role: '待删岗位', text: 'jd', baseSlug: baseCopy.d.slug, tailoredSlug: tailored.d.slug });
  const linkedApp = await j('POST', '/api/apps', { company: '待删公司', role: '待删岗位', jdId: delJd.d.item.id, resumeSlug: tailored.d.slug, status: '已投递' });
  const gone = await j('DELETE', '/api/jds/' + delJd.d.item.id);
  ok('单条删除 JD', gone.d?.ok && gone.d.deleted?.length === 1);
  ok('投递记录仅解除关联', (await j('GET', '/api/apps')).d?.items?.some((x) => x.id === linkedApp.d.item.id && !x.jdId));
  ok('默认不删定制版简历', (await j('GET', '/api/resumes/' + enc(tailored.d.slug))).d?.html);
  const restored = await j('POST', '/api/jds/_restore', { snapshots: gone.d.deleted });
  ok('撤销删除 JD', restored.d?.ok && (await j('GET', '/api/jds')).d?.items?.some((x) => x.id === delJd.d.item.id));
  ok('撤销后投递重新关联', (await j('GET', '/api/apps')).d?.items?.some((x) => x.id === linkedApp.d.item.id && x.jdId === delJd.d.item.id));
  const batch = await j('POST', '/api/jds/_batch', { ids: [delJd.d.item.id], deleteTailored: true });
  ok('批量删除并可删定制版', batch.d?.ok && batch.d.deleted?.[0]?.trashed?.slug === tailored.d.slug, JSON.stringify(batch.d));
  ok('定制版已移出简历库', (await j('GET', '/api/resumes/' + enc(tailored.d.slug))).status === 404);
  ok('批量撤销还原定制版', (await j('POST', '/api/jds/_restore', { snapshots: batch.d.deleted })).d?.ok && (await j('GET', '/api/resumes/' + enc(tailored.d.slug))).d?.html);
  await j('DELETE', '/api/jds/' + delJd.d.item.id);
  await j('DELETE', '/api/apps/' + linkedApp.d.item.id);
  await j('DELETE', '/api/resumes/' + enc(tailored.d.slug));
  await j('DELETE', '/api/resumes/' + enc(baseCopy.d.slug));


  console.log('\n正文清理与发给模型的文本');
  const polluted = (await j('GET', '/api/resumes/' + enc(slug))).d.html.replace(
    '<div class="user-name">',
    '<div class="rp-media-bar" data-rp-chrome="media"><button>更换</button><button>编辑</button><button>删除</button></div>更换编辑删除<div class="user-name">'
  );
  const afterPut = await j('PUT', '/api/resumes/' + enc(slug), { html: polluted });
  const afterHtml = (await j('GET', '/api/resumes/' + enc(slug))).d.html;
  ok('写入受污染正文被自动剥离', afterPut.d?.ok && !afterHtml.includes('更换编辑删除') && !afterHtml.includes('rp-media-bar'));

  const polluteDir = path.join(HOME, 'resumes', 'T-污染清理');
  fs.mkdirSync(polluteDir, { recursive: true });
  fs.writeFileSync(path.join(polluteDir, 'meta.json'), JSON.stringify({ name: 'T-污染清理' }));
  fs.writeFileSync(path.join(polluteDir, 'body.html'), '<div id="cv-container"><div class="main"><div class="content-scroll"><div class="user-name">被污染</div><div class="rp-media-bar" data-rp-chrome="media"><button>更换</button><button>编辑</button><button>删除</button></div>更换编辑删除</div></div></div>');
  const fixer = spawn(process.execPath, ['-e', "import { repairAllBodies } from './lib/store.mjs'; const f = repairAllBodies(); console.log(JSON.stringify(f));"], { cwd: ROOT, env: { ...process.env, RESUME_HOME: HOME } });
  const outFix = await new Promise((res) => { let s = ''; fixer.stdout.on('data', (d) => s += d); fixer.stderr.on('data', (d) => s += d); fixer.on('close', () => res(s)); });
  const fixedBody = fs.readFileSync(path.join(polluteDir, 'body.html'), 'utf8');
  ok('启动时自动修复已被污染的 body.html', outFix.includes('T-污染清理') && !fixedBody.includes('更换编辑删除') && !fixedBody.includes('rp-media-bar') && fixedBody.includes('被污染'), outFix.slice(0, 240));
  fs.rmSync(polluteDir, { recursive: true, force: true });

  await j('PUT', '/api/settings', { mock: false, llm: { preset: 'custom', baseUrl: 'http://127.0.0.1:' + LLM_PORT + '/v1', model: 'fake', apiKey: 'sk-test' } });
  const resumeRefs = { text: '# 基本信息\n张明\n\n## 实习经历\n### W1 某公司\n负责后端开发', items: [{ id: 'works-1', module: 'works', moduleTitle: '实习经历', title: '某公司', html: '<ul><li>负责后端开发</li></ul>', text: '负责后端开发', editable: true }] };
  const dref = await sse({ task: 'diagnose', resume: resumeRefs });
  const dumped = JSON.stringify(dref.result || {});
  ok('诊断结果不含原始 DOM id 且短编号已映射', dref.result?.data?.score === 77 && dref.result?.data?.issues?.[0]?.itemId === 'works-1' && !/works-26952309|project_experience-|reasearch_experience/.test(dumped), dumped.slice(0, 400));
  await j('PUT', '/api/settings', { llm: { model: 'fake-think' } });
  const dthink = await sse({ task: 'diagnose', resume: resumeRefs });
  ok('带 think 标签与代码围栏仍能解析 JSON', dthink.result?.data?.score === 77, JSON.stringify(dthink.error || dthink.result?.data));
  await j('PUT', '/api/settings', { llm: { model: 'fake-split-utf8' } });
  const dsplit = await sse({ task: 'chat', resume: resumeRefs, messages: [{ role: 'user', content: 'UTF8SPLIT 你好' }] });
  const splitText = String((dsplit.result || {}).text || '');
  ok('跨包 UTF-8 流式拼出完整句子', splitText.includes('结构适中') && splitText.includes('量化程度很好'), JSON.stringify(dsplit.result || dsplit.error).slice(0, 200));

  console.log('\n结构编辑（浏览器）');
  try {
    await runV41Browser({ ok, base: B, slug, home: HOME });
  } catch (err) {
    ok('结构编辑浏览器测试', false, String((err && err.stack) || err));
  }

  console.log('\n编辑态选中 / 回车（浏览器，v4.2）');
  try {
    await runV42Browser({ ok, base: B, slug, j });
  } catch (err) {
    ok('v4.2 浏览器测试', false, String((err && err.stack) || err));
  }

  console.log('\n条目对齐 / 示例数据（浏览器，v4.3）');
  try {
    await runV43Browser({ ok, base: B, slug, j });
  } catch (err) {
    ok('v4.3 浏览器测试', false, String((err && err.stack) || err));
  }

  if (withPdf) {
    console.log('\nPDF');
    const t = Date.now();
    const pdf = await j('POST', '/api/resumes/' + enc(slug) + '/pdf');
    ok('导出 PDF（' + (Date.now() - t) + 'ms）', pdf.d?.ok && pdf.d.bytes > 10000, JSON.stringify(pdf.d));
    for (const tpl of (tps.d?.items || []).map((x) => x.id)) {
      await j('PATCH', '/api/resumes/' + enc(slug) + '/meta', { template: tpl });
      const t0 = Date.now();
      const r = await j('POST', '/api/resumes/' + enc(slug) + '/pdf');
      ok('模板 ' + tpl + ' 可导出 PDF（' + (Date.now() - t0) + 'ms, ' + Math.round((r.d?.bytes || 0) / 1024) + 'KB）', r.d?.ok && r.d.bytes > 8000, JSON.stringify(r.d));
    }
  }
} catch (e) {
  fail++; console.error(e);
} finally {
  for (const p of procs) p.kill();
  await sleep(200);
  fs.rmSync(HOME, { recursive: true, force: true });
  console.log('\n' + (fail ? '❌' : '✅') + ' 通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
}
