// v4.2 单元测试：成稿规范提示词、素材匹配、成稿检查、操作栏定位
import { buildMessages, WRITING_SPEC, storiesBlock } from '../lib/agent/prompts.mjs';
import { lintBullets, cvLen, hasLeadIns, BULLET_SPEC } from '../public/js/bullet-lint.js';
import { matchStories } from '../public/js/story-match.js';
import { placeBar } from '../public/js/overlay.js';

export function runV42Unit(ok) {
  console.log('\nv4.2 提示词与成稿规范');
  const item = { id: 'project_experience-1', ref: 'P1', title: '园区访客系统', moduleTitle: '项目经历', html: '<ul><li>做了登记</li><li>做了检索</li></ul>' };
  const leadItem = { ...item, ref: 'P2', id: 'project_experience-2', html: '<ul><li><strong>并发控制</strong>：用乐观锁</li></ul>' };
  const resume = { text: '### P1 园区访客系统\n• 做了登记', items: [item, leadItem] };
  const story = { id: 'st_secret_1', title: '园区访客系统', org: '某园区', action: '实现三级降级检索', metrics: ['78 个接口'], forItems: ['P1'], sourceItemId: 'project_experience-1' };
  const content = (task, extra = {}) => buildMessages({ task, resume, items: [item, leadItem], modules: [{ id: 'project_experience', title: '项目经历' }], jd: { text: 'x'.repeat(40) }, style: 'polish', story, stories: [story], ...extra }).messages.map((m) => m.content).join('\n');
  for (const task of ['rewrite', 'tailor', 'story_write', 'compress']) {
    const c = content(task);
    ok(task + ' 带上简历成稿规范（字数 / 条数 / 不加小标题 / 不新增数字）', c.includes('【简历成稿规范】') && c.includes(BULLET_SPEC.ideal[0] + '-' + BULLET_SPEC.ideal[1] + ' 个汉字') && /小标题/.test(c) && /不新增任何原文和素材里没有的数字/.test(c));
  }
  const rw = content('rewrite');
  ok('改写提示词：素材用短编号 S1，且不暴露素材内部 id', rw.includes('素材 S1') && !rw.includes('st_secret_1') && rw.includes('对应简历条目：P1'));
  ok('改写提示词：素材只能用于对应经历、不得跨经历挪用', /不能把 A 项目的数字、技术、职责挪到 B 项目/.test(rw) && /usedStories/.test(rw));
  ok('改写提示词：逐条告知原文有没有小标题', rw.includes('原文是否用「xx：」小标题起句：否') && rw.includes('原文是否用「xx：」小标题起句：是'));
  ok('核心规则不再鼓励自加小标题', !/也可用「要点起句」/.test(content('diagnose')));
  ok('素材生成条目不再用「任务/行动/结果」分栏', /不要写成「任务：」「行动：」「结果：」/.test(content('story_write')));
  ok('无素材时不输出素材段', storiesBlock([]) === '' && !buildMessages({ task: 'rewrite', resume, items: [item], stories: [] }).messages[1].content.includes('素材 S'));
  ok('规范常量与检查一致', WRITING_SPEC.includes('硬上限 ' + BULLET_SPEC.max));

  console.log('\nv4.2 成稿检查');
  ok('计字：中文 1、英文数字半个', cvLen('接入 PaddleOCR') === 7);
  const long = '<ul><li>' + '实现'.repeat(50) + '</li><li>完成接口联调并上线到测试环境供团队使用</li></ul>';
  ok('超长 bullet 报警', lintBullets(long).some((l) => /超过 90 字/.test(l.text)));
  ok('新增小标题报警（原文没有）', lintBullets('<ul><li><strong>多源内容提取</strong>：接入 OCR 识别截图和 PDF，修复断行</li></ul>', { before: '<ul><li>接入 OCR</li></ul>' }).some((l) => /小标题/.test(l.text)));
  ok('原文就有小标题不报警', !lintBullets('<ul><li><strong>并发控制</strong>：用乐观锁避免重复扣款，保证账户余额一致</li></ul>', { before: leadItem.html }).some((l) => /小标题/.test(l.text)));
  ok('凭空出现的数字报警', lintBullets('<ul><li>检索准确率提升 35%，接口延迟降到 120ms 以内</li></ul>', { before: '<ul><li>优化检索</li></ul>' }).some((l) => /35、120/.test(l.text)));
  ok('素材里有的数字不报警', !lintBullets('<ul><li>交付 78 个 REST 接口，覆盖登记、审批和通行全部流程</li></ul>', { before: '<ul><li>交付接口</li></ul>', sources: JSON.stringify(story) }).some((l) => /数字/.test(l.text)));
  ok('【待补充】里的内容不算新数字', !lintBullets('<ul><li>优化检索链路，命中率提升【待补充：优化前后 2 组数据】</li></ul>', { before: '<ul><li>优化检索</li></ul>' }).some((l) => /数字/.test(l.text)));
  ok('超过 5 条 bullet 报警', lintBullets('<ul>' + '<li>完成某模块的接口开发与联调测试工作并交付</li>'.repeat(6) + '</ul>').some((l) => /5 条以内/.test(l.text)));
  ok('小标题识别', hasLeadIns(leadItem.html) && !hasLeadIns(item.html));

  console.log('\nv4.2 素材匹配');
  const stories = [
    { id: 'a', title: '园区访客系统', org: '某园区', stack: ['LangChain'], sourceItemId: 'project_experience-1' },
    { id: 'b', title: '缓存穿透防护', org: '测试公司', stack: ['Redis'] },
    { id: 'c', title: '完全无关的社团活动', org: '学生会' },
  ];
  const m = matchStories(stories, [{ id: 'project_experience-1', ref: 'P1', title: '园区访客系统', text: '用 LangChain 做问答' }, { id: 'w', ref: 'W1', title: '测试公司 后端实习', text: '用 Redis 做缓存' }]);
  ok('素材按来源 / 标题 / 组织匹配到对应条目', m.find((x) => x.story.id === 'a')?.items.includes('P1') && m.find((x) => x.story.id === 'b')?.items.includes('W1'), JSON.stringify(m.map((x) => [x.story.id, x.items])));
  ok('无关素材不会自动带上', !m.some((x) => x.story.id === 'c'));

  console.log('\nv4.2 操作栏定位');
  const box = { left: 40, top: 300, width: 700, height: 80 };
  const side = placeBar(box, { width: 34, height: 120 }, { width: 794, height: 1123 }, 4, 40);
  ok('有右侧留白时竖排停靠在纸张外，不压任何内容', side.where === 'side' && side.left >= 794 && side.top === 300);
  const below = placeBar(box, { width: 190, height: 24 }, { width: 794, height: 1123 });
  ok('没留白时放在选中框下方（不压上一个框）', below.where === 'below' && below.top >= box.top + box.height && below.left + 190 <= 794);
  const bottom = placeBar({ left: 40, top: 1090, width: 700, height: 30 }, { width: 190, height: 24 }, { width: 794, height: 1123 });
  ok('页面底部放不下时翻到上方，且不越界', bottom.where === 'above' && bottom.top + 24 <= 1123);
  const tall = placeBar({ left: 0, top: 0, width: 794, height: 1123 }, { width: 190, height: 24 }, { width: 794, height: 1123 });
  ok('整页选中时放在框内右上角', tall.where === 'inside' && tall.top >= 2 && tall.left >= 2);
  const sideClamp = placeBar({ left: 40, top: 1100, width: 700, height: 20 }, { width: 34, height: 120 }, { width: 794, height: 1123 }, 4, 40);
  ok('竖排工具栏不超出纸张底部', sideClamp.top + 120 <= 1123);
}
