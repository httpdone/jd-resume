// 从岗位链接或粘贴的网页原文中抽取 JD。很多招聘站要登录或有反爬，失败时把原文交给调用方用 LLM 抽。
import dns from 'node:dns/promises';
import net from 'node:net';
import { extractJdByRules } from './jd-extract.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAX_BYTES = 1.5 * 1024 * 1024;
const TIMEOUT = 12000;

const WALL_RE = /请登录|立即登录|扫码登录|登录后(查看|继续)|登录\/注册|注册即可|验证码|人机验证|访问验证|安全验证|滑动验证|cloudflare|attention required|access denied|just a moment|checking your browser|该职位(已下线|不存在)|职位已关闭|打开(Boss|BOSS)?直聘|下载.{0,8}APP.{0,8}查看|当前环境存在风险/i;

export const SITE_HINTS = {
  'zhipin.com': 'Boss 直聘多数岗位详情需要登录，直接抓取经常只能拿到壳页面。',
  'bosszhipin': 'Boss 直聘多数岗位详情需要登录。',
  'nowcoder.com': '牛客部分职位需要登录后才能看到完整 JD。',
  'lagou.com': '拉勾经常有验证码或登录墙。',
  'liepin.com': '猎聘经常需要登录。',
  'zhaopin.com': '智联招聘可能有反爬或登录墙。',
  '51job.com': '前程无忧可能有反爬。',
  'linkedin.com': 'LinkedIn 几乎一定要登录。',
  'indeed.com': 'Indeed 可能有反爬。',
};

function siteHint(url) {
  const host = String(url || '').toLowerCase();
  for (const [k, v] of Object.entries(SITE_HINTS)) if (host.includes(k)) return v;
  return '';
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === '::1' || ip === '0.0.0.0') return true;
  if (net.isIP(ip) === 4) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 0) return true;
  }
  if (net.isIP(ip) === 6) {
    const s = ip.toLowerCase();
    if (s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80') || s === '::1') return true;
    if (s.startsWith('::ffff:')) return isPrivateIp(s.slice(7));
  }
  return false;
}

export async function assertSafeUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw Object.assign(new Error('链接不是合法的 http(s) 地址'), { status: 400, code: 'bad_url' }); }
  if (!['http:', 'https:'].includes(url.protocol)) throw Object.assign(new Error('只支持 http 或 https 链接'), { status: 400, code: 'bad_url' });
  if (url.username || url.password) throw Object.assign(new Error('链接里不能带用户名和密码'), { status: 400, code: 'bad_url' });
  const host = url.hostname;
  if (host === '169.254.169.254' || host.endsWith('.internal') || host.endsWith('.local')) {
    throw Object.assign(new Error('不允许访问该地址'), { status: 400, code: 'ssrf' });
  }
  // 本工具默认只在本机使用：允许 127.0.0.1 / localhost，方便测试；仍拦截局域网和其他回环段
  const localOk = host === '127.0.0.1' || host === 'localhost';
  try {
    const addrs = await dns.lookup(host, { all: true });
    for (const a of addrs) {
      if (a.address === '127.0.0.1' && localOk) continue;
      if (isPrivateIp(a.address)) throw Object.assign(new Error('不允许抓取内网或本机私有地址'), { status: 400, code: 'ssrf' });
    }
  } catch (e) {
    if (e.code === 'ssrf') throw e;
    throw Object.assign(new Error('无法解析该域名：' + (e.message || e)), { status: 400, code: 'dns' });
  }
  return url;
}

