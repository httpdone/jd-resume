import { icon, esc, el, toast, modal } from './ui.js';
import { get, patch } from './api.js';

export function thumbHtml(t, { compact = false } = {}) {
  const th = t.thumb || {};
  const bar = th.bar || t.accent || '#4183ff';
  const side = th.side;
  const band = th.band;
  const bg = th.bg || '#fff';
  const title = th.title || t.accent;
  const text = th.text || '#333';
  const lines = [72, 90, 64, 80, 55].map((w, i) => '<i style="width:' + w + '%;background:' + text + ';opacity:' + (0.28 - i * 0.03) + '"></i>').join('');
  return '<div class="tpl-thumb' + (compact ? ' compact' : '') + '" style="background:' + bg + '">'
    + (side ? '<b class="s" style="background:' + side + '"></b>' : '')
    + '<b class="bar" style="background:' + bar + '"></b>'
    + '<b class="nm" style="background:' + text + ';opacity:.55"></b>'
    + (band ? '<b class="bd" style="background:' + band + '"></b>' : '<b class="ti" style="background:' + title + '"></b>')
    + '<span class="ls">' + lines + '</span></div>';
}

export async function loadTemplates() {
  return (await get('/api/templates')).items;
}

export async function applyResumeStyle(slug, { template, theme }) {
  return patch('/api/resumes/' + encodeURIComponent(slug) + '/meta', { template, theme });
}

export async function openThemePicker(slug, { template, theme } = {}, onApplied) {
  const items = await loadTemplates();
  const cur = { template: template || 'classic', theme: { ...(theme || {}) } };
  const body = el('<div><div class="tpl-grid" id="tpl-grid"></div>'
    + '<div class="tpl-tune"><h4>快速调节</h4><p class="muted small" style="margin:0 0 10px">同一份简历内容不变，只改外观。切换后会重新分页，建议看一眼再导出 PDF。</p>'
    + '<div class="cols">'
    + '<div class="field"><label>主题色</label><div class="row"><input type="color" name="accent" style="width:46px;height:36px;padding:2px;border:1px solid var(--border);border-radius:8px;background:transparent"><input class="input" name="accentHex" placeholder="#4183ff" style="width:110px"></div></div>'
    + '<div class="field"><label>正文字号 <span class="muted" id="fs-v"></span></label><input type="range" name="fontSize" min="11" max="15" step="0.5"></div>'
    + '<div class="field"><label>行距 <span class="muted" id="lh-v"></span></label><input type="range" name="lineHeight" min="1.4" max="2.1" step="0.05"></div>'
    + '<div class="field"><label>页边距 <span class="muted" id="mg-v"></span></label><input type="range" name="margin" min="8" max="18" step="1"></div>'
    + '</div></div></div>');

  const defOf = (id) => items.find((x) => x.id === id) || items[0];
  const paintGrid = () => {
    body.querySelector('#tpl-grid').innerHTML = items.map((t) => {
      const on = t.id === cur.template;
      return '<button type="button" class="tpl-card' + (on ? ' on' : '') + '" data-id="' + t.id + '">'
        + thumbHtml(t)
        + '<div class="meta"><b>' + esc(t.name) + '</b><span class="badge">' + esc(t.tag) + '</span></div>'
        + '<p>' + esc(t.desc) + '</p></button>';
    }).join('');
  };
  const syncTune = () => {
    const d = defOf(cur.template);
    const accent = cur.theme.accent || d.accent;
    const fs = cur.theme.fontSize ?? d.fontSize;
    const lh = cur.theme.lineHeight ?? d.lineHeight;
    const mg = cur.theme.margin ?? d.margin;
    body.querySelector('[name=accent]').value = toColor(accent);
    body.querySelector('[name=accentHex]').value = toColor(accent);
    body.querySelector('[name=fontSize]').value = fs;
    body.querySelector('[name=lineHeight]').value = lh;
    body.querySelector('[name=margin]').value = mg;
    body.querySelector('#fs-v').textContent = fs + ' px';
    body.querySelector('#lh-v').textContent = Number(lh).toFixed(2);
    body.querySelector('#mg-v').textContent = mg + ' mm';
  };
  paintGrid();
  syncTune();
  body.querySelector('#tpl-grid').onclick = (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    cur.template = b.dataset.id;
    const d = defOf(cur.template);
    cur.theme = { accent: d.accent, fontSize: d.fontSize, lineHeight: d.lineHeight, margin: d.margin };
    paintGrid();
    syncTune();
  };
  const readTune = () => {
    cur.theme.accent = toColor(body.querySelector('[name=accentHex]').value || body.querySelector('[name=accent]').value);
    cur.theme.fontSize = +body.querySelector('[name=fontSize]').value;
    cur.theme.lineHeight = +body.querySelector('[name=lineHeight]').value;
    cur.theme.margin = +body.querySelector('[name=margin]').value;
    syncTune();
  };
  body.querySelector('[name=accent]').oninput = (e) => { body.querySelector('[name=accentHex]').value = e.target.value; readTune(); };
  body.querySelector('[name=accentHex]').onchange = readTune;
  body.querySelectorAll('input[type=range]').forEach((i) => { i.oninput = readTune; });

  return new Promise((resolve) => {
    modal({
      title: '选择模板与版式', body, width: 820,
      actions: [
        { label: '取消', onClick: () => resolve(null) },
        { label: '应用', cls: 'primary', icon: 'layout', onClick: async () => {
          readTune();
          try {
            await applyResumeStyle(slug, cur);
            toast('已切换为「' + defOf(cur.template).name + '」');
            if (onApplied) await onApplied(cur);
            resolve(cur);
          } catch (err) { toast(err.message, 'err'); return false; }
        } },
      ],
    });
  });
}

function toColor(s) {
  const x = String(s || '').trim();
  if (/^#([0-9a-f]{6})$/i.test(x)) return x;
  if (/^#([0-9a-f]{3})$/i.test(x)) {
    const a = x.slice(1);
    return '#' + a[0] + a[0] + a[1] + a[1] + a[2] + a[2];
  }
  return '#4183ff';
}
