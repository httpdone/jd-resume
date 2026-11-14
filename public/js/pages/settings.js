import { icon, esc, el, $, $$, toast, confirmDialog, modal } from '../ui.js';
import { get, put, post, del } from '../api.js';
import { refreshLlmStatus } from '../store.js';

const STAGES = { todo: '未开始', active: '进行中', interview: '面试阶段', offer: '成功', closed: '结束' };
const DEFAULT_STATUSES = [
  { name: '待投递', color: '#94a3b8', stage: 'todo' }, { name: '已投递', color: '#3b82f6', stage: 'active' }, { name: '笔试/测评', color: '#8b5cf6', stage: 'active' },
  { name: '一面', color: '#06b6d4', stage: 'interview' }, { name: '二面', color: '#14b8a6', stage: 'interview' }, { name: '三面/终面', color: '#0ea5e9', stage: 'interview' },
  { name: 'HR面', color: '#f59e0b', stage: 'interview' }, { name: 'Offer', color: '#22c55e', stage: 'offer' }, { name: '已拒绝', color: '#ef4444', stage: 'closed' }, { name: '已放弃', color: '#64748b', stage: 'closed' },
];

export async function render(view) {
  const [s, apps, health] = await Promise.all([get('/api/settings'), get('/api/apps'), get('/api/health')]);
  let statuses = apps.statuses.map((x) => ({ ...x }));
  view.innerHTML = `<div class="page" style="max-width:980px"><div class="page-head"><div><h1>设置</h1><p>大模型接口、投递状态与本地数据。所有数据都只保存在本机的数据目录里。</p></div></div>
  <div class="card card-pad" id="llm-card">
    <h3 style="margin:0 0 4px;display:flex;gap:8px;align-items:center">${icon('sparkles')}大模型接口 <span id="llm-state"></span></h3>
    <p class="muted small" style="margin:0 0 14px">任何 OpenAI 兼容接口都可以（/chat/completions，支持流式）。Key 保存在 <span class="mono">data/config.json</span>（已加入 .gitignore），也可用环境变量 <span class="mono">LLM_API_KEY</span> / <span class="mono">LLM_BASE_URL</span> / <span class="mono">LLM_MODEL</span>。</p>
    <div class="preset-grid" id="presets">${s.presets.map((p) => '<div class="preset" data-p="' + p.id + '">' + esc(p.name) + '<span>' + esc(p.models[0] || '自定义') + '</span></div>').join('')}</div>
    <div class="field"><label>Base URL</label><input class="input mono" name="baseUrl" placeholder="https://api.deepseek.com/v1"><div class="hint">填到 /v1 这一级即可，不要带 /chat/completions</div></div>
    <div class="cols"><div class="field"><label>API Key <a id="key-link" target="_blank" rel="noopener" class="small" style="font-weight:400;margin-left:6px"></a></label><input class="input mono" name="apiKey" type="password" autocomplete="off"><div class="hint" id="key-hint"></div></div>
    <div class="field"><label>模型名</label><div class="model-combo"><input class="input mono" name="model" autocomplete="off" placeholder="可搜索或直接输入"><button type="button" class="btn sm" id="fetch-models">获取模型列表</button></div><div class="model-drop hide" id="model-drop"></div><div class="hint" id="model-hint">填写 Base URL 与 Key 后可获取列表；仍允许手动输入。</div></div></div>
    <details class="task-models" id="task-models"><summary>按任务指定模型（可选）</summary><p class="muted small">留空则使用上面的默认模型。诊断包含岗位解析，改写包含定制与翻译，面试包含追问与模拟面试。</p><div class="cols"><div class="field"><label>诊断</label><input class="input mono" name="model-diagnose" placeholder="默认"></div><div class="field"><label>改写</label><input class="input mono" name="model-rewrite" placeholder="默认"></div><div class="field"><label>面试</label><input class="input mono" name="model-interview" placeholder="默认"></div></div></details>
    <div class="cols"><div class="field"><label>Temperature <span class="muted" id="temp-v"></span></label><input type="range" min="0" max="1.2" step="0.1" name="temperature"><div class="hint">改写建议 0.3-0.6；越低越保守</div></div>
    <div class="field"><label>最大输出 Token</label><input class="input" type="number" name="maxTokens" min="256" max="65536" step="256"><div class="hint">整份简历改写建议 ≥ 4096；报错时可调小</div></div></div>
    <div class="field"><label>结构化输出</label><select class="input" name="structuredOutput"><option value="auto">自动（优先 JSON Schema，不支持则回退）</option><option value="json_schema">JSON Schema</option><option value="json_object">JSON 模式</option><option value="off">关闭（仅提示词）</option></select><div class="hint">诊断、改写等 JSON 任务默认用 JSON Schema 约束字段；供应商不支持时自动改用 JSON 模式或提示词，并记住该模型可用的方式。</div></div>
    <div class="row" style="padding:12px 14px;border-radius:12px;background:var(--panel-2);border:1px solid var(--border);margin-bottom:14px"><label class="switch"><input type="checkbox" name="mock"><span></span></label><div class="grow"><b>演示模式</b><div class="small muted">不调用任何模型，用本地规则生成示例结果，体验诊断 / 改写 / JD 适配 / 写回的完整流程。</div></div></div>
    <div class="row"><button class="btn" id="test">${icon('refresh')}测试连接</button><span id="test-out" class="small"></span><span class="grow"></span><button class="btn ghost danger" id="clear-key">清除 Key</button><button class="btn primary" id="save">${icon('save')}保存</button></div>
  </div>
  <div class="card card-pad" style="margin-top:16px">
    <h3 style="margin:0 0 4px;display:flex;gap:8px;align-items:center">${icon('bell')}投递提醒</h3>
    <p class="muted small" style="margin:0 0 14px">首页会列出即将到来的笔试/面试，以及投递超过 N 天还停留在「已投递」、没有进入笔试或面试的记录。浏览器通知需要本机打开工作台，且你授予通知权限。</p>
    <div class="cols"><div class="field"><label>超过多少天无回音就提醒</label><input class="input" type="number" name="remindAfterDays" min="1" max="60" value="${s.remindAfterDays || 7}"></div>
    <div class="field"><label>浏览器通知</label><div class="row" style="height:38px"><label class="switch"><input type="checkbox" name="notifyEnabled" ${s.notifyEnabled ? 'checked' : ''}><span></span></label><span class="small muted">笔试/面试当天，以及超期无回音</span></div></div></div>
    <button class="btn sm primary" id="save-remind">${icon('save')}保存提醒设置</button>
  </div>
  <div class="card card-pad" style="margin-top:16px">
    <h3 style="margin:0 0 4px;display:flex;gap:8px;align-items:center">${icon('kanban')}投递状态</h3>
    <p class="muted small" style="margin:0 0 14px">自定义看板列与状态颜色；「阶段」用于统计转化率（面试阶段、成功会计入漏斗）。改名后已有记录不会自动迁移。</p>
    <div id="st-list"></div>
    <div class="row" style="margin-top:6px"><button class="btn sm" id="st-add">${icon('plus')}添加状态</button><button class="btn sm ghost" id="st-reset">恢复默认</button><span class="grow"></span><button class="btn sm primary" id="st-save">${icon('save')}保存状态</button></div>
  </div>
  <div class="card card-pad" style="margin-top:16px">
    <h3 style="margin:0 0 4px;display:flex;gap:8px;align-items:center">${icon('image')}常用头像 / 校徽</h3>
    <p class="muted small" style="margin:0 0 14px">保存在本机素材库，可一键套用到任意简历。也可在编辑器裁剪弹窗里保存或选用。</p>
    <div class="row" style="gap:8px;margin-bottom:10px">
      <button class="btn sm" id="lib-add-avatar">添加常用头像</button>
      <button class="btn sm" id="lib-add-school">添加常用校徽</button>
      <input type="file" accept="image/*" id="lib-file" hidden>
    </div>
    <div id="lib-list" class="media-lib wide"></div>
  </div>
  <div class="card card-pad" style="margin-top:16px">
    <h3 style="margin:0 0 10px;display:flex;gap:8px;align-items:center">${icon('info')}本地环境</h3>
    <table class="req-table"><tbody>
      <tr><td class="muted" style="width:140px">数据目录</td><td class="mono small">${esc(health.home || health.root)}${health.mode === 'portable' ? '<span class="muted">（沿用程序目录旁的旧数据）</span>' : health.mode === 'env' ? '<span class="muted">（RESUME_HOME）</span>' : ''}</td></tr>
      <tr><td class="muted">程序目录</td><td class="mono small">${esc(health.programDir || '')}</td></tr>
      <tr><td class="muted">PDF 浏览器</td><td class="mono small">${health.browser ? esc(health.browser) : '<span style="color:var(--bad)">未找到 Chrome / Edge，设置环境变量 CHROME_PATH</span>'}</td></tr>
      <tr><td class="muted">Node</td><td class="mono small">${esc(health.node)}</td></tr>
      <tr><td class="muted">数据文件</td><td class="small">简历：<span class="mono">resumes/&lt;名称&gt;/body.html</span>（每次保存前自动备份到 .history/）<br>投递：<span class="mono">data/applications.json</span>　JD：<span class="mono">data/jds.json</span>　素材：<span class="mono">data/stories.json</span>　模拟面试：<span class="mono">data/interviews.json</span>　配置：<span class="mono">data/config.json</span></td></tr>
      <tr><td class="muted">命令行</td><td class="small mono">npm start　·　node cli.mjs list　·　node cli.mjs pdf 我的简历 --open</td></tr>
    </tbody></table>
  </div>
  <div class="card card-pad" style="margin-top:16px">
    <h3 style="margin:0 0 4px;display:flex;gap:8px;align-items:center">${icon('layers')}数据管理</h3>
    <p class="muted small" style="margin:0 0 14px">示例数据是一位虚构候选人的两份简历和配套的 JD、经历素材、投递与面试记录，用来体验完整流程；导入时同名简历跳过，已有数据不会被覆盖。</p>
    <div class="row" style="gap:8px"><button class="btn sm" id="import-examples" ${health.hasExamples === false ? 'disabled' : ''}>${icon('download')}导入示例数据</button><span class="grow"></span><button class="btn sm danger" id="wipe-data">${icon('trash')}删除所有用户数据</button></div>
  </div></div>`;

  const f = (n) => view.querySelector('[name=' + n + ']');
  f('baseUrl').value = s.llm.baseUrl || '';
  f('model').value = s.llm.model || '';
  const byTask = s.llm.modelsByTask || {};
  f('model-diagnose').value = byTask.diagnose || '';
  f('model-rewrite').value = byTask.rewrite || '';
  f('model-interview').value = byTask.interview || '';
  f('temperature').value = s.llm.temperature ?? 0.4;
  f('maxTokens').value = s.llm.maxTokens || 32768;
  f('structuredOutput').value = s.llm.structuredOutput || 'auto';
  f('mock').checked = Boolean(s.mock);
  // 每个供应商的 Key 单独保存：切换供应商只显示它自己的 Key 状态
  const slotOf = (id, base) => id !== 'custom' ? id : 'custom:' + String(base || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '').toLowerCase();
  const showKey = () => {
    const masked = (s.llm.keyStatus || {})[slotOf(preset, f('baseUrl').value)];
    const name = (s.presets.find((x) => x.id === preset) || {}).name || preset;
    f('apiKey').placeholder = masked ? '已保存（' + name + '）：' + masked + '，留空则不修改'
      : s.llm.envKeyMasked ? name + ' 未单独保存 Key，将使用环境变量 ' + s.llm.envKeyMasked
      : name + ' 还没有 Key：sk-...';
  };
  let preset = s.llm.preset;
  let modelItems = (s.presets.find((x) => x.id === preset) || {}).models || [];
  const tempV = () => { $('#temp-v').textContent = f('temperature').value; };
  f('temperature').oninput = tempV; tempV();
  const state = () => { $('#llm-state').innerHTML = s.mock ? '<span class="badge warn">演示模式</span>' : s.ready ? '<span class="badge ok">已配置</span>' : '<span class="badge bad">未配置</span>'; };
  state();
  const choose = (id, fill) => {
    preset = id;
    const p = s.presets.find((x) => x.id === id);
    $$('.preset').forEach((x) => x.classList.toggle('active', x.dataset.p === id));
    modelItems = p?.models || [];
    const link = $('#key-link');
    link.textContent = p?.keyUrl ? '获取 Key ↗' : ''; link.href = p?.keyUrl || '#';
    $('#key-hint').textContent = id === 'ollama' ? '本地 Ollama 不需要 Key' : '';
    if (fill && p) { if (p.baseUrl) f('baseUrl').value = p.baseUrl; if (p.models[0]) f('model').value = p.models[0]; }
    if (fill) f('apiKey').value = '';
    showKey();
  };
  choose(preset, false);
  f('baseUrl').addEventListener('change', showKey);
  $('#presets').onclick = (e) => { const p = e.target.closest('[data-p]'); if (p) choose(p.dataset.p, true); };
  const collect = () => ({ llm: { preset, baseUrl: f('baseUrl').value.trim(), apiKey: f('apiKey').value.trim(), model: f('model').value.trim(), temperature: +f('temperature').value, maxTokens: +f('maxTokens').value, structuredOutput: f('structuredOutput').value, modelsByTask: { diagnose: f('model-diagnose').value.trim(), rewrite: f('model-rewrite').value.trim(), interview: f('model-interview').value.trim() } }, mock: f('mock').checked });
  $('#save').onclick = async (e) => {
    const b = e.currentTarget; b.classList.add('loading');
    try { Object.assign(s, await put('/api/settings', collect())); f('apiKey').value = ''; showKey(); state(); await refreshLlmStatus(); toast('设置已保存'); } catch (err) { toast(err.message, 'err'); } finally { b.classList.remove('loading'); }
  };
  f('mock').onchange = () => $('#save').click();
  $('#clear-key').onclick = async () => { if (!(await confirmDialog('只清除「' + ((s.presets.find((x) => x.id === preset) || {}).name || preset) + '」的 API Key，其他供应商不受影响。确定？'))) return; Object.assign(s, await put('/api/settings', { llm: { clearKey: true, keyPreset: preset, keyBaseUrl: f('baseUrl').value.trim() } })); f('apiKey').value = ''; showKey(); state(); await refreshLlmStatus(); toast('已清除'); };

  const drop = $('#model-drop');
  const modelInput = f('model');
  const renderDrop = (q) => {
    const query = (q == null ? modelInput.value : q).toLowerCase();
    const list = modelItems.filter((m) => !query || String(m).toLowerCase().includes(query));
    if (!list.length) { drop.classList.add('hide'); drop.innerHTML = ''; return; }
    drop.classList.remove('hide');
    drop.innerHTML = list.map((m) => '<div class="model-opt" data-m="' + esc(m) + '">' + esc(m) + '</div>').join('');
  };
  modelInput.addEventListener('focus', () => renderDrop());
  modelInput.addEventListener('input', () => renderDrop());
  modelInput.addEventListener('blur', () => setTimeout(() => drop.classList.add('hide'), 180));
  drop.onclick = (e) => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (!m) return;
    modelInput.value = m;
    drop.classList.add('hide');
  };
  const origChoose = choose;
  // choose already fills #model-list which we removed; keep it safe
  $('#fetch-models').onclick = async (e) => {
    const b = e.currentTarget; b.classList.add('loading');
    const hint = $('#model-hint');
    hint.textContent = '正在获取模型列表…'; hint.style.color = '';
    try {
      const r = await post('/api/settings/models', { baseUrl: f('baseUrl').value.trim(), apiKey: f('apiKey').value.trim(), preset });
      modelItems = r.models || [];
      if (r.ok) {
        hint.textContent = '已获取 ' + modelItems.length + ' 个模型，可搜索选择，也可继续手动输入。';
        hint.style.color = 'var(--ok)';
        renderDrop('');
        modelInput.focus();
      } else {
        hint.textContent = (r.error || '无法获取列表') + (r.hint ? ' ' + r.hint : '');
        hint.style.color = 'var(--warn)';
        if (modelItems.length) renderDrop('');
      }
    } catch (err) { hint.textContent = err.message; hint.style.color = 'var(--bad)'; }
    finally { b.classList.remove('loading'); }
  };

  let libKind = 'avatar';
  const libFile = $('#lib-file');
  const drawLib = async () => {
    const box = $('#lib-list');
    try {
      const { items } = await get('/api/media-library');
      if (!items.length) { box.innerHTML = '<span class="muted small">还没有常用图片</span>'; return; }
      box.innerHTML = items.map((it) => '<div class="media-lib-item" data-id="' + it.id + '"><img src="/api/media-library/' + it.id + '" alt=""><span class="small">' + esc(it.title || it.kind) + '</span><button class="btn xs ghost danger" data-del>删除</button></div>').join('');
    } catch (err) { box.innerHTML = '<span class="muted small">' + esc(err.message) + '</span>'; }
  };
  drawLib();
  $('#lib-add-avatar').onclick = () => { libKind = 'avatar'; libFile.click(); };
  $('#lib-add-school').onclick = () => { libKind = 'school'; libFile.click(); };
  libFile.onchange = async () => {
    const file = libFile.files[0]; libFile.value = '';
    if (!file) return;
    const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
    try {
      await post('/api/media-library', { kind: libKind, title: file.name.replace(/\.[^.]+$/, ''), data });
      toast('已加入常用库');
      await drawLib();
    } catch (err) { toast(err.message, 'err'); }
  };
  $('#lib-list').onclick = async (e) => {
    const item = e.target.closest('[data-id]'); if (!item) return;
    if (e.target.closest('[data-del]')) {
      if (!(await confirmDialog('从常用库删除这张图片？', { ok: '删除', danger: true }))) return;
      try { await del('/api/media-library/' + item.dataset.id); await drawLib(); toast('已删除'); } catch (err) { toast(err.message, 'err'); }
    }
  };

  $('#test').onclick = async (e) => {
    const b = e.currentTarget; b.classList.add('loading');
    const out = $('#test-out'); out.textContent = '连接中…'; out.style.color = '';
    try {
      const r = await post('/api/settings/test', collect());
      out.style.color = r.ok ? 'var(--ok)' : 'var(--bad)';
      out.textContent = r.ok ? '✓ 连接成功（' + r.ms + ' ms）：' + r.reply : '✗ ' + r.error;
    } catch (err) { out.style.color = 'var(--bad)'; out.textContent = err.message; } finally { b.classList.remove('loading'); }
  };

  const drawSt = () => {
    $('#st-list').innerHTML = statuses.map((x, i) => '<div class="status-row" data-i="' + i + '"><div class="row" style="flex-direction:column;gap:0"><button class="btn xs ghost icon" data-up title="上移" style="height:14px">▲</button><button class="btn xs ghost icon" data-down title="下移" style="height:14px">▼</button></div><input class="input sm" data-k="name" value="' + esc(x.name) + '"><input type="color" data-k="color" value="' + esc(x.color) + '"><select class="input sm" data-k="stage">' + Object.entries(STAGES).map(([k, v]) => '<option value="' + k + '"' + (k === x.stage ? ' selected' : '') + '>' + v + '</option>').join('') + '</select><button class="btn xs ghost icon danger" data-del>' + icon('trash') + '</button></div>').join('');
  };
  drawSt();
  $('#st-list').oninput = (e) => { const r = e.target.closest('[data-i]'); if (r && e.target.dataset.k) statuses[+r.dataset.i][e.target.dataset.k] = e.target.value; };
  $('#st-list').onclick = (e) => {
    const r = e.target.closest('[data-i]'); if (!r) return;
    const i = +r.dataset.i;
    if (e.target.closest('[data-del]')) statuses.splice(i, 1);
    else if (e.target.closest('[data-up]') && i > 0) [statuses[i - 1], statuses[i]] = [statuses[i], statuses[i - 1]];
    else if (e.target.closest('[data-down]') && i < statuses.length - 1) [statuses[i + 1], statuses[i]] = [statuses[i], statuses[i + 1]];
    else return;
    drawSt();
  };
  $('#save-remind').onclick = async () => {
    try {
      const days = +view.querySelector('[name=remindAfterDays]').value || 7;
      let notifyEnabled = view.querySelector('[name=notifyEnabled]').checked;
      if (notifyEnabled && 'Notification' in window && Notification.permission !== 'granted') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') { notifyEnabled = false; view.querySelector('[name=notifyEnabled]').checked = false; toast('未授予通知权限，已仅保存天数', 'warn'); }
      }
      await put('/api/settings', { remindAfterDays: days, notifyEnabled });
      toast('提醒设置已保存');
    } catch (err) { toast(err.message, 'err'); }
  };
  $('#import-examples').onclick = async () => {
    if (!(await confirmDialog('把示例简历和配套数据导入到当前数据目录？\n同名简历会跳过，已有的 JD、素材、投递、面试记录不会被覆盖。', { title: '导入示例数据', ok: '导入' }))) return;
    try {
      const r = await post('/api/userdata/import-examples');
      const c = r.counts || {};
      toast('已导入 ' + r.resumes.added.length + ' 份简历' + (r.resumes.skipped.length ? '（跳过同名 ' + r.resumes.skipped.length + ' 份）' : '') + '，JD ' + (c.jds || 0) + ' 条，素材 ' + (c.stories || 0) + ' 条，投递 ' + (c.applications || 0) + ' 条', 'ok', 4000);
    } catch (err) { toast(err.message, 'err'); }
  };
  $('#wipe-data').onclick = async () => {
    const home = health.home || health.root;
    if (!(await confirmDialog('将永久删除数据目录里的全部内容，无法恢复：\n· 所有简历及历史版本\n· 头像 / 校徽素材库\n· JD 库、经历素材、投递记录、模拟面试\n· 导出的 PDF / HTML 文件\n· 设置与所有 API Key\n\n数据目录：' + home + '\n程序本身不受影响，删除后会恢复到第一次启动的状态（只保留一份入门简历）。', { title: '删除所有用户数据', ok: '继续', danger: true }))) return;
    const body = el('<div><p style="margin:0 0 10px">这是最后一步。请在下面输入 <b>删除</b> 两个字确认。</p><input class="input" name="typed" autocomplete="off" placeholder="删除"></div>');
    const m = modal({ title: '再次确认', body, width: 440, actions: [
      { label: '取消' },
      { label: '永久删除所有数据', cls: 'danger', onClick: async () => {
        if (body.querySelector('[name=typed]').value.trim() !== '删除') { toast('请输入「删除」确认', 'warn'); return false; }
        await post('/api/userdata/wipe', { confirm: 'DELETE_ALL_USER_DATA' });
        toast('所有用户数据已删除');
        setTimeout(() => { location.hash = '#/'; location.reload(); }, 600);
      } },
    ] });
    const okBtn = m.el.querySelector('.modal-foot .danger');
    okBtn.disabled = true;
    body.querySelector('[name=typed]').addEventListener('input', (e) => { okBtn.disabled = e.target.value.trim() !== '删除'; });
  };
  $('#st-add').onclick = () => { statuses.push({ name: '新状态', color: '#6366f1', stage: 'active' }); drawSt(); };
  $('#st-reset').onclick = () => { statuses = DEFAULT_STATUSES.map((x) => ({ ...x })); drawSt(); };
  $('#st-save').onclick = async () => { try { const r = await put('/api/apps/_statuses', { statuses }); statuses = r.statuses; drawSt(); toast('状态已保存'); } catch (err) { toast(err.message, 'err'); } };
}
