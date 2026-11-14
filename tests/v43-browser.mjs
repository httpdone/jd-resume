// v4.3 浏览器测试：新增条目与原条目对齐（7 套模板）、选中框包住新条目、本科时间、示例投递 1 条
import { launch } from './browser.mjs';

const THEMES = ['classic', 'minimal', 'navy', 'tech', 'academic', 'international', 'colorband'];

const MEASURE = `() => {
  const d = document.querySelector('#frame').contentDocument;
  const rd = window.__rpRd;
  const take = (it) => {
    if (!it) return null;
    const row = it.querySelector(':scope > .menu-title');
    const left = row?.querySelector('.left')?.getBoundingClientRect();
    const right = row?.querySelector('.right')?.getBoundingClientRect();
    return {
      id: it.id,
      display: row ? getComputedStyle(row).display : '',
      left: left && Math.round(left.left * 10) / 10,
      right: right && Math.round(right.right * 10) / 10,
      topL: left && Math.round(left.top * 10) / 10,
      topR: right && Math.round(right.top * 10) / 10,
      hasPoint: !!it.querySelector('.rs-dot'),
      dateSpans: row ? row.querySelectorAll('.right span').length : 0,
      dateText: (row?.querySelector('.right')?.textContent || '').replace(/\\s+/g, ' ').trim(),
      stacked: !!(row && row.querySelector('.left') && row.querySelector('.right') && Math.abs(row.querySelector('.left').getBoundingClientRect().top - row.querySelector('.right').getBoundingClientRect().top) > 12),
    };
  };
  const inMod = (id) => {
    const mod = rd.primary().querySelector('[id="' + id + '"]');
    const host = mod?.querySelector('.info-content') || mod;
    return [...(host?.querySelectorAll('.section-item-container') || [])].map(take);
  };
  return { edus: inMod('edus'), works: inMod('works'), project_experience: inMod('project_experience') };
}`;

async function openEditor(page, base, slug) {
  await page.goto(base + '/#/editor/' + encodeURIComponent(slug));
  await page.sleep(200);
  await page.eval(`([...document.querySelectorAll('button')].find((b) => /离开/.test(b.textContent)) || { click() {} }).click()`);
  await page.sleep(200);
  await page.waitFor('!!window.__rpRd && window.__rpRd.primary && window.__rpRd.primary()');
  await page.sleep(300);
  await page.eval(`document.querySelector('#mode [data-m="edit"]')?.click()`);
  await page.sleep(150);
}

function aligned(oldIt, newIt) {
  const bad = [];
  if (!newIt) return ['没有新增条目'];
  if (newIt.display !== 'flex') bad.push('标题行不是 flex（当前 ' + newIt.display + '）');
  if (newIt.stacked) bad.push('日期没有和标题在同一行');
  if (!newIt.hasPoint) bad.push('缺少日期圆点');
  if (newIt.dateSpans < 3) bad.push('日期不是三 span 结构（' + newIt.dateSpans + '）');
  if (oldIt) {
    if (Math.abs(newIt.left - oldIt.left) > 2) bad.push('左边不齐 ' + oldIt.left + ' vs ' + newIt.left);
    if (Math.abs(newIt.right - oldIt.right) > 3) bad.push('右边不齐 ' + oldIt.right + ' vs ' + newIt.right);
  }
  return bad;
}

