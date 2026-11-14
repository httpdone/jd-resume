import fs from 'node:fs';
import path from 'node:path';
import { TEMPLATE_DIR } from './config.mjs';
import { decorateBody, themeHead } from './templates.mjs';
import { rewriteAssetSrcs } from './media.mjs';

const resumeCss = fs.readFileSync(path.join(TEMPLATE_DIR, 'resume.css'), 'utf8');
const printCss = fs.readFileSync(path.join(TEMPLATE_DIR, 'print.css'), 'utf8');

// fontHref 指向 assets/fonts.css：导出时是 file:// 绝对地址，编辑器里是 http 路径
// meta 用于套用视觉模板（同一份 body.html，不改结构）
export function renderHtml({ body, title, fontHref, extraHead = '', extraBody = '', meta = {}, assetBase = '' } = {}) {
  const themed = rewriteAssetSrcs(decorateBody(body, meta), assetBase);
  return '<!doctype html>\n'
    + '<html lang="zh-CN" data-rp-theme="' + (meta.template || 'classic') + '">\n'
    + '<head>\n'
    + '<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<title>' + (title || '简历') + '</title>\n'
    + '<link rel="stylesheet" href="' + fontHref + '">\n'
    + '<style>\n' + resumeCss + '\n' + printCss + '</style>\n'
    + themeHead(meta)
    + extraHead
    + '</head>\n'
    + '<body>\n'
    + themed + '\n'
    + extraBody
    + '</body>\n'
    + '</html>\n';
}
