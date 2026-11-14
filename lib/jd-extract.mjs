// 用规则从岗位页正文里尽量抽出 公司 / 岗位 / JD 文本（不依赖模型）
const ROLE_RE = /(?:招聘|诚聘|招募)?([^\n]{2,40}?(?:实习生?|校招|社招|工程师|开发|算法|产品|运营|设计|测试|研发|分析师|顾问|经理|专员|助理|负责人|科学家|架构师|方向))/;
const COMPANY_RE = /([^\n]{2,30}?(?:科技|网络|信息|集团|公司|银行|证券|实验室|研究院|大学|有限责任公司|股份有限公司|Inc\.|Ltd\.?|LLC| GmbH))/;

export function extractJdByRules({ text = '', title = '', url = '', site = '' } = {}) {
  const raw = String(text || '').replace(/\u00a0/g, ' ').trim();
  const titleText = String(title || '').replace(/\s+/g, ' ').trim();

  let company = '';
  let role = '';

  // 标题常见形式：岗位-公司、公司招聘岗位、岗位_公司_Boss直聘
  const titleParts = titleText.split(/\s*[-_|·—–]+\s*/).map((s) => s.trim()).filter(Boolean);
  const drop = /招聘|职位|详情|Boss直聘|BOSS直聘|牛客|拉勾|猎聘|智联|前程无忧|实习僧|领英|LinkedIn|官网|首页|热招/;
  const useful = titleParts.filter((p) => !drop.test(p) || /实习|工程师|开发|算法/.test(p));
  if (useful.length >= 2) {
    // 较短且像公司名的放 company
    const maybeCo = useful.find((p) => /公司|科技|集团|银行|实验室|研究院|Inc|Ltd|大学/.test(p)) || useful[useful.length - 1];
    const maybeRole = useful.find((p) => p !== maybeCo && ( /实习|工程师|开发|算法|产品|运营|设计|测试|研发|分析/.test(p) || p.length < maybeCo.length + 6 ));
    if (maybeCo && maybeCo.length < 40) company = maybeCo.replace(/招聘.*/, '').trim();
    if (maybeRole) role = maybeRole.replace(/招聘/, '').trim();
  } else if (useful[0] && /实习|工程师|开发|算法|产品/.test(useful[0])) {
    role = useful[0];
  }

  const host = String(url || '');
  if (!company && /bytedance|bytes?dance|toutiao/i.test(host)) company = '字节跳动';
  if (!company && /alibaba|aliyun|taobao/i.test(host)) company = '阿里巴巴';
  if (!company && /tencent/i.test(host)) company = '腾讯';
  if (!company && /meituan/i.test(host)) company = '美团';
  if (!company && /netease|163\.com/i.test(host)) company = '网易';
  if (!company && site && !drop.test(site) && site.length < 30) company = site;

  if (!role) {
    const m = raw.match(/(?:岗位名称|职位名称|招聘岗位|职位)\s*[:：]\s*([^\n]{2,40})/);
    if (m) role = m[1].trim();
  }
  if (!company) {
    const m = raw.match(/(?:公司名称|公司|用人单位)\s*[:：]\s*([^\n]{2,40})/);
    if (m) company = m[1].trim();
  }
  if (!role) {
    const m = raw.match(ROLE_RE);
    if (m) role = m[1].trim();
  }
  if (!company) {
    const m = raw.match(COMPANY_RE);
    if (m) company = m[1].trim();
  }

  const startRe = /(?:岗位职责|职位描述|工作职责|工作内容|职位职责|岗位描述|What you(?:'|’)ll do|Responsibilities|Job Description|About the (?:job|role))\s*[:：]?/i;
  const idx = raw.search(startRe);
  let body = idx >= 0 ? raw.slice(idx) : raw;
  // 去掉页脚常见噪音
  body = body.replace(/(?:相关职位|相似职位|看了又看|热门职位|登录后|下载APP|隐私政策|用户协议)[\s\S]*$/i, '').trim();
  if (body.length < 40) body = raw;
  body = body.slice(0, 12000);

  return { company: company.slice(0, 80), role: role.slice(0, 80), text: body, location: (raw.match(/(?:工作地点|地点|城市)\s*[:：]\s*([^\n]{2,20})/) || [, ''])[1].trim() };
}
