// 各 JSON 任务的输出结构，供 OpenAI 兼容的 json_schema / strict 模式使用。
// 字段名与前端现有消费保持一致；根对象、所有属性必填、additionalProperties: false。

function obj(properties, required) {
  const keys = required || Object.keys(properties);
  return { type: 'object', properties, required: keys, additionalProperties: false };
}

function str(description) {
  return description ? { type: 'string', description } : { type: 'string' };
}

function int(description) {
  return description ? { type: 'integer', description } : { type: 'integer' };
}

function bool(description) {
  return description ? { type: 'boolean', description } : { type: 'boolean' };
}

function arr(items, description) {
  return description ? { type: 'array', items, description } : { type: 'array', items };
}

function strs(description) {
  return arr({ type: 'string' }, description);
}

function enums(values, description) {
  return description ? { type: 'string', enum: values, description } : { type: 'string', enum: values };
}

const LEVEL = ['优秀', '良好', '一般', '待加强'];
const WEIGHT = ['high', 'medium', 'low'];
const RISK = ['high', 'medium', 'low'];

const dim = obj({ name: str(), score: int('0-100'), comment: str() });

const rewriteItem = obj({
  id: str('短编号，必须与输入一致'),
  html: str('改写后的正文 HTML'),
  reason: str(),
  todos: strs(),
  risk: str('仍可能被追问或夸大的风险，没有则空串'),
  usedStories: strs('实际用到的素材短编号，没用到给空数组'),
});

