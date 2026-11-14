// 投递复盘：按岗位类型 / 渠道 / 简历版本 / 公司类型统计回复率、进面率、平均回复天数
const BIG = '阿里巴巴|阿里|腾讯|字节跳动|字节|百度|美团|京东|网易|华为|小米|拼多多|PDD|蚂蚁|蚂蚁集团|快手|滴滴|携程|哔哩哔哩|B站|新浪|微博|搜狐|360|联想|小红书|SHEIN|shopee|抖音';
const SOE = '银行|证券|保险|国家|国网|中石油|中石化|中海油|中铁|中建|中移动|移动|联通|电信|烟草|研究院|研究所|高校|大学|科学院';
const FOREIGN = 'Google|Microsoft|Amazon|Meta|Apple|Uber|Tesla|NVIDIA|Oracle|SAP|IBM|Intel|Cisco|Adobe|Salesforce|Bloomberg|Goldman|Morgan|JPMorgan?|McKinsey|Deloitte|Accenture|PwC|KPMG|外企';

export function companyType(name) {
  const s = String(name || '');
  if (new RegExp(BIG, 'i').test(s)) return '互联网大厂';
  if (new RegExp(FOREIGN, 'i').test(s)) return '外企';
  if (new RegExp(SOE).test(s)) return '国企 / 研究所';
  return '其他公司';
}

export function roleType(role) {
  const s = String(role || '');
  if (/大模型|LLM|算法|机器学习|NLP|CV|推荐|搜索|人工智能|AI /.test(s) || /AI$/.test(s)) return '算法 / 大模型';
  if (/前端|iOS|Android|客户端|Flutter|React Native/.test(s)) return '前端 / 客户端';
  if (/测试|QA|质量/.test(s)) return '测试';
  if (/数据|分析师|BI/.test(s)) return '数据';
  if (/产品/.test(s)) return '产品';
  if (/运营/.test(s)) return '运营';
  if (/运维|SRE|安全|DevOps/.test(s)) return '运维 / 安全';
  if (/后端|服务端|开发|Java|Go|C\+\+|研发/.test(s)) return '后端 / 研发';
  return s.trim() ? '其他岗位' : '未填岗位';
}

function stageOf(name, statuses) {
  return (statuses.find((s) => s.name === name) || {}).stage || 'active';
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  const da = new Date(String(a).slice(0, 10) + 'T00:00:00');
  const db = new Date(String(b).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(+da) || Number.isNaN(+db)) return null;
  return Math.round((+db - +da) / 864e5);
}

function firstReplyAt(a, statuses) {
  const hist = a.history || [];
  const applied = a.appliedAt || (hist[0]?.at || '').slice(0, 10);
  for (const h of hist) {
    const st = stageOf(h.status, statuses);
    if (h.status !== '已投递' && h.status !== '待投递' && st !== 'todo') {
      const at = (h.at || '').slice(0, 10);
      if (at && applied && at >= applied) return at;
      if (at && !applied) return at;
    }
  }
  if (['interview', 'offer', 'closed'].includes(stageOf(a.status, statuses)) && a.status !== '已投递') {
    return (a.updatedAt || '').slice(0, 10) || null;
  }
  return null;
}

