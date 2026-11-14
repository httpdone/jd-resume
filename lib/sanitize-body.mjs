// 清理误写入 body.html 的编辑器 UI（头像/校徽工具栏、占位符、教育条目校徽等）
const CHROME_PHRASE = /更换编辑删除/g;

function removeByClass(html, className) {
  const re = new RegExp('<(div|span|button|i|a|p)\\b[^>]*class="[^"]*\\b' + className + '\\b[^"]*"[^>]*(?:/>|>[\\s\\S]*?</\\1>)', 'gi');
  return html.replace(re, '');
}

export function looksPolluted(html) {
  const s = String(html || '');
  return /rp-media-bar|rp-add-crest|edu-crest|data-rp-chrome|更换编辑删除/.test(s);
}

export function stripEditorChrome(html) {
  let s = String(html || '');
  if (!s) return s;
  s = removeByClass(s, 'rp-media-bar');
  s = removeByClass(s, 'rp-add-crest');
  s = removeByClass(s, 'rp-add-media');
  s = removeByClass(s, 'rp-struct-bar');
  s = s.replace(/<img\b[^>]*class="[^"]*\bedu-crest\b[^"]*"[^>]*>/gi, '');
  s = s.replace(/<(div|span|button|i|a)\b[^>]*data-rp-chrome[^>]*(?:\/>|>[\s\S]*?<\/\1>)/gi, '');
  s = s.replace(/\s*\bedu-crest-host\b/g, '');
  s = s.replace(/\s*data-rp-kind="[^"]*"/g, '');
  s = s.replace(CHROME_PHRASE, '');
  return s;
}