export const SCHEMAS = {
  diagnose: obj({
    score: int('0-100 整体材料质量'),
    level: enums(LEVEL),
    verdict: str('一句话总结，不超过 60 字'),
    tenSecond: str('HR 10 秒扫读印象'),
    dimensions: arr(dim),
    highlights: strs(),
    issues: arr(obj({
      level: enums(WEIGHT),
      itemId: str('短编号如 P1/W1，或模块短编号，没有则空串'),
      module: str(),
      problem: str(),
      suggestion: str(),
      evidenceNeeded: str('需要用户补充的真实信息，没有则空串'),
    })),
    riskyClaims: arr(obj({
      itemId: str(),
      text: str('可能被质疑或夸大的原文表述'),
      risk: str(),
      saferWording: str(),
    })),
    questions: strs('为避免编造需要用户补充的问题，最多 6 个'),
  }),

  rewrite: obj({
    items: arr(rewriteItem),
    summary: str('本次改写的总体说明'),
  }),

  jd_analyze: obj({
    company: str(),
    role: str(),
    roleType: str('岗位类型'),
    level: str('实习 / 校招 / 社招 / 未说明'),
    location: str('未提及则空串'),
    summary: str('岗位主线，2 句'),
    hardRequirements: arr(obj({
      text: str(),
      weight: enums(WEIGHT),
      quote: str('JD 原文依据'),
    })),
    responsibilities: strs(),
    skills: arr(obj({ name: str(), weight: enums(WEIGHT) })),
    bonus: strs(),
    hiddenTests: strs(),
    keywords: arr(obj({
      word: str(),
      weight: enums(WEIGHT),
      synonyms: strs(),
    })),
    riskFlags: strs(),
  }),

  jd_match: obj({
    score: int('0-100'),
    verdict: enums(['strong', 'weak', 'risky', 'not_recommended']),
    verdictText: str(),
    dimensions: arr(obj({
      name: str(),
      score: int(),
      max: int(),
      comment: str(),
    })),
    matrix: arr(obj({
      requirement: str(),
      weight: enums(WEIGHT),
      evidence: str('简历中的对应原文，没有则空串'),
      itemId: str('短编号或空串'),
      type: enums(['direct', 'adjacent', 'weak', 'none']),
      status: enums(['材料充分', '表述偏弱', '尚未体现', '待向你确认', '不宜牵强写入']),
      action: str(),
    })),
    strengths: strs(),
    gaps: strs(),
    doNotForce: strs(),
    keywordsCovered: strs(),
    keywordsMissing: strs(),
    eliminationRisk: str('没有则空串'),
    strategy: str(),
    questions: strs(),
  }),

  // itemOrder 在提示词里是 { 模块 id: [短编号] }，但 strict 模式不允许动态键。
  // 这里改成数组，前端同时接受两种形状，不会破坏旧输出。
  tailor: obj({
    items: arr(obj({
      id: str('短编号'),
      html: str(),
      reason: str(),
      jdRequirement: str('对应的 JD 要求'),
      todos: strs(),
    })),
    moduleOrder: strs('建议的模块 id 顺序，必须包含全部模块'),
    itemOrder: arr(obj({
      moduleId: str('模块 id'),
      order: strs('该模块内短编号的建议顺序'),
    }), '只在需要把更相关的经历前置时给出；无需调整则空数组'),
    gaps: strs(),
    bossGreeting: str(),
    summary: str(),
  }),

  interview: obj({
    questions: arr(obj({
      round: enums(['口径与边界', '方案与权衡', '岗位对齐', '临场情境']),
      question: str(),
      target: str('针对的简历原文片段'),
      itemId: str('短编号或空串'),
      why: str(),
      mustCover: strs(),
      risk: enums(RISK),
    })),
    selfIntro: str(),
    prepare: strs(),
  }),

  extract_jd: obj({
    ok: bool(),
    company: str(),
    role: str(),
    location: str(),
    text: str('清洗后的 JD 原文'),
    reason: str('若失败，说明原因；成功则空串'),
  }),

  compress: obj({
    pagesNow: int(),
    overLines: int(),
    plan: str(),
    items: arr(obj({
      id: str(),
      html: str(),
      reason: str(),
      savedLines: int('预计省下的行数'),
    })),
    todos: strs(),
  }),

  translate: obj({
    name: str('英文姓名，名在前'),
    profileLabels: arr(obj({ from: str(), to: str() })),
    profileLines: str('翻译后的基本信息纯文本'),
    modules: arr(obj({ id: str(), title: str() })),
    dates: arr(obj({ from: str(), to: str() })),
    items: arr(obj({
      id: str(),
      title: str('翻译后的标题行，不要日期'),
      org: str(),
      role: str(),
      html: str(),
      reason: str(),
    })),
    notes: strs(),
  }),

  mock_interview: obj({
    question: str(),
    why: str(),
    tip: str('给候选人的作答提示，没有则空串'),
    done: bool(),
    turn: int('当前轮次，从 1 开始'),
  }),

  mock_interview_review: obj({
    score: int('0-100'),
    level: enums(LEVEL),
    summary: str(),
    dimensions: arr(dim),
    turns: arr(obj({
      question: str(),
      comment: str(),
      score: int('0-100'),
      reference: str(),
      weak: bool(),
    })),
    weak: strs('需要重练的问题原句'),
    next: strs(),
  }),

  story_probe: obj({
    done: bool(),
    coach: str('简短反馈，没有则空串'),
    questions: arr(obj({ ask: str(), aim: str() })),
    updated: obj({
      background: str('无更新则空串'),
      task: str('无更新则空串'),
      action: str('无更新则空串'),
      result: str('无更新则空串'),
      metrics: strs('只放用户明确给出的数据，无更新则空数组'),
      stack: strs(),
      tags: strs(),
    }),
  }),

  story_write: obj({
    html: str('正文 HTML'),
    reason: str(),
    todos: strs(),
  }),

  story_from_project: obj({
    type: enums(['internship', 'project', 'research', 'competition', 'org', 'award', 'other']),
    title: str(),
    org: str('材料或用户说明里明确给出才填，否则空串'),
    role: str('没有依据则空串或【待补充：本人角色】'),
    start: str('YYYY-MM，没有 git 数据则空串'),
    end: str('YYYY-MM，没有 git 数据则空串'),
    background: str(),
    task: str(),
    action: str(),
    result: str('只写可核验产出，缺的用【待补充：…】'),
    metrics: strs('只放程序统计出的数字，带口径'),
    stack: strs(),
    tags: strs(),
    evidence: arr(obj({ file: str('相对路径或 统计结果 / git log'), note: str() })),
    to_confirm: arr(obj({ ask: str(), aim: str() })),
    reason: str(),
  }),

  strategy: obj({
    unreliable: bool(),
    headline: str(),
    findings: strs(),
    actions: strs(),
    watch: strs(),
  }),
};

function safeName(name) {
  return String(name || 'result').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'result';
}

// 按任务取出 {name, strict, schema}；chat 等非 JSON 任务返回 null
export function schemaFor(task, payload) {
  let key = task;
  if (task === 'mock_interview' && payload?.action === 'review') key = 'mock_interview_review';
  const schema = SCHEMAS[key];
  if (!schema) return null;
  return { name: safeName(key), strict: true, schema };
}

export const JSON_TASKS = Object.keys(SCHEMAS);
