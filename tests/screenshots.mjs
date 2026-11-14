// 生成 README / 汇报用截图：node tests/screenshots.mjs [输出目录] [端口]
// 需要工作台已在运行：先 node tests/demo-server.mjs 用示例数据启动（建议打开演示模式）
import { launch } from './browser.mjs';

const OUT = process.argv[2] || 'shots';
const B = 'http://127.0.0.1:' + (process.argv[3] || 4321) + '/';
const p = await launch({ width: 1600, height: 1000, scale: 1.5 });
const shot = async (name) => { await p.sleep(600); await p.shot(OUT + '/' + name + '.png'); console.log('✓', name); };
const click = (sel) => p.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);
const JD = `岗位：大模型应用开发实习生（Agent 方向）
岗位职责：
1. 负责基于大模型的 Agent / RAG 应用研发，参与知识库问答、智能客服等业务落地；
2. 参与 Prompt 工程、工具调用（Function Calling）与评测体系建设；
3. 负责后端服务开发与性能优化，保障线上服务稳定。
任职要求：
1. 本科及以上学历，计算机相关专业，每周实习 4 天以上，实习 3 个月以上；
2. 熟悉 Python 或 Java，具备扎实的数据结构与算法基础；
3. 熟悉 LangChain / LlamaIndex 等框架，了解向量数据库（Milvus、FAISS）与检索重排；
4. 熟悉 MySQL、Redis，了解 Docker；
加分项：有 LoRA 微调或模型评测经验；有开源项目或技术博客；熟悉 Kubernetes。`;

try {
  const slug = (await (await fetch(B + 'api/resumes')).json()).items.filter((r) => !r.target)[0].slug;
  // 编辑器 + 诊断
  await p.goto(B + '#/editor/' + encodeURIComponent(slug));
  await p.waitFor("document.querySelector('#outline .ol-mod') && document.querySelector('#d-run')", 30000);
  await p.eval("document.querySelector('#d-target').value = '大模型应用开发实习'");
  await click('#d-run');
  await p.waitFor("document.querySelector('.diag-top')", 40000);
  await p.eval("document.querySelector('#d-out [data-loc]')?.click()");
  await shot('01-编辑器-简历预览与AI诊断');
  // 改写对比
  await click('#tabs [data-t=rewrite]');
  await p.waitFor("document.querySelector('#tlist input[data-id]')");
  await p.eval("[...document.querySelectorAll('#tlist input[data-id]')].filter(i => /^(works|project_experience)-/.test(i.dataset.id)).slice(0, 2).forEach(i => i.click())");
  await click('#styles [data-s=quant]');
  await click('#rw-run');
  await p.waitFor("document.querySelector('.diff-card [data-a=acc]')", 40000);
  await p.eval("document.querySelector('#rw-out').scrollIntoView({ block: 'start' })");
  await shot('02-编辑器-AI改写原文与新文对比');
  // 深色主题
  await p.eval("document.documentElement.dataset.theme = 'dark'");
  await shot('03-编辑器-深色主题');
  await p.eval("document.documentElement.dataset.theme = 'light'");
  // JD 适配
  await p.goto(B + '#/jd/new');
  await p.waitFor("document.querySelector('[name=text]')");
  await p.eval(`(() => { const set=(n,v)=>{const f=document.querySelector('[name='+n+']'); f.value=v; f.dispatchEvent(new Event('input',{bubbles:true}));}; set('company','字节跳动'); set('role','大模型应用开发实习'); set('link','https://jobs.bytedance.com'); set('text', ${JSON.stringify(JD)}); return 1; })()`);
  const names = ['04-JD适配-解析结果', '05-JD适配-匹配诊断与证据矩阵', '06-JD适配-一键生成定制版简历', '07-JD适配-面试追问'];
  for (const name of names) {
    const before = await p.eval("document.querySelector('.step.cur')?.textContent");
    await click('#go');
    await p.waitFor(`document.querySelector('.step.cur')?.textContent !== ${JSON.stringify(before)}`, 40000);
    if (name.includes('面试')) { await p.waitFor("document.querySelector('#go')"); await click('#go'); await p.waitFor("document.querySelector('#out .qa')", 40000); }
    await shot(name);
  }
  // 投递管理
  for (const [v, name] of [['calendar', '08-投递日历'], ['kanban', '09-投递看板'], ['stats', '10-投递统计']]) {
    await p.goto(B + '#/apps');
    await p.waitFor("document.querySelector('#views')");
    await click('#views [data-v=' + v + ']');
    await shot(name);
  }
  await p.goto(B + '#/dashboard'); await p.sleep(800); await shot('11-工作台首页');
  await p.goto(B + '#/resumes'); await p.sleep(2000); await shot('12-简历库');
  await p.goto(B + '#/settings'); await p.sleep(800); await shot('13-设置-大模型接口');
} catch (e) {
  console.error('截图失败：', e.message);
  await p.shot(OUT + '/error.png');
  process.exitCode = 1;
}
if (p.logs.length) console.log('浏览器日志：\n' + p.logs.join('\n'));
await p.close();
