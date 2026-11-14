import { ensureItemRefs } from '../../public/js/refs.js';
// 演示模式：没有 API Key 时，用本地规则生成"像样"的结果，用来走通 UI 流程、测试解析与写回。
// 结果都带「演示」字样，不代表真实 AI 分析。

const RISKY = [
  ['主导', '主导需要证明你对目标、关键决策和结果负主要责任', '负责'],
  ['上线', '上线需要发布记录、真实用户或流量数据', '完成并部署'],
  ['企业级', '企业级需要规模、可靠性等证据', '面向企业内部的'],
  ['显著提升', '没有数据的"显著提升"容易被追问', '提升【待补充：前后对比数据】'],
  ['精通', '精通在面试中会被深挖到底层原理', '熟练使用'],
  ['全面负责', '全面负责边界不清', '负责'],
  ['赋能', 'AI 腔空话', '支持'],
  ['闭环', 'AI 腔空话', '完整流程'],
];

export const TECH_TERMS = [
  'Python', 'Java', 'Go', 'Golang', 'C++', 'C#', 'Rust', 'JavaScript', 'TypeScript', 'SQL', 'Shell',
  'PyTorch', 'TensorFlow', 'Transformer', 'LLM', '大模型', 'RAG', 'Agent', '智能体', 'LangChain', 'LlamaIndex', 'LoRA', 'SFT', 'RLHF', 'DPO', 'PPO', 'GRPO',
  '微调', '预训练', '后训练', '强化学习', '推理加速', 'vLLM', 'DeepSpeed', 'Megatron', 'CUDA', '量化', '蒸馏', 'Prompt', '提示词', '评测', '向量数据库', '检索', '召回', '排序', '重排', 'Embedding',
  '机器学习', '深度学习', '计算机视觉', 'NLP', '自然语言处理', '多模态', 'OCR', '目标检测', '推荐系统', '搜索',
  'Spring Boot', 'Spring Cloud', 'Spring', 'MyBatis', 'MySQL', 'PostgreSQL', 'Redis', 'MongoDB', 'Elasticsearch', 'Kafka', 'RabbitMQ', 'Docker', 'Kubernetes', 'K8s', 'Linux', 'Nginx', 'Git',
  '分布式', '微服务', '高并发', '高可用', '缓存', '消息队列', '数据库', '性能优化', 'JVM', '多线程', '并发', '网络', '操作系统', '数据结构', '算法',
  'Vue', 'React', 'Node.js', 'Express', 'FastAPI', 'Flask', 'Django', 'RESTful', 'gRPC', 'JWT', 'RBAC',
  '数据分析', 'Pandas', 'Spark', 'Hadoop', 'Hive', 'Flink', 'ETL', 'Tableau', 'A/B 测试', '英语', 'CET-6', 'CET-4', '本科', '硕士', '博士', '实习',
];

