// 经后端代理拉取 OpenAI 兼容的模型列表，Key 不进浏览器
import { keyFor, loadSettings, PRESETS, isLocalBase } from './settings.mjs';

function parseOpenAI(data) {
  const rows = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : (Array.isArray(data) ? data : []));
  const names = [];
  for (const row of rows) {
    const id = typeof row === 'string' ? row : (row?.id || row?.name || row?.model || '');
    if (id && !names.includes(id)) names.push(String(id));
  }
  return names;
}

function parseOllama(data) {
  const rows = Array.isArray(data?.models) ? data.models : [];
  const names = [];
  for (const row of rows) {
    const id = row?.name || row?.model || row?.id || '';
    if (id && !names.includes(id)) names.push(String(id));
  }
  return names;
}

function fallbackModels(presetId) {
  const p = PRESETS.find((x) => x.id === presetId) || PRESETS.find((x) => x.id === 'custom');
  return (p?.models || []).slice();
}

function looksOllama(url) {
  return /11434|ollama/i.test(url || '');
}

async function getJson(url, headers, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* 非 JSON */ }
    return { ok: res.ok, status: res.status, data, text: text.slice(0, 300) };
  } finally {
    clearTimeout(t);
  }
}

export async function fetchModelList({ baseUrl, apiKey, preset } = {}) {
  const settings = loadSettings();
  const raw = String(baseUrl || settings.llm.baseUrl || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
  const presetId = preset || settings.llm.preset || 'custom';
  // 只用当前供应商自己的 Key（自定义按 Base URL 区分），不会借用别家的
  const key = (apiKey && !String(apiKey).includes('****')) ? String(apiKey).trim() : keyFor(settings.llm, presetId, raw).key;
  const fallback = fallbackModels(presetId);
  if (!raw) {
    return { ok: false, fallback: true, models: fallback, error: '请先填写 Base URL', hint: '保存 Base URL 后再获取列表，或直接手动输入模型名。' };
  }
  if (!key && !isLocalBase(raw) && !looksOllama(raw)) {
    return { ok: false, fallback: true, models: fallback, error: '请先填写 API Key', hint: '大部分云厂商需要 Key 才能列出模型；填写后点「获取模型列表」。本地 Ollama 通常不需要 Key。' };
  }

  const headers = { accept: 'application/json', authorization: 'Bearer ' + (key || 'none') };
  const tried = [];

  try {
    const r = await getJson(raw + '/models', headers);
    tried.push({ url: raw + '/models', status: r.status });
    if (r.ok) {
      const models = parseOpenAI(r.data);
      if (models.length) return { ok: true, source: 'openai', models, tried };
    }
  } catch (err) {
    tried.push({ url: raw + '/models', error: err.name === 'AbortError' ? '超时' : (err.message || '网络错误') });
  }

  if (looksOllama(raw) || tried.some((t) => t.status === 404 || t.error)) {
    const origin = raw.replace(/\/v1$/i, '');
    try {
      const r = await getJson(origin + '/api/tags', headers);
      tried.push({ url: origin + '/api/tags', status: r.status });
      if (r.ok) {
        const models = parseOllama(r.data);
        if (models.length) return { ok: true, source: 'ollama', models, tried };
      }
    } catch (err) {
      tried.push({ url: origin + '/api/tags', error: err.name === 'AbortError' ? '超时' : (err.message || '网络错误') });
    }
  }

  const last = tried[tried.length - 1] || {};
  const net = last.error || '';
  const status = last.status;
  let error = '无法获取模型列表';
  if (net === '超时') error = '获取模型列表超时';
  else if (net) error = '无法连接到 ' + raw + '：' + net;
  else if (status === 401 || status === 403) error = '模型列表接口返回 ' + status + '（API Key 无效或没有权限）';
  else if (status === 404) error = '该服务没有提供 /models 接口';
  else if (status) error = '模型列表接口返回 ' + status;

  return {
    ok: false,
    fallback: true,
    models: fallback,
    error,
    hint: fallback.length
      ? '已回退到该厂商的推荐模型，你也可以直接手动输入模型名。'
      : '请手动输入模型名。部分厂商不开放模型列表接口。',
    tried,
  };
}

export const TASK_MODEL_KEYS = ['diagnose', 'rewrite', 'interview'];

const TASK_BUCKET = {
  diagnose: 'diagnose', jd_analyze: 'diagnose', jd_match: 'diagnose', strategy: 'diagnose', extract_jd: 'diagnose',
  rewrite: 'rewrite', tailor: 'rewrite', compress: 'rewrite', translate: 'rewrite', story_write: 'rewrite', story_from_project: 'rewrite',
  interview: 'interview', mock_interview: 'interview', story_probe: 'interview', chat: 'interview',
};

export function modelForTask(task) {
  const { llm } = loadSettings();
  const bucket = TASK_BUCKET[task];
  const named = bucket && llm.modelsByTask && String(llm.modelsByTask[bucket] || '').trim();
  return named || llm.model;
}
