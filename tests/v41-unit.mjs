// v4.1 单元测试：UTF-8 分块、SSE 跨包、think 标签、引用编号、正文清理
import { stripEditorChrome, looksPolluted } from '../lib/sanitize-body.mjs';
import { extractJson, stripThink, consumeOpenAiStream, splitSseEvents, parseSseEvent } from '../lib/agent/llm.mjs';
import { ensureItemRefs, remapAgentItemIds, rewriteRawIds, buildRefIndex, chipifyHtml } from '../public/js/refs.js';

export async function runV41Unit(ok) {
  console.log('\n乱码修复 / 引用 / 清理');

  const dirty = '<div class="user-name">张明</div><div class="rp-media-bar" data-rp-chrome="media"><button>更换</button><button>编辑</button><button>删除</button></div><img class="edu-crest" src="x"><span class="rp-add-crest" data-rp-chrome="crest">+</span>更换编辑删除';
  ok('污染检测', looksPolluted(dirty));
  const clean = stripEditorChrome(dirty);
  ok('剥离工具栏节点', !/rp-media-bar|edu-crest|rp-add-crest|data-rp-chrome/.test(clean));
  ok('去掉「更换编辑删除」拼接字', !clean.includes('更换编辑删除') && !clean.includes('更换') && !clean.includes('编辑') && !clean.includes('删除'));
  ok('保留正文', clean.includes('张明'));
  ok('干净正文不算污染', !looksPolluted('<div class="user-name">张明 软删除 可视化规则编辑器</div>'));
  // 简历正文里单独出现「编辑器」「软删除」不得误删
  const keep = stripEditorChrome('<p>可视化规则编辑器，支持软删除。</p>');
  ok('不误伤正文里的「编辑器/软删除」', keep.includes('编辑器') && keep.includes('软删除'));

  ok('stripThink 闭合', stripThink('<think>abc</think>{"a":1}') === '{"a":1}');
  ok('stripThink 未闭合', !stripThink('<think>还在想{"a":1}').includes('<think>'));
  const j1 = extractJson('<think>我先分析</think>\n```json\n{"score":88,"verdict":"可"}\n```');
  ok('think + fence 取出 JSON', j1.score === 88);
  const j2 = extractJson('<think>未闭合的思考\n{"score":12}');
  ok('未闭合 think 仍能取 JSON', j2.score === 12);

  const pieces = [];
  const ev = 'data: ' + JSON.stringify({ choices: [{ delta: { content: '结构适中，量化程度很好。' } }] }) + '\n\n';
  const buf = Buffer.from(ev, 'utf8');
  const mid = buf.indexOf(Buffer.from('中', 'utf8')) + 1; // 切在「中」这个字的中间
  async function* splitBytes(a, b) { yield a; yield b; }
  const full = await consumeOpenAiStream(splitBytes(buf.subarray(0, mid), buf.subarray(mid)), { onDelta: (t) => pieces.push(t) });
  ok('UTF-8 汉字中间切 chunk 能拼回完整句', full === '结构适中，量化程度很好。', JSON.stringify({ full, pieces, mid }));

  const ev2 = 'data: ' + JSON.stringify({ choices: [{ delta: { content: '度、16 线程' } }] }) + '\n\n';
  const b2 = Buffer.from(ev2, 'utf8');
  const cut = Math.floor(b2.length / 2);
  const full2 = await consumeOpenAiStream(splitBytes(b2.subarray(0, cut), b2.subarray(cut)), {});
  ok('一个 SSE 事件跨两个 TCP 包', full2 === '度、16 线程', JSON.stringify({ full2, cut }));

  const items = ensureItemRefs([
    { id: 'project_experience-38349442', module: 'project_experience', moduleTitle: '项目经历', title: '园区访客智慧自助登记系统 ｜ 后端' },
    { id: 'works-26952309', module: 'works', moduleTitle: '实习经历', title: '某某公司' },
    { id: 'reasearch_experience-35561112', module: 'reasearch_experience', moduleTitle: '研究经历', title: '课题' },
  ]);
  ok('短编号 P1/W1/R1', items[0].ref === 'P1' && items[1].ref === 'W1' && items[2].ref === 'R1', JSON.stringify(items.map((i) => i.ref)));
  const data = remapAgentItemIds({
    issues: [{ itemId: 'P1', problem: '见 [project_experience-38349442] 与 reasearch_experience 字段' }],
    items: [{ id: 'W1', html: '<p>x</p>' }],
  }, { items });
  ok('短编号写回内部 id', data.issues[0].itemId === 'project_experience-38349442' && data.items[0].id === 'works-26952309');
  ok('评语里不留原始 id / 错拼字段名', !/project_experience-38349442|reasearch_experience/.test(data.issues[0].problem), data.issues[0].problem);
  const html = chipifyHtml('建议把 P1 写清楚结果', items);
  ok('前端引用渲染成定位 chip', html.includes('class="rp-ref"') && html.includes('data-loc="project_experience-38349442"') && !html.includes('project_experience-38349442</button>'));
}
