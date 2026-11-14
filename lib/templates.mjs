// 简历视觉模板：同一份 body.html，靠主题 CSS（及少量渲染层装饰）切换外观
import fs from 'node:fs';
import path from 'node:path';
import { TEMPLATE_DIR } from './config.mjs';
import { MEDIA_CSS } from './media.mjs';

const themesCss = fs.readFileSync(path.join(TEMPLATE_DIR, 'themes.css'), 'utf8');

export const TEMPLATES = [
  {
    id: 'classic', name: '蓝色经典', tag: '默认',
    desc: '沿用现有版式：顶部色条、模块下划线，适合大多数中文简历。',
    accent: '#4183ff', fontSize: 12, lineHeight: 1.7, margin: 12,
    font: 'system',
    thumb: { bar: '#4183ff', bg: '#fff', title: '#4183ff', text: '#222', side: null },
  },
  {
    id: 'minimal', name: '简约黑白', tag: '校招通用',
    desc: '细黑线、大量留白、无彩色装饰，打印清晰，适合校招和 ATS 转 PDF。',
    accent: '#111111', fontSize: 12, lineHeight: 1.75, margin: 14,
    font: 'sans',
    thumb: { bar: '#111', bg: '#fff', title: '#111', text: '#333', side: null },
  },
  {
    id: 'navy', name: '商务深蓝', tag: '左侧栏',
    desc: '每页左侧深蓝色带，页首资料区以深色底衬托，偏商务与金融向。',
    accent: '#0c1f3d', fontSize: 12, lineHeight: 1.7, margin: 12,
    font: 'sans',

    thumb: { bar: '#0c1f3d', bg: '#fff', title: '#0c1f3d', text: '#222', side: '#0c1f3d' },
  },
  {
    id: 'tech', name: '互联网科技', tag: '科技风',
    desc: '青蓝渐变顶栏，模块标题左侧色标，数字与专有名词更醒目。',
    accent: '#0891b2', fontSize: 12, lineHeight: 1.68, margin: 12,
    font: 'sans',
    thumb: { bar: 'linear-gradient(90deg,#06b6d4,#2563eb)', bg: '#fff', title: '#0e7490', text: '#1e293b', side: null },
  },
  {
    id: 'academic', name: '学术研究', tag: '衬线',
    desc: '姓名居中、衬线标题、传统横线分隔，适合科研、高校与实验室岗位。',
    accent: '#1f2933', fontSize: 12, lineHeight: 1.8, margin: 16,
    font: 'serif',
    thumb: { bar: 'transparent', bg: '#faf9f6', title: '#1f2933', text: '#333', side: null },
  },
  {
    id: 'international', name: '国际商务', tag: '外企 / 英文',
    desc: '大号姓名、细线章节标题、偏西文排版节奏，适合英文简历与外企投递。',
    accent: '#1e3a5f', fontSize: 12, lineHeight: 1.72, margin: 15,
    font: 'latin',
    thumb: { bar: 'transparent', bg: '#fff', title: '#1e3a5f', text: '#222', side: null },
  },
  {
    id: 'colorband', name: '彩条标题', tag: '彩色',
    desc: '每个模块标题使用色条底，层次鲜明，适合作品集式或设计向简历。',
    accent: '#c2410c', fontSize: 12, lineHeight: 1.7, margin: 12,
    font: 'sans',
    thumb: { bar: '#c2410c', bg: '#fff', title: '#fff', text: '#222', side: null, band: '#c2410c' },
  },
];

const FONTS = {
  // 只引用系统已安装的字体，不随项目分发任何字体文件
  system: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "Hiragino Sans GB", sans-serif',
  sans: '"Noto Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Segoe UI", "Helvetica Neue", "Microsoft YaHei", sans-serif',
  serif: '"Noto Serif SC", "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "SimSun", "Times New Roman", Georgia, serif',
  latin: '"Segoe UI", "Helvetica Neue", Calibri, "Noto Sans", "Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif',
};

export function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
}

export function listTemplates() {
  return TEMPLATES.map(({ id, name, tag, desc, accent, fontSize, lineHeight, margin, font, thumb }) => ({
    id, name, tag, desc, accent, fontSize, lineHeight, margin, font, thumb,
  }));
}