function hash(str) { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
const clamp = (n, a, b) => Math.max(a, Math.min(b, Math.round(n)));

export function findTerms(text) {
  const t = String(text || '');
  const lower = t.toLowerCase();
  return TECH_TERMS.filter((k) => lower.includes(k.toLowerCase()));
}

export function lintItems(items) {
  const issues = [];
  const risky = [];
  for (const it of items || []) {
    const text = it.text || '';
    if (!text.trim()) continue;
    for (const [word, why, safer] of RISKY) {
      if (text.includes(word)) {
        const idx = text.indexOf(word);
        risky.push({ itemId: it.ref || it.id, text: text.slice(Math.max(0, idx - 12), idx + 24), risk: why, saferWording: '考虑改为「' + safer + '」，或补充证据' });
      }
    }
    const bullets = text.split(/\n+/).filter((l) => l.trim().length > 8);
    const noNum = bullets.filter((l) => !/\d/.test(l));
    if (bullets.length >= 2 && noNum.length / bullets.length > 0.6) {
      issues.push({ level: 'medium', itemId: it.ref || it.id, module: it.moduleTitle, problem: '「' + (it.title || it.moduleTitle).slice(0, 20) + '」（' + (it.ref || '') + '）多数条目没有量化结果', suggestion: '为关键动作补充规模、频次、前后对比等可验证结果', evidenceNeeded: '真实的数据或规模（可用约/超过/区间）' });
    }
    if (bullets.some((l) => l.length > 120)) {
      issues.push({ level: 'low', itemId: it.ref || it.id, module: it.moduleTitle, problem: '存在超过 120 字的长句，HR 扫读成本高', suggestion: '拆成「要点起句 + 动作 + 结果」的短句', evidenceNeeded: '' });
    }
  }
  return { issues, risky };
}

function diagnose(p) {
  const items = p.resume?.items || [];
  const text = p.resume?.text || '';
  const { issues, risky } = lintItems(items);
  const nums = (text.match(/\d+(\.\d+)?\s*(%|个|项|张|人|万|倍|ms|s|\+)/g) || []).length;
  const quant = clamp(45 + nums * 3, 40, 92);
  const cred = clamp(88 - risky.length * 6, 50, 95);
  const len = text.length;
  const struct = clamp(len > 600 ? 84 : 70, 50, 92);
  const dir = clamp(text.includes('总结') || text.includes('评价') ? 78 : 62, 50, 90);
  const lang = clamp(82 - issues.filter((i) => i.level === 'low').length * 4, 55, 92);
  const score = clamp((quant + cred + struct + dir + lang) / 5, 0, 100);
  const hl = items.filter((i) => /\d/.test(i.text)).slice(0, 3).map((i) => (i.title || i.moduleTitle).slice(0, 30) + '：有具体数字支撑');
  if (!issues.length) issues.push({ level: 'low', itemId: '', module: '整体', problem: '未发现明显结构问题', suggestion: '可以针对目标 JD 做定制', evidenceNeeded: '' });
  issues.unshift({ level: 'high', itemId: (items.find((i) => i.module === 'personal_summary')?.ref || items.find((i) => i.module === 'personal_summary')?.id || ''), module: '个人总结', problem: '（演示）个人总结没有点明目标岗位方向，HR 10 秒内难以判断你投什么岗', suggestion: '第一句写清"目标岗位 + 最相关的 1-2 段经历"', evidenceNeeded: '' });
  return {
    score, level: score >= 85 ? '优秀' : score >= 75 ? '良好' : score >= 60 ? '一般' : '待加强',
    verdict: '（演示模式）结构完整、技术细节丰富，量化与方向表达还有提升空间',
    tenSecond: '能看出是计算机方向的后端/全栈背景，但目标岗位不够明确，亮点需要更靠前。',
    dimensions: [
      { name: '结构与 ATS 可读性', score: struct, comment: '使用了标准栏目标题，时间线清晰（演示规则）' },
      { name: '内容具体与量化', score: quant, comment: '检测到 ' + nums + ' 处带单位的量化表达' },
      { name: '可信度与证据', score: cred, comment: '检测到 ' + risky.length + ' 处可能被追问的强表述' },
      { name: '方向清晰与亮点前置', score: dir, comment: '建议在总结中写明目标岗位' },
      { name: '表达与语言', score: lang, comment: '整体专业，个别长句可拆分' },
    ],
    highlights: hl.length ? hl : ['（演示）经历完整'],
    issues: issues.slice(0, 10),
    riskyClaims: risky.slice(0, 6),
    questions: ['（演示）你在最主要的项目里本人负责哪些模块？团队有几个人？', '（演示）系统有真实用户或上线记录吗？规模大约多少？'],
  };
}

function softenHtml(html, style) {
  let out = String(html || '');
  for (const [word, , safer] of RISKY) {
    if (word === '显著提升') continue;
    out = out.split(word).join(safer);
  }
  if (style === 'quant' || style === 'polish' || style === 'star' || style === 'jd' || style === 'tech' || style === 'custom') {
    let added = 0;
    out = out.replace(/<li>([\s\S]*?)<\/li>/g, (m, inner) => {
      if (added >= 2 || /待补充/.test(inner) || /\d/.test(inner.replace(/<[^>]+>/g, ''))) return m;
      added++;
      return '<li>' + inner.replace(/[。；;]?\s*$/, '') + '，【待补充：该项工作的规模或效果数据】。</li>';
    });
    if (!added && !/<li>/.test(out) && !/待补充/.test(out)) out = out.replace(/<\/p>\s*$/, '【待补充：量化结果】</p>');
  }
  if (style === 'concise') {
    out = out.replace(/<li>([\s\S]*?)<\/li>/g, (m, inner) => {
      const plain = inner;
      const cut = plain.split(/[；;]/)[0];
      return '<li>' + cut.replace(/[。]?\s*$/, '') + '。</li>';
    });
  }
  return out;
}

function rewrite(p) {
  return {
    items: (p.items || []).map((it) => {
      const html = softenHtml(it.html, p.style);
      return {
        id: it.ref || it.id,
        html,
        reason: html === it.html ? '无需修改' : '（演示）降级了缺乏证据的强动词，并在缺少结果的条目末尾标注了需要补充的数据',
        todos: (html.match(/【待补充：[^】]*】/g) || []).map((s) => s.slice(5, -1)),
        risk: '',
        usedStories: (p.stories || []).map((st, i) => ((st.forItems || []).includes(it.ref || it.id) ? 'S' + (i + 1) : '')).filter(Boolean),
      };
    }),
    summary: '（演示模式）这是本地规则生成的示例改写，用于体验流程；配置 API Key 后由大模型真实改写。',
  };
}

function jdAnalyze(p) {
  const jd = p.jd || {};
  const text = jd.text || '';
  const terms = findTerms(text);
  const lines = text.split(/\n+/).map((l) => l.replace(/^[\s\d.、\-*•·]+/, '').trim()).filter((l) => l.length > 4 && !/^(岗位|职位|工作)?(职责|要求|任职要求|任职资格|描述|内容|加分项|福利)[:：]?$/.test(l.replace(/\s/g, '')));
  const req = lines.filter((l) => /(要求|学历|本科|硕士|熟悉|掌握|经验|具备|能力|优先)/.test(l));
  const resp = lines.filter((l) => /(负责|参与|开发|设计|优化|构建|搭建|研究)/.test(l) && !req.includes(l) && !/^(岗位|职位|岗位名称|职位名称)[:：]/.test(l));
  const bonus = lines.filter((l) => /(优先|加分|更佳)/.test(l));
  return {
    company: jd.company || '（演示）未识别', role: jd.role || '（演示）未识别',
    roleType: terms.some((t) => /大模型|LLM|RAG|Agent|微调/.test(t)) ? '大模型 / AI 应用' : terms.some((t) => /Java|Spring|MySQL|Redis/.test(t)) ? '后端开发' : '技术岗',
    level: /实习/.test(text) ? '实习' : /校招|应届/.test(text) ? '校招' : '未说明',
    location: (text.match(/(北京|上海|深圳|杭州|广州|南京|成都|武汉|西安)/) || [''])[0],
    summary: '（演示）根据 JD 关键词推断：需要具备 ' + terms.slice(0, 4).join('、') + ' 等能力的候选人。',
    hardRequirements: req.filter((l) => !bonus.includes(l)).slice(0, 6).map((l, i) => ({ text: l.slice(0, 60), weight: i < 2 ? 'high' : 'medium', quote: l.slice(0, 80) })),
    responsibilities: resp.slice(0, 6).map((l) => l.slice(0, 70)),
    skills: terms.slice(0, 10).map((t, i) => ({ name: t, weight: i < 4 ? 'high' : i < 8 ? 'medium' : 'low' })),
    bonus: bonus.slice(0, 4).map((l) => l.slice(0, 60)),
    hiddenTests: ['（推断）会深挖项目中' + (terms[0] || '核心技术') + '的实际使用深度', '（推断）会考察基础算法与工程能力'],
    keywords: terms.slice(0, 16).map((t, i) => ({ word: t, weight: i < 5 ? 'high' : i < 10 ? 'medium' : 'low', synonyms: [] })),
    riskFlags: /硕士/.test(text) ? ['学历要求硕士及以上'] : [],
  };
}

function jdMatch(p) {
  const a = p.jd?.analysis || jdAnalyze(p);
  const text = (p.resume?.text || '').toLowerCase();
  const items = p.resume?.items || [];
  const kws = (a.keywords || []).map((k) => k.word || k);
  const covered = kws.filter((k) => text.includes(String(k).toLowerCase()));
  const missing = kws.filter((k) => !covered.includes(k));
  const ratio = kws.length ? covered.length / kws.length : 0.5;
  const score = clamp(40 + ratio * 50, 30, 92);
  const matrix = [...(a.hardRequirements || []).map((r) => ({ requirement: r.text, weight: r.weight })), ...(a.skills || []).slice(0, 6).map((s) => ({ requirement: '掌握 ' + s.name, weight: s.weight }))].slice(0, 10).map((r) => {
    const word = kws.find((k) => r.requirement.toLowerCase().includes(String(k).toLowerCase()));
    const hit = word && items.find((it) => it.text.toLowerCase().includes(String(word).toLowerCase()));
    const inSkillOnly = hit && hit.module === 'skill_list';
    return {
      requirement: r.requirement, weight: r.weight || 'medium',
      evidence: hit ? hit.text.slice(0, 50) : '', itemId: hit ? (hit.ref || hit.id) : '',
      type: hit ? (inSkillOnly ? 'weak' : 'direct') : 'none',
      status: hit ? (inSkillOnly ? '表述偏弱' : '材料充分') : '尚未体现',
      action: hit ? (inSkillOnly ? '在项目经历中补充该技能的真实使用场景' : '在描述中前置该关键词') : '若确有相关经历请补充，否则不要硬写',
    };
  });
  return {
    score, verdict: score >= 80 ? 'strong' : score >= 65 ? 'weak' : score >= 50 ? 'risky' : 'not_recommended',
    verdictText: '（演示）关键词覆盖 ' + covered.length + '/' + kws.length + '，' + (score >= 65 ? '可以投递并针对性优化' : '缺口较多，谨慎投递'),
    dimensions: [
      { name: '门槛符合', score: clamp(25 * Math.min(1, ratio + 0.3), 0, 25), max: 25, comment: '演示规则' },
      { name: '相关经历', score: clamp(25 * (ratio * 0.8 + 0.1), 0, 25), max: 25, comment: '演示规则' },
      { name: '技能对应', score: clamp(15 * ratio, 0, 15), max: 15, comment: '覆盖 ' + covered.length + ' 个' },
      { name: '成果可核验', score: 10, max: 15, comment: '演示规则' },
      { name: '职责层级', score: 8, max: 10, comment: '演示规则' },
      { name: '表达与版式', score: 8, max: 10, comment: '' },
    ],
    matrix,
    strengths: covered.slice(0, 3).map((k) => '简历中有「' + k + '」的相关经历'),
    gaps: missing.slice(0, 3).map((k) => 'JD 要求「' + k + '」，简历中未体现'),
    doNotForce: missing.slice(3, 5).map((k) => '「' + k + '」在材料里看不到对应经历，不宜牵强写入'),
    keywordsCovered: covered, keywordsMissing: missing,
    eliminationRisk: missing.length > kws.length / 2 ? '（演示）一半以上关键词未覆盖，初筛有风险' : '',
    strategy: '（演示）把与 ' + (covered[0] || 'JD') + ' 最相关的经历前置，压缩无关经历的篇幅。',
    questions: missing.slice(0, 3).map((k) => '你是否接触过「' + k + '」？在哪个项目里、做到什么程度？'),
  };
}

function tailor(p) {
  const a = p.jd?.analysis || {};
  const kws = (a.keywords || []).map((k) => k.word || k);
  const items = (p.items || []);
  const scored = items.map((it) => ({ it, hits: kws.filter((k) => it.text.toLowerCase().includes(String(k).toLowerCase())) }));
  const changed = scored.filter((s) => s.hits.length).slice(0, 5).map(({ it, hits }) => {
    let html = ['skill_list', 'honor', 'edus'].includes(it.module) ? String(it.html || '') : softenHtml(it.html, 'jd');
    for (const k of hits.slice(0, 2)) {
      const re = new RegExp('(?<![>\\w])(' + String(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![\\w<])');
      if (!new RegExp('<strong>[^<]*' + String(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(html)) html = html.replace(re, '<strong>$1</strong>');
    }
    return { id: it.ref || it.id, html, reason: '（演示）突出 JD 关键词：' + hits.slice(0, 3).join('、'), jdRequirement: hits.slice(0, 3).join('、'), todos: (html.match(/【待补充：[^】]*】/g) || []).map((s) => s.slice(5, -1)) };
  });
  const modules = p.modules || [];
  const modScore = (m) => scored.filter((s) => s.it.module === m.id).reduce((n, s) => n + s.hits.length, 0);
  const fixed = ['personal_summary', 'edus'];
  const order = [...modules.filter((m) => fixed.includes(m.id)), ...modules.filter((m) => !fixed.includes(m.id)).sort((x, y) => modScore(y) - modScore(x))].map((m) => m.id);
  const itemOrder = {};
  for (const m of modules) {
    const own = scored.filter((s) => s.it.module === m.id);
    if (own.length > 1) {
      const sorted = [...own].sort((x, y) => y.hits.length - x.hits.length).map((s) => s.it.id);
      if (sorted.join() !== own.map((s) => s.it.id).join()) itemOrder[m.id] = sorted;
    }
  }
  return {
    items: changed, moduleOrder: order, itemOrder,
    gaps: (p.match?.keywordsMissing || []).slice(0, 4),
    bossGreeting: '（演示）您好，我是' + (p.resume?.name || '') + '，看到贵司' + (p.jd?.role || '该岗位') + '的招聘。我有' + (kws.slice(0, 2).join('、') || '相关') + '方向的项目经历，期待进一步沟通，谢谢！',
    summary: '（演示模式）按关键词命中数前置了相关经历并加粗关键词；配置 API Key 后由大模型真实定制。',
  };
}

function interview(p) {
  const rank = { works: 0, project_experience: 1, reasearch_experience: 2, orgs: 3 };
  const items = (p.resume?.items || []).filter((i) => i.text && i.module in rank).sort((a, b) => rank[a.module] - rank[b.module]);
  const qs = [];
  for (const it of items.slice(0, 5)) {
    const num = (it.text.match(/[^。；\n]*\d+[^。；\n]*/) || [''])[0].slice(0, 40);
    qs.push({ round: '口径与边界', question: '在「' + ((it.title || '').split('｜')[0].trim().slice(0, 24) || it.moduleTitle) + '」里，哪些是你本人独立完成的？团队分工是怎样的？', target: it.text.slice(0, 40), itemId: it.ref || it.id, why: '确认个人贡献边界', mustCover: ['团队规模', '本人负责模块', '关键决策是否由你做出'], risk: 'medium' });
    if (num) qs.push({ round: '方案与权衡', question: '你写到「' + num + '」，这个数字是怎么得到的？基线和统计口径是什么？', target: num, itemId: it.ref || it.id, why: '数字必被追问口径', mustCover: ['测量方法', '对照基线', '统计周期'], risk: 'high' });
  }
  qs.push({ round: '临场情境', question: '如果线上出现数据不一致/接口超时，你会如何定位？', target: '', itemId: '', why: '考察排障思路', mustCover: ['监控与日志', '定位步骤', '复盘'], risk: 'low' });
  return {
    questions: qs.slice(0, 12),
    selfIntro: '（演示）面试官您好，我是' + (p.resume?.name || '') + '……（配置 API Key 后生成基于你简历事实的 1 分钟自我介绍）',
    prepare: ['（演示）准备每个数字的口径与来源', '准备一个项目的架构图', '梳理一次遇到问题并解决的经历'],
  };
}

function chat(p) {
  const last = [...(p.messages || [])].reverse().find((m) => m.role === 'user')?.content || '';
  return `**（演示模式）** 我还没有连接大模型，所以这是固定的示例回答。\n\n你问的是：「${String(last).slice(0, 60)}」\n\n配置好 API Key 后，我可以：\n- 针对某段经历给出更好的写法（缺数据处标【待补充】）\n- 解释某条表述在面试中可能被怎样追问\n- 根据 JD 建议哪些经历该前置\n\n👉 去左侧「设置」填写 DeepSeek / 通义千问 / Kimi 等任一 OpenAI 兼容接口即可。`;
}


function extract_jd(p) {
  const raw = String(p.text || p.pageText || '');
  return extractJdLocal(raw, p.title || '', p.url || '');
}

function extractJdLocal(raw, title, url) {
  const text = String(raw || '').replace(/\u00a0/g, ' ').trim();
  if (text.length < 20) return { ok: false, company: '', role: '', location: '', text: '', reason: '（演示）文本太短，不像一份 JD' };
  if (/请登录|验证码|cloudflare/i.test(text) && text.length < 400 && !/任职要求|岗位职责/.test(text)) {
    return { ok: false, company: '', role: '', location: '', text, reason: '（演示）这更像登录墙，请粘贴岗位全文' };
  }
  let company = '', role = '';
  const parts = String(title || '').split(/\s*[-_|·]+\s*/).map((x) => x.trim()).filter(Boolean);
  const drop = /招聘|Boss|牛客|拉勾|猎聘|智联|职位|详情/;
  const useful = parts.filter((x) => !drop.test(x) || /实习|工程师|开发/.test(x));
  if (useful.length >= 2) { role = useful[0]; company = useful[1]; }
  const mCo = text.match(/(?:公司名称|公司)\s*[:：]\s*([^\n]{2,30})/);
  const mRole = text.match(/(?:岗位名称|职位名称|职位)\s*[:：]\s*([^\n]{2,40})/);
  if (mCo) company = mCo[1].trim();
  if (mRole) role = mRole[1].trim();
  if (!company && /字节/.test(title + url + text)) company = '字节跳动';
  const idx = text.search(/(?:岗位职责|职位描述|任职要求|Responsibilities|Job Description)/i);
  const body = (idx >= 0 ? text.slice(idx) : text).slice(0, 8000);
  return { ok: body.length >= 40, company: company || '', role: role || '', location: (text.match(/(?:工作地点|地点)\s*[:：]\s*([^\n]{2,20})/) || ['',''])[1], text: body, reason: '（演示）按标题与关键词段落抽取，配置模型后会更准确' };
}

function compress(p) {
  const items = (p.items || []).filter((i) => (i.html || i.text) && !['honor', 'skill_list'].includes(i.module));
  const picked = items.slice(0, 6).map((it) => {
    let html = String(it.html || '');
    let n = 0;
    html = html.replace(/<li>([\s\S]*?)<\/li>/g, (m, inner) => {
      const t = inner.replace(/<[^>]+>/g, '');
      if (t.length > 80) { n++; return '<li>' + inner.replace(/，[^，]{12,}$/, '。').replace(/。{2,}/, '。') + '</li>'; }
      if (/赋能|闭环|抓手|全方位/.test(t)) { n++; return ''; }
      return m;
    });
    if (n === 0 && html.length > 80) { html = html.replace(/\s{2,}/g, ' '); n = 1; }
    return { id: it.ref || it.id, html, reason: '（演示）删去空话并缩短长句，事实与数字保留', savedLines: Math.max(1, n) };
  });
  return { pagesNow: p.pages || 2, overLines: p.overLines || 8, plan: '（演示）优先压缩与目标方向较远的长句，保留量化结果。配置模型后会按实际超出行数精细压缩。', items: picked, todos: [] };
}

const LABEL_EN = { '个人总结':'Personal Summary','教育经历':'Education','专业技能':'Skills','实习经历':'Internships','项目经历':'Projects','组织经历':'Leadership & Activities','研究经历':'Research','荣誉奖项':'Awards','电话':'Phone','邮箱':'Email','出生':'Born','性别':'Gender','民族':'Ethnicity','当前状态':'Status','至今':'Present' };

function translate(p) {
  const items = p.items || [];
  const modules = (p.modules || []).map((m) => ({ id: m.id, title: LABEL_EN[m.title] || m.title }));
  const dates = [{ from: '至今', to: 'Present' }];
  const translated = items.map((it) => {
    let html = String(it.html || '');
    html = html.replace(/负责/g, 'Responsible for').replace(/参与/g, 'Participated in').replace(/完成/g, 'Delivered').replace(/基于/g, 'Based on ').replace(/实现/g, 'implemented ').replace(/优化/g, 'optimized ').replace(/至今/g, 'Present');
    // Keep it clearly demo: prefix a comment in reason only
    if (!/<li>|<p>/.test(html) && html) html = '<p>' + html + '</p>';
    const title = [it.title || ''].map((t) => t.replace(/至今/g, 'Present').replace(/(\d{4})\s*年\s*(\d{1,2})\s*月/g, (_, y, m) => ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m-1] + ' ' + y)).join('');
    return { id: it.ref || it.id, title: title || it.title, org: '', role: '', html, reason: '（演示）保留数字与技术专有名词，条目改为动词开头的英文表达。配置模型后会使用更地道的简历英语。' };
  });
  const name = String(p.resume?.name || 'Candidate');
  const pinyin = name; // 演示模式不做拼音转换，配置模型后由模型按「名在前姓在后」给出
  return {
    name: pinyin,
    profileLabels: Object.entries(LABEL_EN).map(([from, to]) => ({ from, to })),
    profileLines: String(p.profileText || '').replace(/电话/g, 'Phone').replace(/邮箱/g, 'Email').replace(/出生/g, 'Born').replace(/性别/g, 'Gender').replace(/当前状态/g, 'Status'),
    modules, dates, items: translated,
    notes: ['（演示）英文通常比中文更长，建议翻译后做一次「一页纸检查」。模板使用系统字体栈，拉丁字母可正常显示。'],
  };
}

function mock_interview(p) {
  const action = p.action || 'start';
  const type = p.interviewType || 'tech';
  const total = p.rounds || 6;
  const msgs = p.messages || [];
  const asked = msgs.filter((m) => m.role === 'assistant').length;
  const bank = {
    tech: ['请把你简历里最核心的一个系统的架构画给我听：有哪些模块、数据怎么走、你本人负责哪一层？', '你写到的某个数字（QPS、耗时或规模）口径是什么？基线和统计周期怎么取？', '如果把其中某个中间件换成另一种方案，你会怎么权衡？', '线上出现接口超时，你的排查顺序是什么？', '这段经历里有没有你做失败或回滚的例子？原因是什么？', 'JD 要求的某项技能，你在项目里具体用到了哪个 API / 哪个步骤？'],
    project: ['这个项目是怎么立项的？如果没有你，最可能卡住的是哪一块？', '团队几个人，你和其他同学的分工边界在哪？', '你做的关键决策（技术选型或方案）被挑战过吗？最后怎么落地？', '结果指标是你本人统计的吗？有没有外部验证？', '如果再做一遍，你会先改哪三件事？', '有哪些工作其实是学长/同事主导、你只是参与的？'],
    hr: ['请用 90 秒介绍自己，并说明为什么投这个岗位。', '实习和课程有冲突时你打算怎么安排每周到岗天数？', '你同时在推进的其他机会到了哪一步？（如实即可）', '期望薪资和可到岗时间？', '遇到和你意见不同的同事，你做过的一次沟通是怎样的？', '未来一年你最想在这个岗位上落地的一件事是什么？'],
  };
  const qs = bank[type] || bank.tech;
  if (action === 'review') {
    const turns = qs.slice(0, Math.max(asked, 3)).map((q, i) => ({
      question: q,
      comment: i % 2 ? '（演示）回答提到了背景，但个人边界和数据口径还可以更清楚。' : '（演示）结构清楚，建议补上对比基线。',
      score: 70 + (i % 3) * 6,
      reference: '（演示参考）先用一句话说你的职责边界，再讲动作与决策，最后给可验证的结果；缺数字就说「我回去核对口径」。',
      weak: i % 2 === 1,
    }));
    return {
      score: 74, level: '良好',
      summary: '（演示）整体表达完整，技术细节有，但个人贡献边界和数据口径还需要再练。配置模型后会根据你的真实回答点评。',
      dimensions: [
        { name: '口径与职责边界', score: 70, comment: '演示规则：建议明确团队规模和本人模块' },
        { name: '方案深度', score: 78, comment: '能讲出技术栈，建议补决策理由' },
        { name: '表达结构', score: 76, comment: '可用结论先行' },
        { name: '与岗位要求对齐', score: 72, comment: '可更主动把经历和岗位关键词对齐' },
      ],
      turns, weak: turns.filter((t) => t.weak).map((t) => t.question),
      next: ['把每个数字的口径写在素材库里', '准备一张项目架构草图', '为「失败/回滚」准备一个真实例子'],
    };
  }
  const turn = asked + 1;
  const done = action === 'reply' && turn > total;
  return { question: qs[(turn - 1) % qs.length], why: '（演示）针对简历常见追问点', tip: '先说结论，再补事实与数字口径。', done, turn: Math.min(turn, total) };
}

function story_probe(p) {
  const s = p.story || {};
  const missing = [];
  if (!s.background) missing.push({ ask: '这件事的背景是什么？面向谁、要解决什么问题？', aim: '背景' });
  if (!s.task) missing.push({ ask: '你本人接到的任务和成功标准是什么？和同事如何分工？', aim: '任务与边界' });
  if (!s.result || !(s.metrics || []).length) missing.push({ ask: '有没有可验证的结果或规模？（用户数、耗时、准确率等，没有就说没有）', aim: '结果与数据' });
  if (!s.stack || !s.stack.length) missing.push({ ask: '你实际用到了哪些技术或工具？到什么深度？', aim: '技术栈' });
  if (!missing.length) missing.push({ ask: '有没有一次你做了取舍或踩坑后调整方案的经历？', aim: '决策与复盘' });
  const updated = {};
  if (p.answer) {
    const a = String(p.answer);
    if (/背景|面向|为了/.test(a)) updated.background = (s.background ? s.background + '\n' : '') + a.slice(0, 500);
    const nums = a.match(/\d+(\.\d+)?\s*(%|个|项|人|万|倍|ms|QPS)?/g);
    if (nums) updated.metrics = [...(s.metrics || []), ...nums].slice(0, 10);
  }
  return { done: missing.length === 0, coach: p.answer ? '（演示）已记录你刚补充的事实，不会把没说的数字写进去。' : '（演示）我们按 STAR 把缺口补齐，一次只问最有用的问题。', questions: missing.slice(0, 2), updated };
}

function story_write(p) {
  const s = p.story || {};
  const cut = (t, n) => { const x = escText(t).replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n).replace(/[，。；、,;]?[^，。；、,;]*$/, '') + '。' : x; };
  const bullets = [];
  if (s.action) bullets.push('<li>' + cut(s.action, 78) + '</li>');
  const res = s.result || ((s.metrics || []).length ? s.metrics.join('，') : '');
  if (res) bullets.push('<li>' + cut(res, 78) + '</li>');
  else bullets.push('<li>' + (s.task ? cut(s.task, 60) : '完成该经历的主要工作') + '【待补充：可验证的结果】</li>');
  const head = s.background ? '<p>' + cut(s.background, 66) + '</p>' : '';
  return { html: head + '<ul>' + bullets.join('') + '</ul>', reason: '（演示）把素材库事实压成可直接放进简历的短句，没有的数据标了待补充', todos: res ? [] : ['可验证的结果'] };
}

// 演示模式：只用扫描摘要里的统计数字拼一份草稿，不编任何数据
function story_from_project(p) {
  const sm = p.project?.summary || {};
  const g = sm.git || {};
  const mine = g.author && g.author.commits != null ? g.author : null;
  const ym = (d) => (d ? String(d).slice(0, 7) : '');
  const loc = (sm.langs || []).reduce((n, l) => n + (l.loc || 0), 0);
  const metrics = [];
  if (loc) metrics.push('源码约 ' + loc + ' 行（非空行，程序统计）');
  if (sm.modules?.length) metrics.push(sm.modules.length + ' 个顶层模块');
  if (sm.routes) metrics.push('约 ' + sm.routes + ' 处接口路由定义（正则粗略统计）');
  if (g.commits) metrics.push('仓库共 ' + g.commits + ' 次提交');
  if (mine) metrics.push('本人提交 ' + mine.commits + ' 次');
  const stack = (sm.stack || []).slice(0, 10);
  const read = (p.project?.filesRead || []).filter((f) => !/^（/.test(f));
  const files = read.length ? read.slice(-4).map((f) => ({ file: f, kind: '文件' })) : (sm.sent || []).filter((f) => !/^（/.test(f.file)).slice(0, 4);
  return {
    type: 'project',
    title: String(sm.name || '本机项目').slice(0, 30),
    org: '',
    role: '【待补充：本人角色】',
    start: ym(mine?.first || g.first),
    end: ym(mine?.last || g.last),
    background: '（演示）根据 README 与目录结构整理：该项目的目标用户与要解决的问题【待补充：面向谁、解决什么问题】。',
    task: '【待补充：本人负责的范围与成功标准】',
    action: '（演示）使用 ' + (stack.join('、') || '项目中的技术') + ' 实现，代码分布在 ' + ((sm.modules || []).slice(0, 5).join('、') || '若干模块') + ' 等模块。',
    result: '（演示）' + (metrics.length ? metrics.join('，') + '。' : '') + '使用规模与效果【待补充：用户规模 / 性能数据 / 是否上线】',
    metrics,
    stack,
    tags: ['本机项目'],
    evidence: [{ file: '统计结果', note: '代码行数、模块数、提交次数由程序统计' }, ...files.map((f) => ({ file: f.file, note: '扫描时读取的' + f.kind })) ],
    to_confirm: [
      { ask: '这个项目给谁用？大概有多少用户或使用次数？没有就说没有', aim: '用户规模' },
      { ask: '有没有性能或效果数据（耗时、准确率、成本等）？', aim: '结果数据' },
      { ask: '是否上线、交付或在团队内使用？', aim: '上线情况' },
      { ask: '团队几个人？你本人具体负责哪些模块？', aim: '个人分工' },
    ],
    reason: '（演示）只用了扫描统计出的数字，其余标了待补充。',
  };
}

// 演示模式：只从用户描述里取事实，数字只用描述里出现的
function story_from_text(p) {
  const text = String(p.text || '').trim();
  const first = (text.split(/[\n。！？!?]/).find((x) => x.trim()) || '我的经历').trim();
  const nums = text.replace(/(20\d\d)[年.\-/]\d{1,2}月?/g, '').match(/\d+(\.\d+)?\s*(%|个|项|人|万|倍|ms|QPS|页|条|次|种)/g) || [];
  const months = text.match(/(20\d\d)[年.\-/](\d{1,2})/g) || [];
  const ym = (m) => { const x = m.match(/(20\d\d)[年.\-/](\d{1,2})/); return x ? x[1] + '-' + x[2].padStart(2, '0') : ''; };
  const stack = findTerms(text).slice(0, 10);
  return {
    type: /实习/.test(text) ? 'internship' : /论文|科研|实验室/.test(text) ? 'research' : /比赛|竞赛|大赛/.test(text) ? 'competition' : 'project',
    title: first.slice(0, 30),
    org: '',
    role: String(p.role || '').trim() || '【待补充：本人角色】',
    start: months[0] ? ym(months[0]) : '',
    end: months[1] ? ym(months[1]) : '',
    background: '（演示）' + text.slice(0, 120) + (text.length > 120 ? '…' : ''),
    task: '【待补充：本人负责的范围与成功标准】',
    action: '（演示）' + (stack.length ? '使用 ' + stack.join('、') + ' 完成描述中的工作。' : '按描述完成相关工作。') + '【待补充：关键做法与难点】',
    result: nums.length ? '（演示）描述中提到：' + nums.join('，') + '。' : '【待补充：可验证的结果或数据】',
    metrics: nums.slice(0, 8),
    stack,
    tags: [],
    evidence: [{ file: '用户描述', note: '标题、背景、技术与数字均来自用户描述' }],
    to_confirm: [
      { ask: '你本人具体负责哪一部分？团队几个人？', aim: '个人分工' },
      { ask: '做这件事时最难的问题是什么？你怎么解决的？', aim: '难点与取舍' },
      { ask: '有没有可验证的结果（使用人数、耗时、准确率等）？没有就说没有', aim: '结果数据' },
    ],
    reason: '（演示）只用了你描述里的事实，其余标了待补充。',
  };
}

function escText(t) { return String(t || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

function strategy(p) {
  const ins = p.insights || {};
  const n = ins.overall?.applied || ins.funnel?.applied || 0;
  const unreliable = n < 8 || ins.unreliable;
  return {
    unreliable,
    headline: unreliable ? '（演示）已投递样本只有 ' + n + ' 家，比例波动会很大，下面只是观察，不是结论。' : '（演示）数据已足够看出大致的渠道和岗位结构，建议把效果更好的简历版本作为主投。',
    findings: [
      '已投递 ' + n + ' 家，进入面试 ' + (ins.funnel?.interview ?? ins.overall?.interview ?? 0) + ' 家。',
      (ins.byChannel && ins.byChannel[0]) ? ('样本中「' + ins.byChannel[0].name + '」渠道数量最多（' + ins.byChannel[0].applied + ' 家）。') : '渠道分布还比较分散。',
      (ins.byResume && ins.byResume[0]) ? ('关联简历最多的版本是「' + ins.byResume[0].name + '」。') : '不少记录还没有关联简历版本。',
    ],
    actions: [
      '给还在「已投递」且超过一周无回音的公司发一封简短跟进（或走内推）。',
      '把进面更多的简历版本定为该岗位类型的主投版本，并为新 JD 继续定制而不是反复改同一份。',
      '在素材库补齐最常被追问的数字口径，再投下一波同类岗位。',
    ],
    watch: ['至少积累 8-10 个已完成流程的样本后再比较渠道差异', '记录每次用的是哪一份简历版本'],
  };
}

const MOCKS = { diagnose, rewrite, jd_analyze: jdAnalyze, jd_match: jdMatch, tailor, interview, chat, extract_jd, compress, translate, mock_interview, story_probe, story_write, story_from_project, story_from_text, strategy };


export function mockResult(payload) {
  if (payload?.resume?.items) ensureItemRefs(payload.resume.items);
  if (payload?.items) ensureItemRefs(payload.items);
  const fn = MOCKS[payload.task];
  if (!fn) throw new Error('未知任务：' + payload.task);
  const out = fn(payload);
  return typeof out === 'string' ? out : JSON.stringify(out, null, 1);
}

export async function mockStream(payload, onDelta, signal) {
  const text = mockResult(payload);
  const n = Math.max(12, Math.min(60, Math.ceil(text.length / 40)));
  const size = Math.ceil(text.length / n);
  for (let i = 0; i < text.length; i += size) {
    if (signal?.aborted) throw new Error('已取消');
    onDelta(text.slice(i, i + size));
    await new Promise((r) => setTimeout(r, 18 + (hash(i) % 20)));
  }
  return text;
}