export function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  const title = (s.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1];
  const ogTitle = (s.match(/property=["']og:title["'][^>]*content=["']([^"']+)/i) || s.match(/content=["']([^"']+)["'][^>]*property=["']og:title["']/i) || [, ''])[1];
  const ogSite = (s.match(/property=["']og:site_name["'][^>]*content=["']([^"']+)/i) || [, ''])[1];
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote)>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '• ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  s = s.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  return { title: decodeEntities(title || ogTitle || '').trim(), site: decodeEntities(ogSite || '').trim(), text: s };
}

function decodeEntities(s) {
  return String(s || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

export function detectWall(text, status) {
  const t = String(text || '');
  if (status === 401 || status === 403) return '页面返回了 ' + status + '，很可能需要登录或触发了反爬。';
  if (t.length < 80) return '抓到的正文过短，页面可能是登录墙、验证码或已下线。';
  if (WALL_RE.test(t) && t.length < 1200) return '页面内容像是登录墙或验证码，而不是完整的岗位描述。';
  if (WALL_RE.test(t) && (t.match(/登录/g) || []).length >= 4 && !/任职要求|岗位职责|职位描述|Job Description|Responsibilities/i.test(t)) {
    return '页面更像登录/注册页，没有看到「岗位职责」「任职要求」等典型 JD 段落。';
  }
  return '';
}

async function fetchOnce(url, redirectLeft) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: ctrl.signal,
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' },
    });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc || redirectLeft <= 0) throw Object.assign(new Error('重定向次数过多或缺少 Location'), { code: 'redirect' });
      const next = new URL(loc, url).href;
      await assertSafeUrl(next);
      return fetchOnce(next, redirectLeft - 1);
    }
    const ctype = res.headers.get('content-type') || '';
    if (!/html|text|xml|json|javascript/i.test(ctype) && ctype) {
      throw Object.assign(new Error('该链接不是网页（Content-Type: ' + ctype + '）'), { code: 'not_html', status: 400 });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw Object.assign(new Error('页面过大，已放弃抓取'), { code: 'too_large', status: 413 });
    let html = buf.toString('utf8');
    const charset = (html.match(/charset=["']?([\w-]+)/i) || [, ''])[1].toLowerCase();
    if (charset && charset !== 'utf-8' && charset !== 'utf8' && charset !== 'iso-8859-1') {
      // 大多数招聘站已是 UTF-8；若声明了其他编码仍按 UTF-8 试读，调用方可改为粘贴
    }
    return { status: res.status, url, html, ctype };
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error('抓取超时（' + TIMEOUT / 1000 + ' 秒）'), { code: 'timeout' });
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPage(url) {
  const safe = await assertSafeUrl(url);
  return fetchOnce(safe.href, 5);
}

// 统一入口：url 或 html/text。只做抓取和规则抽取，不调用 LLM（由 server 再调）。
export async function collectJdSource({ url, html, text } = {}) {
  const warnings = [];
  let source = 'paste';
  let finalUrl = String(url || '').trim();
  let rawHtml = String(html || '');
  let rawText = String(text || '').trim();
  let title = '';
  let site = '';
  let httpStatus = 0;

  if (finalUrl && !rawHtml && !rawText) {
    source = 'url';
    const hint = siteHint(finalUrl);
    if (hint) warnings.push(hint);
    const page = await fetchPage(finalUrl);
    httpStatus = page.status;
    rawHtml = page.html;
    finalUrl = page.url;
    if (page.status >= 400) warnings.push('服务器返回 HTTP ' + page.status + '。');
  }

  if (rawHtml) {
    const parsed = htmlToText(rawHtml);
    title = parsed.title;
    site = parsed.site;
    if (!rawText) rawText = parsed.text;
  }

  const wall = detectWall(rawText, httpStatus);
  if (wall) warnings.push(wall);

  const extracted = extractJdByRules({ text: rawText, title, url: finalUrl, site });
  const okEnough = (extracted.text || '').length >= 60;
  return {
    ok: okEnough && !wall,
    source,
    url: finalUrl,
    title,
    site,
    httpStatus,
    wall: Boolean(wall),
    warnings,
    extracted,
    text: rawText.slice(0, 20000),
    hint: wall
      ? '很多招聘站（尤其是 Boss 直聘、猎聘、部分企业官网）需要登录或有反爬，自动抓取经常失败。请把岗位页全文复制到「粘贴网页原文」，或另存为 HTML 再贴进来，Agent 会帮你抽取公司、岗位和 JD。'
      : '',
  };
}
