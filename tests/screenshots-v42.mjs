// v4.2 复现/验证：编辑态选中框与操作栏位置（用真实鼠标事件）
// 示例数据：先 node tests/demo-server.mjs <端口> 启动（examples/ 复制到临时 RESUME_HOME）
// 用法：node tests/screenshots-v42.mjs <输出目录> <端口> <前缀> [slug]
import { launch } from './browser.mjs';

const OUT = process.argv[2] || '/workspace/shots/v4.2';
const PORT = process.argv[3] || '4399';
const PREFIX = process.argv[4] || 'after';
const SLUG = process.argv[5] || '张明';
const B = 'http://127.0.0.1:' + PORT;

// 在父页面坐标里取 iframe 内元素的矩形
const RECT_JS = `(sel, idx) => {
  const f = document.querySelector('#frame'); const ir = f.getBoundingClientRect(); const z = ir.width / f.offsetWidth;
  const el = typeof sel === 'string' ? f.contentDocument.querySelectorAll(sel)[idx || 0] : sel;
  const r = el.getBoundingClientRect();
  return { x: ir.left + r.left * z, y: ir.top + r.top * z, w: r.width * z, h: r.height * z, id: el.id };
}`;

export async function probe(page) {
  return page.eval(`(() => {
    const f = document.querySelector('#frame'); const d = f.contentDocument; const ir = f.getBoundingClientRect(); const z = ir.width / f.offsetWidth;
    const bars = [...document.querySelectorAll('.rp-struct-bar')].map((b) => {
      const r = b.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const under = d.elementFromPoint((cx - ir.left) / z, (cy - ir.top) / z)?.closest('.section-item-container, .option');
      return { x: r.left, y: r.top, w: r.width, h: r.height, for: b.dataset.for || '', where: b.dataset.where || '', under: under?.id || '' };
    });
    return {
      sel: document.querySelectorAll('.rp-ov-hit, .rp-ov-sel').length,
      hl: d.querySelectorAll('.rp-hl').length,
      bars,
    };
  })()`);
}

async function main() {
  const page = await launch({ width: 1500, height: 1000 });
  const rect = (sel, idx) => page.eval('(' + RECT_JS + ')(' + JSON.stringify(sel) + ',' + (idx || 0) + ')');
  const out = {};
  const zone = async (a, b) => { const f = await page.eval(`(() => { const r = document.querySelector('#frame').getBoundingClientRect(); return { l: r.left, r: r.right }; })()`); return { x: Math.max(0, f.l - 20), y: Math.max(0, a.y - 60), width: f.r - f.l + 80, height: b.y - a.y + b.h + 140 }; };
  try {
    await page.goto(B + '/#/editor/' + encodeURIComponent(SLUG));
    await page.waitFor('!!window.__rpRd && window.__rpRd.primary && window.__rpRd.primary()');
    await page.sleep(600);
    await page.eval(`document.querySelector('#mode [data-m="edit"]').click()`);
    await page.sleep(300);
    const items = '.content-scroll .section-item-container';
    const a = await rect(items, 2);
    const b = await rect(items, 3);
    out.target = b.id; out.prev = a.id;
    // 1) 悬停/点击第 4 条经历
    await page.move(b.x + b.w * 0.4, b.y + Math.min(10, b.h / 2));
    await page.sleep(150);
    await page.click(b.x + b.w * 0.4, b.y + Math.min(10, b.h / 2));
    await page.sleep(250);
    out.afterClick = await probe(page);
    await page.shot(OUT + '/' + PREFIX + '-1-click-item.png', await zone(a, b));
    // 2) 鼠标移向操作栏
    const bar = out.afterClick.bars[0];
    if (bar) {
      const from = { x: b.x + b.w * 0.4, y: b.y + Math.min(10, b.h / 2) };
      await page.move(bar.x + bar.w / 2, bar.y + bar.h / 2, 12, from);
      await page.sleep(200);
      out.onBar = await probe(page);
      await page.shot(OUT + '/' + PREFIX + '-2-move-to-bar.png', await zone(a, b));
    }
    // 3) 点击另一条
    const c = await rect(items, 1);
    await page.click(c.x + c.w * 0.3, c.y + Math.min(10, c.h / 2));
    await page.sleep(250);
    out.clickOther = await probe(page);
    // 4) 点击简历外空白（舞台背景）
    const ir = await page.eval(`(() => { const r = document.querySelector('#frame').getBoundingClientRect(); return { x: r.left, y: r.top }; })()`);
    await page.click(Math.max(5, ir.x - 20), ir.y + 300);
    await page.sleep(250);
    out.clickOutside = await probe(page);
    await page.shot(OUT + '/' + PREFIX + '-3-click-outside.png');
    // 5) 再选中，Esc
    await page.click(c.x + c.w * 0.3, c.y + Math.min(10, c.h / 2));
    await page.sleep(200);
    await page.key('Escape', 'Escape', 27);
    await page.sleep(200);
    out.esc = await probe(page);
    out.logs = page.logs;
  } finally {
    await page.close();
  }
  console.log(JSON.stringify(out, null, 1));
}
if (import.meta.url === 'file://' + process.argv[1]) main();