export function normalizeStyle(meta = {}) {
  const tpl = getTemplate(meta.template);
  const t = meta.theme && typeof meta.theme === 'object' ? meta.theme : {};
  const accent = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(t.accent || '')) ? String(t.accent) : tpl.accent;
  const fontSize = clamp(t.fontSize, 11, 15, tpl.fontSize);
  const lineHeight = clamp(t.lineHeight, 1.4, 2.2, tpl.lineHeight);
  const margin = clamp(t.margin, 8, 18, tpl.margin);
  return { template: tpl.id, theme: { accent, fontSize, lineHeight, margin } };
}

function clamp(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function decorateBody(body, style) {
  const { template } = normalizeStyle(style);
  let html = String(body || '');
  html = html.replace(
    /(<div[^>]*\bid="cv-container"[^>]*)(>)/i,
    (m, a, b) => (/\bdata-rp-theme=/.test(a) ? m : a + ' data-rp-theme="' + template + '"' + b),
  );
  const tpl = getTemplate(template);
  if (tpl.sidebar && !html.includes('data-rp-chrome')) {
    const side = buildSidebar(html);
    html = html.replace(/(<div[^>]*\bclass="[^"]*\bmain\b[^"]*"[^>]*>)/g, (m) => m + side);
  }
  return html;
}

function buildSidebar(html) {
  const name = (html.match(/class="user-name"[^>]*>\s*([^<]+)/) || [, ''])[1].trim().slice(0, 40);
  const labels = [];
  const re = /class="attr-name"[^>]*>\s*([^<]{1,20})<\/label>\s*([^<]{1,80})/g;
  let m;
  while ((m = re.exec(html)) && labels.length < 8) {
    const k = m[1].replace(/[:：\s]+/g, '');
    const v = m[2].replace(/\s+/g, ' ').trim();
    if (v) labels.push({ k, v });
  }
  const rows = labels.map((x) => '<div class="rp-side-row"><span>' + esc(x.k) + '</span>' + esc(x.v) + '</div>').join('');
  return '<aside data-rp-chrome="side" class="rp-side"><div class="rp-side-name">' + esc(name || '') + '</div>' + rows + '</aside>';
}

function esc(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function typographyCss(style) {
  const { template, theme } = normalizeStyle(style);
  const tpl = getTemplate(template);
  const linePx = Math.round(theme.fontSize * theme.lineHeight * 10) / 10;
  const title = Math.round(theme.fontSize + 2);
  const name = Math.max(20, theme.fontSize + 10);
  const font = FONTS[tpl.font === 'yahei' ? 'system' : tpl.font] || FONTS.sans;
  return `#cv-container{
  --rp-accent:${theme.accent};
  --rp-font-size:${theme.fontSize}px;
  --rp-title-size:${title}px;
  --rp-name-size:${name}px;
  --rp-line:${linePx}px;
  --rp-pad-y:${theme.margin}mm;
  --rp-pad-x:${Math.max(10, theme.margin)}mm;
  --rp-font:${font};
}
#cv-container, #cv-container .main, #cv-container .option{ font-family: var(--rp-font); font-size: var(--rp-font-size) !important; }
#cv-container .user .user-name{ font-size: var(--rp-name-size) !important; line-height: 1.25 !important; }
#cv-container .option .rs-heading .rs-heading-inner .title,
#cv-container .option .title{ font-size: var(--rp-title-size) !important; }
#cv-container .main{
  padding-top: var(--rp-pad-y) !important;
  padding-right: var(--rp-pad-x) !important;
  padding-bottom: var(--rp-pad-y) !important;
  padding-left: var(--rp-pad-x) !important;
}
#cv-container .main .cover{ padding-bottom: var(--rp-pad-y) !important; }
#cv-container .main::after{ height: var(--rp-pad-y) !important; }
#cv-container .header-line{ background-color: var(--rp-accent) !important; }
`;
}

export function themeHead(meta) {
  const style = normalizeStyle(meta || {});
  return '<style id="rp-themes">\n' + typographyCss(style) + '\n' + themesCss + '\n' + MEDIA_CSS + '\n</style>\n'
    + '<script>' + paginateBootScript() + '</script>\n';
}

export function paginateBootScript() {
  return `(function(){
    if (window.__rpPaginateBoot) return; window.__rpPaginateBoot = true;
    function linesOf(root, base){
      var rects=[], doc=root.ownerDocument, walker=doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {acceptNode:function(n){return n.textContent.trim()?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;}});
      var range=doc.createRange(), n;
      while((n=walker.nextNode())){ range.selectNodeContents(n); var rs=range.getClientRects(); for(var i=0;i<rs.length;i++){ var r=rs[i]; if(r.height>0&&r.width>0) rects.push({top:r.top-base,bottom:r.bottom-base}); } }
      rects.sort(function(a,b){return a.top-b.top||a.bottom-b.bottom;});
      var out=[]; for(var i=0;i<rects.length;i++){ var r=rects[i], last=out[out.length-1]; if(last && Math.abs(r.top-last.top)<2) last.bottom=Math.max(last.bottom,r.bottom); else out.push({top:r.top,bottom:r.bottom}); }
      return out;
    }
    function paginate(){
      var box=document.getElementById('cv-container'); if(!box) return;
      var pages=[].slice.call(box.children).filter(function(e){return e.classList.contains('main');});
      if(!pages.length) return;
      var first=pages[0], scroll0=first.querySelector('.content-scroll'), content0=first.querySelector('.content');
      if(!scroll0||!content0) return;
      scroll0.style.marginTop='0px';
      first.querySelectorAll('.cover').forEach(function(c){c.style.height='0px';});
      pages.slice(1).forEach(function(p){p.remove();});
      var base=scroll0.getBoundingClientRect().top;
      var lines=linesOf(scroll0, base);
      var total=Math.max(scroll0.scrollHeight, lines.length?lines[lines.length-1].bottom:0);
      var titles=[].slice.call(scroll0.querySelectorAll('.module-title-wrapper, .menu-title')).map(function(t){var r=t.getBoundingClientRect();return {top:r.top-base,bottom:r.bottom-base};});
      function vis(page){
        var main=page.getBoundingClientRect(), content=page.querySelector('.content').getBoundingClientRect();
        var cover=page.querySelector('.cover:not(.rs-cover-clear)');
        var pad=cover?(parseFloat(getComputedStyle(cover).paddingBottom)||0):0;
        return Math.min(content.bottom, main.bottom-pad)-content.top;
      }
      var starts=[0], all=[first], k=0;
      while(k<12){
        var page=all[k], V=vis(page), s=starts[k], limit=s+V;
        var cover=page.querySelector('.cover:not(.rs-cover-clear)');
        if(total<=limit+1){ if(cover) cover.style.height='0px'; break; }
        var cut=lines.find(function(l){return l.bottom>limit+0.5;});
        var b=cut?cut.top:limit; if(b<=s+40) b=limit;
        function inTitle(l){return titles.some(function(t){return l.top>=t.top-1 && l.bottom<=t.bottom+1;});}
        for(var g=0;g<4;g++){
          var ts=titles.filter(function(x){return x.top<b-0.5 && x.top>s+120;}).sort(function(x,y){return y.top-x.top;})[0];
          if(!ts) break;
          var hasBody=lines.some(function(l){return l.top>=ts.bottom-1 && l.bottom<=b+0.5 && !inTitle(l);});
          if(hasBody) break;
          b=ts.top-2;
        }
        if(cover){
          var cs=getComputedStyle(cover);
          var extra=cs.boxSizing==='border-box'?((parseFloat(cs.paddingBottom)||0)+(parseFloat(cs.paddingTop)||0)):0;
          cover.style.height=(Math.max(0,limit-b)+extra)+'px';
        }
        starts.push(b);
        var clone=first.cloneNode(true);
        clone.setAttribute('data-resume-page', String(k+2));
        var ctn=clone.querySelector('.content'); if(ctn){ ctn.setAttribute('data-page', String(k+1)); }
        clone.querySelectorAll('.cover').forEach(function(c){c.style.height='0px';});
        clone.querySelectorAll('[contenteditable]').forEach(function(e){e.removeAttribute('contenteditable');});
        var sc=clone.querySelector('.content-scroll'); sc.style.marginTop=(-b)+'px';
        all[all.length-1].after(clone); all.push(clone); k++;
      }
    }
    function run(){ try{ paginate(); }catch(e){ console.warn('paginate', e); } document.documentElement.setAttribute('data-rp-paged','1'); }
    if(document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ setTimeout(run, 40); });
    else if(document.readyState==='complete') setTimeout(run, 40);
    else window.addEventListener('load', function(){ setTimeout(run, 40); });
  })();`;
}

export function stripChrome(root) {
  if (!root || !root.querySelectorAll) return root;
  root.querySelectorAll('[data-rp-chrome]').forEach((e) => e.remove());
  if (root.removeAttribute) root.removeAttribute('data-rp-theme');
  return root;
}
