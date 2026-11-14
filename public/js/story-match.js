// 素材库 ↔ 简历条目匹配（纯函数，浏览器与 Node 测试共用）
// 规则：从该条目导入的素材直接命中；否则看标题 / 组织 / 技术栈在条目文字里的重合度。

function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); }

// 中文按 2 字切片 + 英文单词，用来做粗粒度重合度
export function tokens(s) {
  const t = String(s || '').toLowerCase();
  const out = new Set();
  for (const w of t.match(/[a-z][a-z0-9+#.\-]{1,}/g) || []) out.add(w);
  const zh = t.replace(/[^\u4e00-\u9fa5]/g, '');
  for (let i = 0; i + 1 < zh.length; i++) out.add(zh.slice(i, i + 2));
  return out;
}

export function storyScore(story, item) {
  if (!story || !item) return 0;
  const text = norm([item.title, item.label, item.text].join(' '));
  let score = 0;
  if (story.sourceItemId && (story.sourceItemId === item.id || story.sourceItemId === item.ref)) score += 100;
  const title = norm(story.title);
  if (title && title.length >= 3 && text.includes(title)) score += 40;
  const org = norm(story.org);
  if (org && org.length >= 2 && text.includes(org)) score += 25;
  for (const st of story.stack || []) if (st && text.includes(norm(st))) score += 3;
  const a = tokens([story.title, story.org, story.role].join(' '));
  const b = tokens([item.title, item.text].join(' '));
  let hit = 0;
  for (const x of a) if (b.has(x)) hit++;
  if (a.size) score += Math.round((hit / a.size) * 30);
  return score;
}

// 返回 [{ story, items: [条目短编号/ id], score }]，按相关度排序
export function matchStories(stories, items, { max = 4, min = 24 } = {}) {
  const res = new Map();
  for (const it of items || []) {
    const ranked = (stories || []).map((s) => ({ s, score: storyScore(s, it) })).filter((x) => x.score >= min).sort((x, y) => y.score - x.score).slice(0, 2);
    for (const { s, score } of ranked) {
      const cur = res.get(s.id) || { story: s, items: [], score: 0 };
      cur.items.push(it.ref || it.id);
      cur.score = Math.max(cur.score, score);
      res.set(s.id, cur);
    }
  }
  return [...res.values()].sort((a, b) => b.score - a.score).slice(0, max);
}
