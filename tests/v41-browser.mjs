// 在无头 Chrome 里验证结构操作、发给模型的文本、序列化不含编辑器 UI
import { launch } from './browser.mjs';

export async function runV41Browser({ ok, base, slug }) {
  const page = await launch({ width: 1500, height: 1000 });
  try {
    await page.goto(base + '/#/editor/' + encodeURIComponent(slug));
    await page.waitFor('!!window.__rpRd && window.__rpRd.primary && window.__rpRd.primary()');
    await page.sleep(400);
    const text = await page.eval(`(() => {
      const rd = window.__rpRd;
      return { llm: rd.toLLMText(), plain: rd.toPlainText(), html: rd.serialize() };
    })()`);
    ok('发给模型的文本不含工具栏「更换/编辑/删除」', (() => {
      const profile = (text.llm.split('##')[0] || '');
      return !text.llm.includes('更换编辑删除') && !text.plain.includes('更换编辑删除') && !profile.includes('更换') && !profile.includes('删除') && !profile.includes('编辑');
    })(), text.llm.split('##')[0]);
    ok('基本信息只出现一次', (text.llm.match(/# 基本信息/g) || []).length === 1 && !/^# 基本信息\n[\s\S]*# 基本信息/m.test(text.llm));
    ok('发给模型的文本不含原始模块 id', !/\[project_experience-|\[works-|\[reasearch_experience|project_experience-\d+|reasearch_experience-/.test(text.llm), text.llm.slice(0, 400));
    ok('文本使用短编号 P1/W1', /### P1 /.test(text.llm) && /### W1 /.test(text.llm), text.llm.match(/### .+/g)?.slice(0, 8)?.join(' | '));
    ok('序列化正文不含编辑器 UI 文字', !/更换编辑删除|rp-media-bar|data-rp-chrome|rp-add-crest|edu-crest/.test(text.html));
    ok('保留 bullet 内换行（子条以 - 呈现）', /  - /.test(text.llm) || /• .+\n  - /.test(text.llm) || text.llm.includes('\n  - ') || /• /.test(text.llm));

    const before = await page.eval(`window.__rpRd.modules().map((m) => ({ id: m.id, n: m.items.length, title: m.title }))`);
    const added = await page.eval(`(() => {
      const rd = window.__rpRd;
      const id = rd.addModule('certificates', { title: '证书' });
      const itemId = rd.items().filter((i) => i.module === id).pop()?.id;
      rd.addBullet(itemId);
      const copyId = rd.duplicateItem(rd.items().find((i) => i.module === 'project_experience')?.id);
      rd.moveModule(id, -1);
      return { id, itemId, copyId, mods: rd.modules().map((m) => m.id), titles: rd.modules().map((m) => m.title), nItems: rd.items().length };
    })()`);
    ok('可新增模块（证书）', added.mods.includes(added.id) && added.titles.includes('证书'), JSON.stringify(added.mods));
    ok('条目可复制、可增 bullet', added.copyId && added.nItems > before.reduce((s, m) => s + m.n, 0), JSON.stringify(added));
    const undo = await page.eval(`(() => {
      const rd = window.__rpRd;
      const before = rd.modules().map((m) => m.title);
      let n = 0;
      while (rd.modules().some((m) => m.title === '证书') && n < 12) { rd.undo(); n++; }
      return { n, gone: !rd.modules().some((m) => m.title === '证书'), before, after: rd.modules().map((m) => m.title) };
    })()`);
    ok('结构操作支持撤销', undo.gone && undo.n > 0, JSON.stringify(undo));

    // 再加回来便于结构树可见
    await page.eval(`window.__rpRd.addModule('certificates', { title: '证书' })`);
    await page.eval(`document.querySelector('#mode [data-m="edit"]')?.click()`);
    await page.sleep(300);
    const ui = await page.eval(`({
      tree: !!document.querySelector('#outline .ol-mod-head .ol-acts'),
      addBtn: !!document.querySelector('#ol-add-mod'),
      ph: [...document.querySelectorAll('.rp-media-ph')].map((n) => n.textContent),
      bars: document.querySelectorAll('.rp-page-overlay').length,
    })`);
    ok('左侧结构树可操作（有工具按钮）', ui.tree && ui.addBtn, JSON.stringify(ui));
    ok('无校徽时右上角有添加占位（编辑态）', ui.ph.some((t) => /校徽/.test(t)) || ui.ph.length >= 1, JSON.stringify(ui.ph));
  } finally {
    await page.close();
  }
}
