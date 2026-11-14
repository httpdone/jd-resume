// LLM 与平台设置：data/config.json（已加入 .gitignore），环境变量优先级更高
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.mjs';

const FILE = path.join(DATA_DIR, 'config.json');

export const PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'], keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'qwen', name: '通义千问（阿里云百炼）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen3-max'], keyUrl: 'https://bailian.console.aliyun.com/' },
  { id: 'kimi', name: 'Kimi（月之暗面）', baseUrl: 'https://api.moonshot.cn/v1', models: ['kimi-k2-turbo-preview', 'kimi-k2-0905-preview', 'moonshot-v1-32k'], keyUrl: 'https://platform.moonshot.cn/console/api-keys' },
  { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4.6', 'glm-4-plus', 'glm-4-flash'], keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
  { id: 'doubao', name: '豆包（火山方舟）', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', models: ['doubao-seed-1-6-250615', 'doubao-1-5-pro-32k-250115'], keyUrl: 'https://console.volcengine.com/ark' },
  { id: 'siliconflow', name: '硅基流动 SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'], keyUrl: 'https://cloud.siliconflow.cn/account/ak' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o-mini', 'gpt-4.1', 'gpt-4o'], keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', models: ['deepseek/deepseek-chat', 'openai/gpt-4o-mini'], keyUrl: 'https://openrouter.ai/keys' },
  { id: 'ollama', name: 'Ollama（本地模型）', baseUrl: 'http://127.0.0.1:11434/v1', models: ['qwen2.5:14b', 'qwen3:8b'], keyUrl: '' },
  { id: 'custom', name: '自定义（OpenAI 兼容）', baseUrl: '', models: [], keyUrl: '' },
];