export async function runV43Browser({ ok, base, slug, j }) {
  const enc = encodeURIComponent;
  const page = await launch({ width: 1500, height: 1000 });
  try {
    // API：示例投递 1 条
    const apps = await j('GET', '/api/apps');
    ok('测试环境保留示例投递（字节跳动）且状态列表完整', (apps.d?.items || []).some((x) => x.company === '字节跳动' && x.role === '大模型应用开发实习') && (apps.d?.statuses || []).length >= 10 && apps.d.statuses.some((s) => s.name === '已放弃'), JSON.stringify(apps.d?.items?.map((x) => x.company)));

    await j('PATCH', '/api/resumes/' + enc(slug) + '/meta', { template: 'classic' });
    await openEditor(page, base, slug);
    const undergrad = await page.eval(`(() => {
      const d = document.querySelector('#frame').contentDocument;
      const it = [...d.querySelectorAll('.content-scroll [id^="edus-"]')].find((e) => e.textContent.includes('江苏信息工程学院'));
      return (it?.querySelector('.menu-title .right')?.textContent || '').replace(/\\s+/g, ' ').trim();
    })()`);
    ok('预览里本科时间是 2020年09月 - 2024年06月', undergrad === '2020年09月 - 2024年06月', undergrad);

    const problems = [];
    for (const theme of THEMES) {
      await j('PATCH', '/api/resumes/' + enc(slug) + '/meta', { template: theme });
      await openEditor(page, base, slug);
      const added = await page.eval(`(() => {
        const rd = window.__rpRd;
        return { edu: rd.addItem('edus'), work: rd.addItem('works'), project: rd.addItem('project_experience') };
      })()`);
      await page.sleep(250);
      const m = await page.eval('(' + MEASURE + ')()');
      for (const [mod, key] of [['edus', 'edu'], ['works', 'work'], ['project_experience', 'project']]) {
        const list = m[mod] || [];
        const neu = list.find((x) => x.id === added[key]) || list[list.length - 1];
        const old = list.find((x) => x.id !== neu?.id);
        const bad = aligned(old, neu);
        if (bad.length) problems.push(theme + '/' + mod + '：' + bad.join('；') + '  new=' + JSON.stringify(neu) + ' old=' + JSON.stringify(old && { left: old.left, right: old.right, display: old.display }));
      }
      // 选中新教育条目，操作栏应对准它
      const sel = await page.eval(`(() => {
        const rd = window.__rpRd;
        const id = ${JSON.stringify('x')};
        return id;
      })()`);
      // click the new edu item
      const clicked = await page.eval(`(() => {
        const f = document.querySelector('#frame');
        const el = window.__rpRd.primary().querySelector('[id="' + ${JSON.stringify('tmp')} + '"]');
        return null;
      })()`);
      const clickNew = await page.eval(`(() => {
        const f = document.querySelector('#frame');
        const el = window.__rpRd.primary().querySelector('[id="${added.edu}"]');
        if (!el) return { ok: false, reason: 'missing' };
        el.scrollIntoView({ block: 'center' });
        const ir = f.getBoundingClientRect(); const z = ir.width / f.offsetWidth;
        const r = el.getBoundingClientRect();
        return { x: ir.left + r.left * z + 24, y: ir.top + r.top * z + 8, id: el.id, top: r.top, h: r.height, left: r.left, w: r.width };
      })()`);
      if (clickNew?.x) {
        const st = await page.eval(`document.querySelector('#stage').getBoundingClientRect().toJSON()`);
        const x = Math.max(st.left + 12, Math.min(clickNew.x, st.right - 40));
        await page.click(x, clickNew.y);
        await page.sleep(180);
        const box = await page.eval(`(() => {
          const s = document.querySelector('.rp-ov-sel');
          const b = document.querySelector('.rp-struct-bar');
          const sr = s?.getBoundingClientRect();
          return { for: s?.dataset.for || '', barFor: b?.dataset.for || '', sy: sr?.top, sh: sr?.height };
        })()`);
        if (box.for !== added.edu || box.barFor !== added.edu) problems.push(theme + '：选中框/操作栏没有对准新条目（sel=' + box.for + ' bar=' + box.barFor + ' 期望 ' + added.edu + '）');
      }
      // 清掉脏标记，避免下一轮弹窗
      await page.eval(`document.querySelector('#b-save') && (window.__rpSkipSave = true)`);
    }
    ok('7 套模板下，教育 / 实习 / 项目的新增条目与原条目左右对齐，且是同一套编辑框', !problems.length, problems.slice(0, 5).join(' | '));

    // 新增没有范例的模块（证书）时，模板本身也要是规范结构
    await j('PATCH', '/api/resumes/' + enc(slug) + '/meta', { template: 'classic' });
    await openEditor(page, base, slug);
    const cert = await page.eval(`(() => {
      const rd = window.__rpRd;
      const id = rd.addModule('certificates');
      const it = rd.primary().querySelector('[id="' + id + '"] .section-item-container');
      const row = it.querySelector('.menu-title');
      return {
        id,
        itemId: it?.id,
          hasPoint: !!it.querySelector('.rs-dot'),
        dateSpans: row ? row.querySelectorAll('.right span').length : 0,
        display: row ? getComputedStyle(row).display : '',
        stacked: !!(row && Math.abs(row.querySelector('.left').getBoundingClientRect().top - row.querySelector('.right').getBoundingClientRect().top) > 12),
      };
    })()`);
    ok('新增证书模块的空条目也是同一套编辑框（标题+时间同一行）', cert.hasPoint && cert.dateSpans >= 1 && cert.display === 'flex' && !cert.stacked, JSON.stringify(cert));

    // 投递页只有一条示例
    await page.eval(`window.addEventListener('beforeunload', (e) => { e.stopImmediatePropagation(); }, true)`);
    await page.goto(base + '/#/apps');
    await page.sleep(200);
    await page.eval(`([...document.querySelectorAll('button')].find((b) => /离开/.test(b.textContent)) || { click() {} }).click()`);
    await page.sleep(500);
    await page.eval(`[...document.querySelectorAll('button,a,[data-t]')].find((e) => /列表/.test(e.textContent))?.click()`);
    await page.sleep(300);
    const listText = await page.eval(`document.body.innerText`);
    ok('投递列表页能看到示例「字节跳动 · 大模型应用开发实习」，并仍可新增投递', listText.includes('字节跳动') && listText.includes('大模型应用开发实习') && /新增投递/.test(listText), listText.slice(0, 200));
  } finally {
    await page.close();
  }
}
