// 短编号：把内部 DOM id（如 project_experience-38349442、reasearch_experience）转成 P1/W1 给模型用。
export const REF_PREFIX = {
  personal_summary: 'A',
  edus: 'E',
  works: 'W',
  internships: 'I',
  project_experience: 'P',
  skill_list: 'S',
  orgs: 'O',
  reasearch_experience: 'R',
  honor: 'H',
  self_evaluation: 'V',
  certificates: 'C',
  languages: 'L',
  hobbies: 'B',
  papers: 'N',
  campus: 'K',
};

export function prefixForModule(moduleId) {
  const id = String(moduleId || '');
  if (REF_PREFIX[id]) return REF_PREFIX[id];
  const base = Object.keys(REF_PREFIX).find((k) => id === k || id.startsWith(k + '-'));
  return base ? REF_PREFIX[base] : 'M';
}

export function shortTitle(title) {
  return String(title || '').split('｜')[0].split('|')[0].trim();
}

export function ensureItemRefs(items = []) {
  const counts = {};
  for (const it of items) {
    const p = prefixForModule(it.module);
    counts[p] = (counts[p] || 0) + 1;
    if (!it.ref) it.ref = p + counts[p];
    if (!it.label) {
      const head = shortTitle(it.title);
      it.label = [it.moduleTitle, head].filter(Boolean).join('·') || it.ref;
    }
    it.modRef = p;
  }
  return items;
}

export function buildRefIndex(items = [], modules = []) {
  const list = ensureItemRefs(items);
  const byRef = Object.create(null);
  const byId = Object.create(null);
  const modByRef = Object.create(null);
  const modById = Object.create(null);
  for (const it of list) {
    byRef[it.ref] = it;
    if (it.id) byId[it.id] = it;
  }
  for (const m of modules) {
    const p = prefixForModule(m.id);
    if (!modByRef[p]) modByRef[p] = m;
    if (m.id) modById[m.id] = m;
  }
  return { items: list, byRef, byId, modByRef, modById };
}

export function resolveToId(token, index) {
  if (!token) return '';
  const bare = String(token).replace(/^\[|\]$/g, '').trim();
  if (!bare) return '';
  if (index.byRef[bare]) return index.byRef[bare].id || bare;
  if (index.byId[bare]) return bare;
  if (index.modByRef[bare]) return index.modByRef[bare].id || bare;
  if (index.modById[bare]) return bare;
  return bare;
}

export function labelFor(token, index) {
  const bare = String(token || '').replace(/^\[|\]$/g, '').trim();
  const it = index.byRef[bare] || index.byId[bare];
  if (it) return it.ref + ' ' + (it.label || shortTitle(it.title) || it.moduleTitle || it.ref);
  const m = index.modByRef[bare] || index.modById[bare];
  if (m) return (m.modRef || prefixForModule(m.id)) + ' ' + (m.title || m.id);
  return bare;
}

const RAW_ID_RE = /\[?((?:personal_summary|edus|works|internships|project_experience|skill_list|orgs|reasearch_experience|honor|self_evaluation|certificates|languages|hobbies|papers|campus|custom)[_-][A-Za-z0-9_-]+)\]?/g;
const SHORT_RE = /\b([AEWIPSOHRVCLBNKM]\d{1,3})\b/g;

export function rewriteRawIds(text, index) {
  return String(text || '').replace(RAW_ID_RE, (_, id) => {
    const it = index.byId[id];
    if (it) return it.ref;
    const m = index.modById[id];
    if (m) return prefixForModule(m.id);
    if (/^reasearch_experience$/.test(id) && index.modByRef.R) return 'R';
    return '';
  }).replace(/reasearch_experience/g, (m, offset, s) => {
    // leftover typo field name if not already rewritten as id
    if (index.modByRef.R || index.byRef.R1) return '研究经历';
    return m;
  });
}

function walkItemIds(obj, fn) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) { obj.forEach((x) => walkItemIds(x, fn)); return; }
  for (const [k, v] of Object.entries(obj)) {
    if ((k === 'itemId' || k === 'id') && typeof v === 'string') obj[k] = fn(v);
    else if (typeof v === 'string' && (k === 'problem' || k === 'suggestion' || k === 'comment' || k === 'text' || k === 'verdict' || k === 'tenSecond' || k === 'target' || k === 'question' || k === 'evidence')) {
      obj[k] = fn(v, 'text');
    } else if (v && typeof v === 'object') walkItemIds(v, fn);
  }
}

export function remapAgentItemIds(data, resume) {
  const items = resume?.items || [];
  const modules = resume?.modules || [];
  const index = buildRefIndex(items, modules);
  walkItemIds(data, (val, kind) => {
    if (kind === 'text') return rewriteRawIds(val, index);
    // 短编号或漏出的原始 id → 内部 id（写回/定位用）；未知则原样
    const bare = String(val).replace(/^\[|\]$/g, '').trim();
    if (index.byRef[bare]) return index.byRef[bare].id;
    if (index.byId[bare]) return bare;
    if (index.modByRef[bare]) return index.modByRef[bare].id;
    if (index.modById[bare]) return bare;
    return val;
  });
  return data;
}

export { RAW_ID_RE, SHORT_RE };


function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function chipifyHtml(text, items = [], modules = []) {
  const index = buildRefIndex(items, modules);
  let s = escHtml(rewriteRawIds(text, index));
  s = s.replace(/\b([AEWIPSOHRVCLBNKM]\d{1,3})\b/g, (m) => {
    const id = resolveToId(m, index);
    const lab = labelFor(m, index);
    if (!id && !index.byRef[m] && !index.modByRef[m]) return m;
    const loc = id || m;
    return '<button type="button" class="rp-ref" data-loc="' + escHtml(loc) + '" title="定位到 ' + escHtml(lab) + '">' + escHtml(lab) + '</button>';
  });
  return s;
}