const DEFAULTS = {
  llm: { preset: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat', temperature: 0.4, maxTokens: 32768, structuredOutput: 'auto', modelsByTask: { diagnose: '', rewrite: '', interview: '' } },
  mock: false,
  remindAfterDays: 7,
  notifyEnabled: false,
};

function readFile() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

// 每个供应商单独存 Key：llm.keys = { deepseek: 'sk-..', openai: 'sk-..', 'custom:https://x/v1': '..' }
// 自定义（OpenAI 兼容）按 Base URL 区分，避免把一家的 Key 发给另一家。
export function keySlot(preset, baseUrl) {
  const id = preset || 'custom';
  if (id !== 'custom') return id;
  const url = String(baseUrl || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '').toLowerCase();
  return 'custom:' + url;
}

function envKey() {
  const env = process.env;
  return env.LLM_API_KEY || env.OPENAI_API_KEY || env.DEEPSEEK_API_KEY || '';
}

// 旧版只有一个 llm.apiKey：迁移到当时保存的那个供应商名下
function normalizeLlm(fileLlm = {}) {
  const llm = { ...DEFAULTS.llm, ...fileLlm };
  const keys = { ...(fileLlm.keys && typeof fileLlm.keys === 'object' ? fileLlm.keys : {}) };
  if (fileLlm.apiKey) {
    const slot = keySlot(llm.preset, llm.baseUrl);
    if (!keys[slot]) keys[slot] = fileLlm.apiKey;
  }
  llm.keys = keys;
  delete llm.apiKey;
  return llm;
}

// 取某个供应商自己的 Key；没有就退回环境变量
export function keyFor(llm, preset, baseUrl) {
  const k = (llm.keys || {})[keySlot(preset ?? llm.preset, baseUrl ?? llm.baseUrl)];
  if (k) return { key: k, source: 'file' };
  const e = envKey();
  return e ? { key: e, source: 'env' } : { key: '', source: '' };
}

export function loadSettings() {
  const file = readFile();
  const llm = normalizeLlm(file.llm || {});
  const env = process.env;
  const source = { apiKey: '', baseUrl: 'file', model: 'file' };
  if (env.LLM_BASE_URL) { llm.baseUrl = env.LLM_BASE_URL; source.baseUrl = 'env'; }
  if (env.LLM_MODEL) { llm.model = env.LLM_MODEL; source.model = 'env'; }
  const cur = keyFor(llm);
  llm.apiKey = cur.key; // 只在后端内存里用，publicSettings 不会返回原文
  source.apiKey = cur.source;
  const mock = env.LLM_MOCK ? env.LLM_MOCK !== '0' : Boolean(file.mock);
  const remindAfterDays = Math.max(1, Math.min(60, Number(file.remindAfterDays ?? DEFAULTS.remindAfterDays) || 7));
  const notifyEnabled = Boolean(file.notifyEnabled);
  return { llm, mock, source, remindAfterDays, notifyEnabled };
}

function mask(key) {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return key.slice(0, 3) + '****' + key.slice(-4);
}

// 给前端看的版本：Key 打码；每个供应商单独显示是否已保存
export function publicSettings() {
  const { llm, mock, source, remindAfterDays, notifyEnabled } = loadSettings();
  const keyStatus = {};
  for (const [slot, k] of Object.entries(llm.keys || {})) if (k) keyStatus[slot] = mask(k);
  const env = envKey();
  return {
    llm: { preset: llm.preset, baseUrl: llm.baseUrl, model: llm.model, temperature: llm.temperature, maxTokens: llm.maxTokens, modelsByTask: llm.modelsByTask || { diagnose: '', rewrite: '', interview: '' }, structuredOutput: llm.structuredOutput || 'auto', hasKey: Boolean(llm.apiKey), keyMasked: mask(llm.apiKey), keySlot: keySlot(llm.preset, llm.baseUrl), keyStatus, envKeyMasked: env ? mask(env) : '' },
    mock,
    source,
    remindAfterDays,
    notifyEnabled,
    ready: Boolean(llm.apiKey || isLocalBase(llm.baseUrl)) && Boolean(llm.baseUrl && llm.model),
    presets: PRESETS,
  };
}


export function isLocalBase(url) {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(url || '');
}

export function saveSettings(patch) {
  const file = readFile();
  const llm = normalizeLlm(file.llm || {});
  const p = patch.llm || {};
  for (const k of ['preset', 'baseUrl', 'model']) if (typeof p[k] === 'string') llm[k] = p[k].trim();
  llm.baseUrl = (llm.baseUrl || '').replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  if (p.temperature !== undefined) llm.temperature = Math.max(0, Math.min(2, Number(p.temperature) || 0));
  if (p.maxTokens !== undefined) llm.maxTokens = Math.max(256, Math.min(65536, Number(p.maxTokens) || 32768));
  if (p.structuredOutput !== undefined) {
    const v = String(p.structuredOutput || 'auto').trim().toLowerCase().replace(/-/g, '_');
    llm.structuredOutput = ['auto', 'json_schema', 'json_object', 'off'].includes(v) ? v : 'auto';
  }
  // Key 只写入 / 清除「当前选中的供应商」，不影响其他供应商
  const slot = keySlot(p.keyPreset || llm.preset, p.keyBaseUrl ?? llm.baseUrl);
  if (typeof p.apiKey === 'string' && p.apiKey.trim() && !p.apiKey.includes('****')) llm.keys[slot] = p.apiKey.trim();
  if (p.clearKey || patch.clearKey) delete llm.keys[slot];
  if (p.modelsByTask && typeof p.modelsByTask === 'object') {
    const cur = { diagnose: '', rewrite: '', interview: '', ...(llm.modelsByTask || {}) };
    for (const k of ['diagnose', 'rewrite', 'interview']) if (typeof p.modelsByTask[k] === 'string') cur[k] = p.modelsByTask[k].trim();
    llm.modelsByTask = cur;
  }

  const next = { ...file, llm };
  if (typeof patch.mock === 'boolean') next.mock = patch.mock;
  if (patch.remindAfterDays !== undefined) next.remindAfterDays = Math.max(1, Math.min(60, Number(patch.remindAfterDays) || 7));
  if (typeof patch.notifyEnabled === 'boolean') next.notifyEnabled = patch.notifyEnabled;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return publicSettings();
}
