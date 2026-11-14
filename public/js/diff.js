// 文本对比：中文按字、英文按词做 LCS
import { esc, markTodos } from './ui.js';

function tokenize(s) {
  return String(s).match(/[A-Za-z0-9_.+#%-]+|\s+|[\s\S]/g) || [];
}

export function diffTokens(a, b) {
  const A = tokenize(a), B = tokenize(b);
  const n = A.length, m = B.length;
  if (n * m > 6e6) return [{ op: 'del', text: a }, { op: 'ins', text: b }];
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = A[i] === B[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const ops = [];
  const push = (op, text) => { const last = ops[ops.length - 1]; if (last && last.op === op) last.text += text; else ops.push({ op, text }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { push('eq', A[i]); i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { push('del', A[i]); i++; }
    else { push('ins', B[j]); j++; }
  }
  while (i < n) push('del', A[i++]);
  while (j < m) push('ins', B[j++]);
  return ops;
}

// 返回 html：行内 <del>/<ins>，换行切成块
export function diffHtml(a, b) {
  const ops = diffTokens(a, b);
  let html = ops.map((o) => {
    const t = markTodos(esc(o.text));
    return o.op === 'eq' ? t : o.op === 'del' ? '<del>' + t + '</del>' : '<ins>' + t + '</ins>';
  }).join('');
  return html.split('\n').map((l) => {
    const bullet = /^(<[^>]+>)*•\s?/.test(l);
    return '<span class="ln' + (bullet ? ' b' : '') + '">' + l.replace(/^((?:<[^>]+>)*)•\s?/, '$1') + '</span>';
  }).join('');
}

export function changeRatio(a, b) {
  const ops = diffTokens(a, b);
  let changed = 0, total = 0;
  for (const o of ops) { total += o.text.length; if (o.op !== 'eq') changed += o.text.length; }
  return total ? changed / total : 0;
}
