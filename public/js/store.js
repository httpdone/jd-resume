import { $ } from './ui.js';
import { get } from './api.js';

export const state = { settings: null, apps: null };

export async function refreshLlmStatus() {
  try {
    const s = await get('/api/settings');
    state.settings = s;
    const pill = $('#llm-pill');
    if (pill) {
      pill.className = 'llm-pill ' + (s.mock ? 'mock' : s.ready ? 'ok' : 'off');
      pill.querySelector('span').textContent = s.mock ? '演示模式（未连模型）' : s.ready ? '已连接 · ' + s.llm.model : '未配置大模型';
      pill.title = s.mock ? '当前为演示模式：AI 结果由本地规则生成' : s.ready ? s.llm.baseUrl : '点击去设置';
    }
    return s;
  } catch { return null; }
}

export async function ensureSettings() {
  return state.settings || refreshLlmStatus();
}

// 没配置模型时给出清晰提示
export function llmNotice(s) {
  if (!s) return '';
  if (s.mock) return '<div class="mock-note">演示模式：结果由本地规则生成，仅用于体验流程。到「设置」配置模型后可获得真实 AI 分析。</div>';
  if (!s.ready) return '<div class="callout warn"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg><div>还没有配置大模型。去 <a href="#/settings">设置</a> 填写 DeepSeek / 通义千问 / Kimi 等的 API Key，或在设置里打开「演示模式」先体验流程。</div></div>';
  return '';
}
