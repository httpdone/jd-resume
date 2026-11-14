// 调用后端 /api/agent（SSE 流式），返回解析好的结果
export async function runAgent(payload, { onDelta, onThinking, onMeta, onStep, signal } = {}) {
  const res = await fetch('/api/agent', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal,
  });
  if (!res.ok || !res.body) throw new Error('Agent 请求失败（' + res.status + '）');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  let result = null;
  let meta = null;
  let error = null;
  const handle = (block) => {
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).replace(/^ /, '');
    }
    if (!data) return;
    let obj;
    try { obj = JSON.parse(data); } catch { return; }
    if (event === 'delta') { full += obj.text; onDelta?.(obj.text, full); }
    else if (event === 'thinking') onThinking?.(obj.text);
    else if (event === 'step') onStep?.(obj);
    else if (event === 'meta') { meta = obj; onMeta?.(obj); }
    else if (event === 'result') result = obj;
    else if (event === 'error') error = obj;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    if (done) { buf += decoder.decode(); break; }
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 2); }
  }
  if (buf.trim()) handle(buf);
  if (error) {
    const e = new Error(error.message);
    e.code = error.code; e.raw = error.raw;
    throw e;
  }
  if (!result) throw new Error('Agent 没有返回结果');
  return { ...result, meta, raw: full };
}