export function analyzeApps(data) {
  const statuses = data.statuses || [];
  const items = data.items || [];
  const applied = items.filter((a) => a.appliedAt || stageOf(a.status, statuses) !== 'todo' || (a.history || []).some((h) => stageOf(h.status, statuses) !== 'todo'));
  const row = (a) => {
    const st = stageOf(a.status, statuses);
    const reached = (pred) => (a.history || [{ status: a.status }]).some((h) => pred(h.status)) || pred(a.status);
    const interviewed = reached((s) => ['interview', 'offer'].includes(stageOf(s, statuses))) || (a.events || []).some((e) => /面/.test(e.type));
    const offered = reached((s) => stageOf(s, statuses) === 'offer');
    const replyAt = firstReplyAt(a, statuses);
    const replied = Boolean(replyAt) || interviewed || offered || st === 'closed' || /拒绝|笔试|测评|面/.test(a.status);
    const replyDays = replyAt && a.appliedAt ? daysBetween(a.appliedAt, replyAt) : (replied && a.appliedAt ? daysBetween(a.appliedAt, (a.updatedAt || '').slice(0, 10)) : null);
    return { a, interviewed, offered, replied, replyDays };
  };
  const rows = applied.map(row);

  const group = (keyFn) => {
    const map = {};
    for (const r of rows) {
      const k = keyFn(r.a);
      (map[k] ||= []).push(r);
    }
    return Object.entries(map).map(([name, list]) => summarize(name, list)).sort((a, b) => b.applied - a.applied);
  };

  function summarize(name, list) {
    const appliedN = list.length;
    const replied = list.filter((r) => r.replied).length;
    const interview = list.filter((r) => r.interviewed).length;
    const offer = list.filter((r) => r.offered).length;
    const days = list.map((r) => r.replyDays).filter((d) => d != null && d >= 0 && d < 180);
    const avgDays = days.length ? Math.round((days.reduce((s, n) => s + n, 0) / days.length) * 10) / 10 : null;
    return {
      name, applied: appliedN, replied, interview, offer,
      replyRate: appliedN ? Math.round(100 * replied / appliedN) : 0,
      interviewRate: appliedN ? Math.round(100 * interview / appliedN) : 0,
      offerRate: appliedN ? Math.round(100 * offer / appliedN) : 0,
      avgReplyDays: avgDays,
      sample: appliedN,
      unreliable: appliedN < 8,
    };
  }

  const overall = summarize('全部', rows);
  const funnel = {
    applied: overall.applied,
    replied: rows.filter((r) => r.replied).length,
    interview: rows.filter((r) => r.interviewed).length,
    offer: rows.filter((r) => r.offered).length,
  };
  return {
    overall,
    funnel,
    byRoleType: group((a) => roleType(a.role)),
    byChannel: group((a) => a.channel || '未填渠道'),
    byResume: group((a) => a.resumeSlug || '未关联简历'),
    byCompanyType: group((a) => companyType(a.company)),
    unreliable: overall.applied < 8,
    note: overall.applied < 8 ? '当前样本量较小（已投递 ' + overall.applied + ' 家），以下比例波动会很大，只适合看方向，不适合下结论。' : '',
  };
}

export function listReminders(data, { days = 7, today } = {}) {
  const t = today || new Date().toISOString().slice(0, 10);
  const statuses = data.statuses || [];
  const upcoming = [];
  const silent = [];
  const horizon = new Date(t + 'T00:00:00');
  horizon.setDate(horizon.getDate() + 14);
  const until = horizon.toISOString().slice(0, 10);
  for (const a of data.items || []) {
    for (const e of a.events || []) {
      if (e.done) continue;
      if (e.date >= t && e.date <= until) upcoming.push({ appId: a.id, company: a.company, role: a.role, type: e.type, date: e.date, time: e.time || '', note: e.note || '', eventId: e.id });
    }
    if (a.deadline && a.deadline >= t && a.deadline <= until) {
      upcoming.push({ appId: a.id, company: a.company, role: a.role, type: '截止日期', date: a.deadline, time: '', note: '', eventId: 'deadline' });
    }
    const st = (statuses.find((s) => s.name === a.status) || {}).stage || 'active';
    const applied = a.appliedAt;
    if (!applied) continue;
    const elapsed = Math.round((new Date(t + 'T00:00:00') - new Date(applied + 'T00:00:00')) / 864e5);
    const progressed = st === 'interview' || st === 'offer' || st === 'closed' || /面|笔试|测评|Offer|拒绝/.test(a.status);
    const later = (a.history || []).some((h) => h.status !== '已投递' && h.status !== '待投递' && (h.at || '').slice(0, 10) > applied);
    if (elapsed >= days && !progressed && !later && st !== 'todo') {
      silent.push({ appId: a.id, company: a.company, role: a.role, appliedAt: applied, days: elapsed, status: a.status, channel: a.channel || '', resumeSlug: a.resumeSlug || '' });
    }
  }
  upcoming.sort((x, y) => (x.date + (x.time || '')).localeCompare(y.date + (y.time || '')));
  silent.sort((x, y) => y.days - x.days);
  return { upcoming, silent, days };
}
